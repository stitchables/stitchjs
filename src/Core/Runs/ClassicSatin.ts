import { Vector } from '../../Math/Vector';
import { Stitch } from '../Stitch';
import { geometryFactory } from '../../util/jsts';
import { Coordinate, LinearRing, LineString } from 'jsts/org/locationtech/jts/geom';
import {
  LengthIndexedLine,
  LengthLocationMap,
  LinearGeometryBuilder,
  LinearLocation,
  LocationIndexedLine,
} from 'jsts/org/locationtech/jts/linearref';
import { StitchType } from '../EStitchType';
import { IRun } from '../IRun';
import { Run } from './Run';

export interface UnderlayOptions {
  stitchLengthMm?: number;
  stitchToleranceMm?: number;
  travelLengthMm?: number;
  travelToleranceMm?: number;
  densityMm?: number;
  capInsetMm?: number;
  sideInsetMm?: number;
}

export interface SatinSplitOptions {
  maxWidthMm: number;
  staggerCycles?: number;
  staggerAmountMm?: number;
}

export interface SatinShorteningOptions {
  /** Shorten when same-side spacing falls below this percentage of nominal spacing. */
  triggerSpacingPercent?: number;
  /** Maximum shortened penetrations in a row. Values are limited to 0-5. */
  maxConsecutive?: number;
  /** Row n - 1 contains stitch-length percentages for a run of n short stitches. */
  lengthPercentByRunLength?: number[][];
  /** Shuffle each run's percentages to avoid a repeating visual line. */
  randomize?: boolean;
  /** Makes randomized shortening repeatable. */
  randomSeed?: number;
}

export interface SatinFractionalSpacingOptions {
  /** Spacing reference across the column: 0 is the outside edge, 1 is inside. */
  offsetFraction: number;
}

interface SatinRow {
  left: Coordinate;
  right: Coordinate;
}

interface SatinSpacingMetric {
  segmentLengths: number[];
  cumulativeLengths: number[];
  totalLength: number;
}

type SatinSide = 'left' | 'right';

const DEFAULT_SHORTENING_LENGTH_PERCENT: number[][] = [
  [80],
  [85, 72],
  [70, 90, 70],
  [70, 90, 80, 70],
  [70, 87, 65, 83, 70],
];

interface SatinLineData {
  line: LineString;
  len: number;
  lenIndex: LengthIndexedLine;
  locIndex: LocationIndexedLine;
  lenLocMap: LengthLocationMap;
}

export class ClassicSatin implements IRun {
  quadStripVertices: Vector[];
  startPosition: Vector;
  endPosition: Vector;
  densityMm: number;
  travelLengthMm: number;
  travelToleranceMm: number;
  split: SatinSplitOptions | undefined;
  shortening: SatinShorteningOptions | undefined;
  fractionalSpacing: SatinFractionalSpacingOptions | undefined;
  underlays: { type: string; options?: UnderlayOptions }[];
  lineData: { left: SatinLineData; right: SatinLineData; center: SatinLineData };
  isClosed: boolean;

  constructor(
    quadStripVertices: Vector[],
    options?: {
      startPosition?: Vector;
      endPosition?: Vector;
      densityMm?: number;
      travelLengthMm?: number;
      travelToleranceMm?: number;
      split?: SatinSplitOptions;
      shortening?: SatinShorteningOptions;
      fractionalSpacing?: SatinFractionalSpacingOptions;
      underlays?: { type: string; options?: UnderlayOptions }[];
    },
  ) {
    this.quadStripVertices = quadStripVertices;
    if (this.quadStripVertices.length < 4) {
      console.warn('ClassicSatin: quadStripVertices must be greater than 4...');
    }
    this.lineData = this.getLineData();
    this.isClosed = this.getIsClosed();
    [this.startPosition, this.endPosition] = this.getStartAndEndPositions(
      options?.startPosition,
      options?.endPosition,
    );
    this.densityMm = options?.densityMm ?? 0.4;
    this.travelLengthMm = options?.travelLengthMm ?? 3;
    this.travelToleranceMm = options?.travelToleranceMm ?? 1;
    this.split = options?.split;
    this.shortening = options?.shortening;
    this.fractionalSpacing = options?.fractionalSpacing;
    this.underlays = options?.underlays ?? [];
  }

  getLineData(): { left: SatinLineData; right: SatinLineData; center: SatinLineData } {
    const leftBuilder = new LinearGeometryBuilder(geometryFactory);
    const rightBuilder = new LinearGeometryBuilder(geometryFactory);
    const centerBuilder = new LinearGeometryBuilder(geometryFactory);
    for (let i = 0; i < this.quadStripVertices.length; i += 2) {
      const [left, right] = [this.quadStripVertices[i], this.quadStripVertices[i + 1]];
      const center = left.lerp(right, 0.5);
      leftBuilder.add(new Coordinate(left.x, left.y));
      rightBuilder.add(new Coordinate(right.x, right.y));
      centerBuilder.add(new Coordinate(center.x, center.y));
    }
    const leftLine: LineString = leftBuilder.getGeometry();
    const rightLine: LineString = rightBuilder.getGeometry();
    const centerLine: LineString = centerBuilder.getGeometry();
    return {
      left: {
        line: leftLine,
        len: leftLine.getLength(),
        lenIndex: new LengthIndexedLine(leftLine),
        locIndex: new LocationIndexedLine(leftLine),
        lenLocMap: new LengthLocationMap(leftLine),
      },
      right: {
        line: rightLine,
        len: rightLine.getLength(),
        lenIndex: new LengthIndexedLine(rightLine),
        locIndex: new LocationIndexedLine(rightLine),
        lenLocMap: new LengthLocationMap(rightLine),
      },
      center: {
        line: centerLine,
        len: centerLine.getLength(),
        lenIndex: new LengthIndexedLine(centerLine),
        locIndex: new LocationIndexedLine(centerLine),
        lenLocMap: new LengthLocationMap(centerLine),
      },
    };
  }

  getIsClosed(): boolean {
    const n = this.quadStripVertices.length;
    const [s1, s2] = [this.quadStripVertices[0], this.quadStripVertices[1]];
    const [t1, t2] = [this.quadStripVertices[n - 2], this.quadStripVertices[n - 1]];
    return s1.distance(t1) < 1e-7 && s2.distance(t2) < 1e-7;
  }

  getStartAndEndPositions(start: Vector | undefined, end: Vector | undefined): Vector[] {
    if (start && end) {
      return [start, end];
    } else if (start) {
      if (this.isClosed) return [start, start];
      const proj = this.lineData.center.lenIndex.project(
        new Coordinate(start.x, start.y),
      );
      if (proj < 0.5 * this.lineData.center.len) {
        return [start, this.quadStripVertices[this.quadStripVertices.length - 1]];
      } else {
        return [start, this.quadStripVertices[0]];
      }
    } else if (end) {
      if (this.isClosed) return [end, end];
      const proj = this.lineData.center.lenIndex.project(new Coordinate(end.x, end.y));
      if (proj < 0.5 * this.lineData.center.len) {
        return [this.quadStripVertices[this.quadStripVertices.length - 1], end];
      } else {
        return [this.quadStripVertices[0], end];
      }
    } else {
      if (this.isClosed) return [this.quadStripVertices[0], this.quadStripVertices[0]];
      else
        return [
          this.quadStripVertices[0],
          this.quadStripVertices[this.quadStripVertices.length - 1],
        ];
    }
  }

  getTravelStitches(subsection: LineString, pixelsPerMm: number): Stitch[] {
    if (subsection.getNumPoints() < 2) {
      return [];
    }
    const midpoint = (a: Coordinate, b: Coordinate): Coordinate => {
      return new Coordinate(0.5 * (a.x + b.x), 0.5 * (a.y + b.y));
    };
    const start = midpoint(subsection.getCoordinateN(0), subsection.getCoordinateN(1));
    const end = midpoint(
      subsection.getCoordinateN(subsection.getNumPoints() - 1),
      subsection.getCoordinateN(subsection.getNumPoints() - 2),
    );
    const startLen = this.lineData.center.lenIndex.project(start);
    const endLen = this.lineData.center.lenIndex.project(end);
    if (Math.abs(startLen - endLen) < 0.5 * pixelsPerMm) {
      return [new Stitch(new Vector(end.x, end.y), StitchType.TRAVEL)];
    }
    const centerSection = this.lineData.center.lenIndex.extractLine(startLen, endLen);
    if (centerSection.getNumPoints() < 2) {
      return [new Stitch(new Vector(end.x, end.y), StitchType.TRAVEL)];
    }
    const vertices: Vector[] = centerSection
      .getCoordinates()
      .map((c: Coordinate) => new Vector(c.x, c.y));
    const travelRun = new Run(vertices, {
      stitchLengthMm: this.travelLengthMm,
      stitchToleranceMm: this.travelToleranceMm,
    });
    return travelRun.getStitches(pixelsPerMm).map((s) => {
      s.stitchType = StitchType.TRAVEL;
      return s;
    });
    // const lineStringBuilder = new LinearGeometryBuilder(geometryFactory);
    // for (let i = 1; i < subsection.getNumPoints(); i++) {
    //   const prev = subsection.getCoordinateN(i - 1);
    //   const curr = subsection.getCoordinateN(i);
    //   const midpoint = new Vector(0.5 * (prev.x + curr.x), 0.5 * (prev.y + curr.y));
    //   lineStringBuilder.add(new Coordinate(midpoint.x, midpoint.y));
    // }
    // const travel = DouglasPeuckerSimplifier.simplify(
    //   lineStringBuilder.getGeometry(),
    //   pixelsPerMm,
    // );
    // const travelLength = travel.getLength();
    // const travelLengthIndex = new LengthIndexedLine(travel);
    // const countSamples = Math.round(travelLength / (this.travelLengthMm * pixelsPerMm));
    // for (let i = 0; i < countSamples; i++) {
    //   const coord = travelLengthIndex.extractPoint(
    //     (travelLength * (i + 1)) / countSamples,
    //   );
    //   travelStitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.TRAVEL));
    // }
    // return travelStitches;
  }

  getStitches(pixelsPerMm: number): Stitch[] {
    const stitches = [new Stitch(this.startPosition, StitchType.START)];
    stitches.push(...this.getUnderlayStitches(this.startPosition, pixelsPerMm));
    if (this.densityMm > 0) {
      stitches.push(
        ...this.getSatinStitches(
          stitches.slice(-1)[0].position,
          this.endPosition,
          pixelsPerMm,
        ),
      );
    }
    return stitches;
  }

  getUnderlayStitches(start: Vector, pixelsPerMm: number): Stitch[] {
    const stitches: Stitch[] = [];
    let lastStitch = start;
    for (const underlay of this.underlays) {
      switch (underlay.type) {
        case 'CONTOUR':
          stitches.push(
            ...this.getContourUnderlay(lastStitch, underlay.options ?? {}, pixelsPerMm),
          );
          break;
        case 'CENTER_LINE':
          stitches.push(
            ...this.getCenterLineUnderlay(
              lastStitch,
              underlay.options ?? {},
              pixelsPerMm,
            ),
          );
          break;
        case 'ZIGZAG':
          stitches.push(
            ...this.getZigZagUnderlay(lastStitch, underlay.options ?? {}, pixelsPerMm),
          );
          break;
        default:
          console.log(`Unknown underlay type (${underlay.type}) in ClassicSatin...`);
      }
      lastStitch = stitches.slice(-1)[0].position;
    }
    return stitches;
  }

  getSatinStitches(start: Vector, end: Vector, pixelsPerMm: number): Stitch[] {
    const stitches = [] as Stitch[];
    const fullSatin = this.getFullSatin(pixelsPerMm);
    const fullSatinLength = fullSatin.getLength();
    const fullSatinLengthIndex = new LengthIndexedLine(fullSatin);
    const startIndex = fullSatinLengthIndex.project(new Coordinate(start.x, start.y));
    const startCoord = fullSatinLengthIndex.extractPoint(startIndex);
    const endIndex = fullSatinLengthIndex.project(new Coordinate(end.x, end.y));
    const i1 = startIndex < endIndex ? 0 : fullSatinLength;
    const i2 = startIndex < endIndex ? fullSatinLength : 0;
    const start_i1 = fullSatinLengthIndex.extractLine(startIndex, i1);
    const i1_end = fullSatinLengthIndex.extractLine(i1, endIndex);
    const end_i2 = fullSatinLengthIndex.extractLine(endIndex, i2);
    const i2_end = fullSatinLengthIndex.extractLine(i2, endIndex);
    const start_end = fullSatinLengthIndex.extractLine(startIndex, endIndex);
    if (startCoord.distance(new Coordinate(start.x, start.y)) > 0.5 * pixelsPerMm) {
      stitches.push(
        new Stitch(new Vector(startCoord.x, startCoord.y), StitchType.TRAVEL),
      );
    }
    if (!this.isClosed) {
      stitches.push(...this.getTravelStitches(start_i1, pixelsPerMm));
      for (const coord of i1_end.getCoordinates()) {
        stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.NORMAL));
      }
      stitches.push(...this.getTravelStitches(end_i2, pixelsPerMm));
      for (const coord of i2_end.getCoordinates()) {
        stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.NORMAL));
      }
    } else {
      if (start_end.getLength() < start_i1.getLength() + i2_end.getLength()) {
        stitches.push(...this.getTravelStitches(start_end, pixelsPerMm));
      } else {
        stitches.push(...this.getTravelStitches(start_i1, pixelsPerMm));
        stitches.push(...this.getTravelStitches(i2_end, pixelsPerMm));
      }
      const s1 = fullSatinLengthIndex.extractLine(endIndex, fullSatinLength);
      const s2 = fullSatinLengthIndex.extractLine(0, endIndex);
      for (const coord of [...s1.getCoordinates(), ...s2.getCoordinates()]) {
        stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.NORMAL));
      }
    }
    stitches.push(new Stitch(new Vector(end.x, end.y), StitchType.TRAVEL));
    return stitches;
  }

  getFullSatin(pixelsPerMm: number): LineString {
    const spacingMetric = this.fractionalSpacing
      ? this.getFractionalSpacingMetric(this.fractionalSpacing.offsetFraction)
      : undefined;
    const samplingLength = spacingMetric?.totalLength ?? this.lineData.center.len;
    const countCrosses = Math.round(samplingLength / (this.densityMm * pixelsPerMm)) + 1;
    const rows: SatinRow[] = [];
    for (let i = 0; i < (this.isClosed ? countCrosses : countCrosses + 1); i++) {
      const sampleFraction = i / countCrosses;
      const locationIndex = spacingMetric
        ? this.getFractionalSpacingLocation(
            sampleFraction * spacingMetric.totalLength,
            sampleFraction,
            spacingMetric,
          )
        : this.lineData.center.lenLocMap.getLocation(
            sampleFraction * this.lineData.center.len,
          );
      const left: Coordinate = this.lineData.left.locIndex.extractPoint(locationIndex);
      const right: Coordinate = this.lineData.right.locIndex.extractPoint(locationIndex);
      rows.push({ left, right });
    }

    const finalRows = this.shortening
      ? this.applyStitchShortening(rows, pixelsPerMm)
      : rows;
    const originalCoords = rows.flatMap(({ left, right }) => [left, right]);
    const rawCoords = finalRows.flatMap(({ left, right }) => [left, right]);

    if (this.split === undefined || this.split.maxWidthMm <= 0) {
      return geometryFactory.createLineString(rawCoords);
    }

    const splitPx = this.split.maxWidthMm * pixelsPerMm;
    const finalCoords: Coordinate[] = [rawCoords[0]];
    for (let i = 1; i < rawCoords.length; i++) {
      const originalSegment = {
        a: originalCoords[i - 1],
        b: originalCoords[i],
      };
      const shortenedSegment = { a: rawCoords[i - 1], b: rawCoords[i] };
      for (const coord of this.getRetainedSplitPoints(
        originalSegment,
        shortenedSegment,
        this.split,
        splitPx,
        i,
        pixelsPerMm,
      )) {
        finalCoords.push(coord);
      }
      finalCoords.push(shortenedSegment.b);
    }
    return geometryFactory.createLineString(finalCoords);
  }

  private getFractionalSpacingMetric(offsetFraction: number): SatinSpacingMetric {
    const fraction = Number.isFinite(offsetFraction)
      ? Math.max(0, Math.min(1, offsetFraction))
      : 0.5;
    const segmentLengths: number[] = [];
    const cumulativeLengths: number[] = [];
    let totalLength = 0;

    for (let i = 0; i + 3 < this.quadStripVertices.length; i += 2) {
      const leftLength = this.quadStripVertices[i].distance(
        this.quadStripVertices[i + 2],
      );
      const rightLength = this.quadStripVertices[i + 1].distance(
        this.quadStripVertices[i + 3],
      );
      const outsideLength = Math.max(leftLength, rightLength);
      const insideLength = Math.min(leftLength, rightLength);
      const segmentLength = outsideLength * (1 - fraction) + insideLength * fraction;
      segmentLengths.push(segmentLength);
      totalLength += segmentLength;
      cumulativeLengths.push(totalLength);
    }

    return { segmentLengths, cumulativeLengths, totalLength };
  }

  private getFractionalSpacingLocation(
    targetLength: number,
    fallbackFraction: number,
    metric: SatinSpacingMetric,
  ): LinearLocation {
    if (metric.segmentLengths.length === 0) {
      return new LinearLocation(0, 0);
    }
    if (metric.totalLength <= 1e-7) {
      const lastSegmentIndex = metric.segmentLengths.length - 1;
      const scaledIndex = fallbackFraction * metric.segmentLengths.length;
      const segmentIndex = Math.min(lastSegmentIndex, Math.floor(scaledIndex));
      return new LinearLocation(segmentIndex, Math.min(1, scaledIndex - segmentIndex));
    }

    const clampedTarget = Math.max(0, Math.min(metric.totalLength, targetLength));
    let low = 0;
    let high = metric.cumulativeLengths.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (clampedTarget <= metric.cumulativeLengths[middle]) high = middle;
      else low = middle + 1;
    }

    const segmentStart = low === 0 ? 0 : metric.cumulativeLengths[low - 1];
    const segmentLength = metric.segmentLengths[low];
    const segmentFraction =
      segmentLength > 1e-7
        ? Math.max(0, Math.min(1, (clampedTarget - segmentStart) / segmentLength))
        : 0;
    return new LinearLocation(low, segmentFraction);
  }

  private applyStitchShortening(rows: SatinRow[], pixelsPerMm: number): SatinRow[] {
    if (rows.length < 2 || this.shortening === undefined) {
      return rows;
    }

    const triggerSpacingPercent = Math.max(
      0,
      Math.min(100, this.shortening.triggerSpacingPercent ?? 50),
    );
    const maxConsecutive = Math.max(
      0,
      Math.min(5, Math.floor(this.shortening.maxConsecutive ?? 5)),
    );
    if (triggerSpacingPercent <= 0 || maxConsecutive <= 0) {
      return rows;
    }

    const thresholdPx = this.densityMm * pixelsPerMm * (triggerSpacingPercent / 100);
    const candidates: (SatinSide | undefined)[] = new Array(rows.length).fill(undefined);
    const firstIndex = this.isClosed ? 0 : 1;
    const endIndex = this.isClosed ? rows.length : rows.length - 1;

    for (let i = firstIndex; i < endIndex; i++) {
      const previousIndex = (i - 1 + rows.length) % rows.length;
      const leftSpacing = rows[i].left.distance(rows[previousIndex].left);
      const rightSpacing = rows[i].right.distance(rows[previousIndex].right);
      const insideSpacing = Math.min(leftSpacing, rightSpacing);

      if (insideSpacing < thresholdPx && Math.abs(leftSpacing - rightSpacing) > 1e-7) {
        candidates[i] = leftSpacing < rightSpacing ? 'left' : 'right';
      }
    }

    const shortenedRows = rows.map(({ left, right }) => ({
      left: new Coordinate(left.x, left.y),
      right: new Coordinate(right.x, right.y),
    }));
    const random = this.createShorteningRandom(this.shortening.randomSeed ?? 0);
    const randomize = this.shortening.randomize ?? true;
    const applyGroup = (indices: number[]) => {
      const percentages = this.getShorteningPercentages(indices.length);
      if (randomize) {
        this.shuffleShorteningPercentages(percentages, random);
      }

      for (let i = 0; i < indices.length; i++) {
        const rowIndex = indices[i];
        const side = candidates[rowIndex];
        if (side === undefined) continue;

        const ratio = percentages[i] / 100;
        const original = rows[rowIndex];
        if (side === 'left') {
          shortenedRows[rowIndex].left = new Coordinate(
            original.right.x + (original.left.x - original.right.x) * ratio,
            original.right.y + (original.left.y - original.right.y) * ratio,
          );
        } else {
          shortenedRows[rowIndex].right = new Coordinate(
            original.left.x + (original.right.x - original.left.x) * ratio,
            original.left.y + (original.right.y - original.left.y) * ratio,
          );
        }
      }
    };

    const applyLinearRuns = (orderedIndices: number[]) => {
      let cursor = 0;
      while (cursor < orderedIndices.length) {
        while (
          cursor < orderedIndices.length &&
          candidates[orderedIndices[cursor]] === undefined
        ) {
          cursor++;
        }
        const runStart = cursor;
        while (
          cursor < orderedIndices.length &&
          candidates[orderedIndices[cursor]] !== undefined
        ) {
          cursor++;
        }

        let groupStart = runStart;
        while (groupStart < cursor) {
          const remaining = cursor - groupStart;
          const groupLength = Math.min(maxConsecutive, remaining);
          applyGroup(orderedIndices.slice(groupStart, groupStart + groupLength));
          groupStart += groupLength;
          if (groupStart < cursor) {
            groupStart++;
          }
        }
      }
    };

    if (!this.isClosed) {
      applyLinearRuns(rows.map((_, index) => index));
      return shortenedRows;
    }

    const normalIndex = candidates.findIndex((side) => side === undefined);
    if (normalIndex >= 0) {
      const orderedIndices = rows.map(
        (_, offset) => (normalIndex + 1 + offset) % rows.length,
      );
      applyLinearRuns(orderedIndices);
      return shortenedRows;
    }

    if (rows.length <= maxConsecutive) {
      applyGroup(rows.map((_, index) => index));
      return shortenedRows;
    }

    const normalCount = Math.ceil(rows.length / (maxConsecutive + 1));
    const shortenedCount = rows.length - normalCount;
    const baseGroupLength = Math.floor(shortenedCount / normalCount);
    const longerGroupCount = shortenedCount % normalCount;
    let rowIndex = 0;
    for (let groupIndex = 0; groupIndex < normalCount; groupIndex++) {
      const groupLength = baseGroupLength + (groupIndex < longerGroupCount ? 1 : 0);
      applyGroup(Array.from({ length: groupLength }, (_, offset) => rowIndex + offset));
      rowIndex += groupLength + 1;
    }
    return shortenedRows;
  }

  private getShorteningPercentages(groupLength: number): number[] {
    const configured = this.shortening?.lengthPercentByRunLength?.[groupLength - 1];
    const defaults = DEFAULT_SHORTENING_LENGTH_PERCENT[groupLength - 1];
    return Array.from({ length: groupLength }, (_, index) => {
      const percentage = configured?.[index] ?? defaults[index];
      return Math.max(1, Math.min(100, Number.isFinite(percentage) ? percentage : 100));
    });
  }

  private createShorteningRandom(seed: number): () => number {
    let state = Number.isFinite(seed) ? seed >>> 0 : 0;
    return () => {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  private shuffleShorteningPercentages(
    percentages: number[],
    random: () => number,
  ): void {
    for (let i = percentages.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [percentages[i], percentages[j]] = [percentages[j], percentages[i]];
    }
  }

  private getRetainedSplitPoints(
    originalSegment: { a: Coordinate; b: Coordinate },
    shortenedSegment: { a: Coordinate; b: Coordinate },
    split: SatinSplitOptions,
    splitPx: number,
    crossIdx: number,
    pixelsPerMm: number,
  ): Coordinate[] {
    const splitPoints = this.splitSegment(
      originalSegment,
      split,
      splitPx,
      crossIdx,
      pixelsPerMm,
    );
    splitPoints.pop();
    if (splitPoints.length === 0) {
      return splitPoints;
    }

    const epsilon = 1e-7;
    const startMoved = originalSegment.a.distance(shortenedSegment.a) > epsilon;
    const endMoved = originalSegment.b.distance(shortenedSegment.b) > epsilon;
    if (!startMoved && !endMoved) {
      return splitPoints;
    }

    const dx = originalSegment.b.x - originalSegment.a.x;
    const dy = originalSegment.b.y - originalSegment.a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= epsilon * epsilon) {
      return [];
    }

    const project = (coord: Coordinate): number =>
      ((coord.x - originalSegment.a.x) * dx + (coord.y - originalSegment.a.y) * dy) /
      lengthSquared;
    const shortenedStartT = startMoved ? project(shortenedSegment.a) : 0;
    const shortenedEndT = endMoved ? project(shortenedSegment.b) : 1;

    return splitPoints.filter((coord) => {
      const t = project(coord);
      if (startMoved && t <= shortenedStartT + epsilon) return false;
      if (endMoved && t >= shortenedEndT - epsilon) return false;
      return true;
    });
  }

  splitSegment(
    segment: { a: Coordinate; b: Coordinate },
    split: SatinSplitOptions,
    splitPx: number,
    crossIdx: number,
    pixelsPerMm: number,
  ): Coordinate[] {
    const { a, b } = segment;
    const dist = a.distance(b);
    if (dist <= splitPx) {
      return [b];
    }

    const staggerCycles = split.staggerCycles;
    const staggerEnabled = staggerCycles !== undefined && staggerCycles > 1;

    const numSegments = Math.ceil(dist / splitPx);
    const rowShift = staggerEnabled
      ? this.getStaggerRowShift(
          crossIdx,
          staggerCycles,
          split,
          dist,
          numSegments,
          splitPx,
          pixelsPerMm,
        )
      : 0;

    const coords: Coordinate[] = [];
    for (let j = 1; j < numSegments; j++) {
      const t = Math.max(0, Math.min(1, j / numSegments + rowShift));
      const p = Vector.fromObject(a).lerp(Vector.fromObject(b), t);
      coords.push(new Coordinate(p.x, p.y));
    }

    coords.push(b);
    return coords;
  }

  private getStaggerRowShift(
    crossIdx: number,
    staggerCycles: number,
    split: SatinSplitOptions,
    dist: number,
    numSegments: number,
    splitPx: number,
    pixelsPerMm: number,
  ): number {
    const slotWidthT = 1 / numSegments;
    const staggerAmountMm = split.staggerAmountMm ?? 2;
    const maxOffsetT = Math.min((staggerAmountMm * pixelsPerMm) / dist, slotWidthT);
    const tierFill = Math.min(1, dist / (numSegments * splitPx));
    const magnitudeScale = ((crossIdx % staggerCycles) + 1) / staggerCycles;
    return maxOffsetT * tierFill * magnitudeScale;
  }

  getUnderlayOptionsOrDefault(
    options: UnderlayOptions | undefined,
  ): Required<UnderlayOptions> {
    return {
      stitchLengthMm: options?.stitchLengthMm ?? 3,
      stitchToleranceMm: options?.stitchToleranceMm ?? 1,
      travelLengthMm: options?.travelLengthMm ?? 6,
      travelToleranceMm: options?.travelToleranceMm ?? 1,
      densityMm: options?.densityMm ?? 3,
      capInsetMm: options?.capInsetMm ?? 0.7,
      sideInsetMm: options?.sideInsetMm ?? 0.6,
    };
  }

  getSideInsetAtLocation(
    loc: LinearLocation,
    sideInsetPx: number,
  ): { left: Coordinate; right: Coordinate } {
    const leftCoord = this.lineData.left.locIndex.extractPoint(loc);
    const rightCoord = this.lineData.right.locIndex.extractPoint(loc);
    const distance = leftCoord.distance(rightCoord);
    const inset = Math.min(0.5 * distance, sideInsetPx) / distance;
    return {
      left: new Coordinate(
        leftCoord.x * (1 - inset) + rightCoord.x * inset,
        leftCoord.y * (1 - inset) + rightCoord.y * inset,
      ),
      right: new Coordinate(
        leftCoord.x * inset + rightCoord.x * (1 - inset),
        leftCoord.y * inset + rightCoord.y * (1 - inset),
      ),
    };
  }

  getContourUnderlay(
    start: Vector,
    options: UnderlayOptions,
    pixelsPerMm: number,
  ): Stitch[] {
    const underlayOptions = {
      ...{ startPosition: start, endPosition: start },
      ...this.getUnderlayOptionsOrDefault(options),
    };
    const capInsetPx = underlayOptions.capInsetMm * pixelsPerMm;
    const sideInsetPx = underlayOptions.sideInsetMm * pixelsPerMm;
    const sLoc: LinearLocation = this.lineData.center.lenLocMap.getLocation(capInsetPx);
    const eLoc: LinearLocation = this.lineData.center.lenLocMap.getLocation(
      this.lineData.center.len - capInsetPx,
    );
    const startInsets = this.getSideInsetAtLocation(sLoc, sideInsetPx);
    const vertices: Vector[] = [
      new Vector(startInsets.left.x, startInsets.left.y),
      new Vector(startInsets.right.x, startInsets.right.y),
    ];
    for (let i = sLoc.getSegmentIndex() + 1; i <= eLoc.getSegmentIndex(); i++) {
      const loc = new LinearLocation(i, 0);
      const currInsets = this.getSideInsetAtLocation(loc, sideInsetPx);
      vertices.unshift(new Vector(currInsets.left.x, currInsets.left.y));
      vertices.push(new Vector(currInsets.right.x, currInsets.right.y));
    }
    const endInsets = this.getSideInsetAtLocation(eLoc, sideInsetPx);
    vertices.unshift(new Vector(endInsets.left.x, endInsets.left.y));
    vertices.push(new Vector(endInsets.right.x, endInsets.right.y));
    vertices.push(vertices[0]);
    const contourRun = new Run(vertices, underlayOptions);
    return contourRun.getStitches(pixelsPerMm);
  }

  getCenterLineUnderlay(
    start: Vector,
    options: UnderlayOptions,
    pixelsPerMm: number,
  ): Stitch[] {
    const underlayOptions = {
      ...{ startPosition: start },
      ...this.getUnderlayOptionsOrDefault(options),
    };
    if (underlayOptions.capInsetMm <= 0) {
      const vertices: Vector[] = this.lineData.center.line
        .getCoordinates()
        .map((c: Coordinate) => new Vector(c.x, c.y));
      const centerLineRun = new Run(vertices, underlayOptions);
      return centerLineRun.getStitches(pixelsPerMm);
    } else {
      const capInsetPx = underlayOptions.capInsetMm * pixelsPerMm;
      const from = this.lineData.center.lenLocMap.getLocation(capInsetPx);
      const to = this.lineData.center.lenLocMap.getLocation(-capInsetPx);
      const inset = this.lineData.center.locIndex.extractLine(from, to);
      const vertices: Vector[] = inset
        .getCoordinates()
        .map((c: Coordinate) => new Vector(c.x, c.y));
      const centerLineRun = new Run(vertices, underlayOptions);
      return centerLineRun.getStitches(pixelsPerMm);
    }
  }

  getZigZagUnderlay(
    start: Vector,
    options: UnderlayOptions,
    pixelsPerMm: number,
  ): Stitch[] {
    const { densityMm, capInsetMm, sideInsetMm } =
      this.getUnderlayOptionsOrDefault(options);
    const stitches: Stitch[] = [];
    const capInsetPx = capInsetMm * pixelsPerMm;
    const sideInsetPx = sideInsetMm * pixelsPerMm;
    const steps = Math.round(
      (this.lineData.center.len - 2 * capInsetPx) / (densityMm * pixelsPerMm),
    );
    const zigCoords = [];
    const zagCoords = [];
    for (let i = 0; i <= steps; i++) {
      const location = this.lineData.center.lenLocMap.getLocation(
        capInsetPx + (i / steps) * (this.lineData.center.len - 2 * capInsetPx),
      );
      const sideInsets = this.getSideInsetAtLocation(location, sideInsetPx);
      zigCoords.push(i % 2 === 0 ? sideInsets.left : sideInsets.right);
      zagCoords.push(i % 2 === 0 ? sideInsets.right : sideInsets.left);
    }
    const zigZag: LinearRing = geometryFactory.createLineString([
      ...zigCoords,
      ...zagCoords.reverse(),
    ]);
    const zigZagLocIndex = new LocationIndexedLine(zigZag);
    const zigZagStart = zigZagLocIndex.project(new Coordinate(start.x, start.y));
    for (let i = 0, n = zigZag.getNumPoints(); i <= n; i++) {
      const index = (i + zigZagStart.getSegmentIndex()) % n;
      const coord = zigZag.getCoordinateN(index);
      stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.NORMAL));
    }
    return stitches;
  }
}
