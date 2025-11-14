import { Vector } from '../../Math/Vector';
import { Stitch } from '../Stitch';
import { Polyline } from '../../Math/Polyline';
import { geometryFactory } from '../../util/jsts';
import { Coordinate, LinearRing, LineString } from 'jsts/org/locationtech/jts/geom';
import {
  LengthIndexedLine,
  LengthLocationMap,
  LinearGeometryBuilder,
  LocationIndexedLine,
  LinearLocation,
} from 'jsts/org/locationtech/jts/linearref';
import { DouglasPeuckerSimplifier } from 'jsts/org/locationtech/jts/simplify';
import { StitchType } from '../EStitchType';
import { IRun } from '../IRun';
import { Run } from './Run';

interface UnderlayOptions {
  densityMm?: number;
  stitchLengthMm?: number;
  capInsetMm?: number;
  sideInsetMm?: number;
}

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
      underlays?: { type: string; options?: UnderlayOptions }[];
    },
  ) {
    this.quadStripVertices = quadStripVertices;
    this.lineData = this.getLineData();
    this.isClosed = this.getIsClosed();
    [this.startPosition, this.endPosition] = this.getStartAndEndPositions(
      options?.startPosition,
      options?.endPosition,
    );
    this.densityMm = options?.densityMm ?? 0.4;
    this.travelLengthMm = options?.travelLengthMm ?? 3;
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
    const travelStitches: Stitch[] = [];
    if (subsection.getNumPoints() < 4) {
      const last = subsection.getEndPoint();
      travelStitches.push(new Stitch(new Vector(last.x, last.y), StitchType.TRAVEL));
      return travelStitches;
    }
    const lineStringBuilder = new LinearGeometryBuilder(geometryFactory);
    for (let i = 1; i < subsection.getNumPoints(); i++) {
      const prev = subsection.getCoordinateN(i - 1);
      const curr = subsection.getCoordinateN(i);
      const midpoint = new Vector(0.5 * (prev.x + curr.x), 0.5 * (prev.y + curr.y));
      lineStringBuilder.add(new Coordinate(midpoint.x, midpoint.y));
    }
    const travel = DouglasPeuckerSimplifier.simplify(
      lineStringBuilder.getGeometry(),
      pixelsPerMm,
    );
    const travelLength = travel.getLength();
    const travelLengthIndex = new LengthIndexedLine(travel);
    const countSamples = Math.round(travelLength / (this.travelLengthMm * pixelsPerMm));
    for (let i = 0; i < countSamples; i++) {
      const coord = travelLengthIndex.extractPoint(
        (travelLength * (i + 1)) / countSamples,
      );
      travelStitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.TRAVEL));
    }
    return travelStitches;
  }

  getStitches(pixelsPerMm: number): Stitch[] {
    const stitches = [new Stitch(this.startPosition, StitchType.START)];
    stitches.push(...this.getUnderlayStitches(this.startPosition, pixelsPerMm));
    stitches.push(
      ...this.getSatinStitches(
        stitches.slice(-1)[0].position,
        this.endPosition,
        pixelsPerMm,
      ),
    );
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
    stitches.push(new Stitch(new Vector(startCoord.x, startCoord.y), StitchType.TRAVEL));
    if (!this.isClosed) {
      stitches.push(...this.getTravelStitches(start_i1, pixelsPerMm));
      for (const coord of i1_end.getCoordinates()) {
        stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.TRAVEL));
      }
      stitches.push(...this.getTravelStitches(end_i2, pixelsPerMm));
      for (const coord of i2_end.getCoordinates()) {
        stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.TRAVEL));
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
        stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.TRAVEL));
      }
    }
    stitches.push(new Stitch(new Vector(end.x, end.y), StitchType.TRAVEL));
    return stitches;
  }

  getFullSatin(pixelsPerMm: number): LineString {
    const countCrosses =
      Math.round(this.lineData.center.len / (this.densityMm * pixelsPerMm)) + 1;
    const coords: Coordinate[] = [];
    for (let i = 0; i < (this.isClosed ? countCrosses : countCrosses + 1); i++) {
      const left: Coordinate = this.lineData.left.lenIndex.extractPoint(
        (i / countCrosses) * this.lineData.left.len,
      );
      const right: Coordinate = this.lineData.right.lenIndex.extractPoint(
        (i / countCrosses) * this.lineData.right.len,
      );
      coords.push(left);
      coords.push(right);
    }
    return geometryFactory.createLineString(coords);
  }

  getUnderlayOptionsOrDefault(
    options: UnderlayOptions | undefined,
  ): Required<UnderlayOptions> {
    return {
      densityMm: options?.densityMm ?? 3,
      stitchLengthMm: options?.stitchLengthMm ?? 3,
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
    const { stitchLengthMm, capInsetMm, sideInsetMm } =
      this.getUnderlayOptionsOrDefault(options);
    const stitches: Stitch[] = [];
    const capInsetPx = capInsetMm * pixelsPerMm;
    const sideInsetPx = sideInsetMm * pixelsPerMm;
    const sLoc: LinearLocation = this.lineData.center.lenLocMap.getLocation(capInsetPx);
    const eLoc: LinearLocation = this.lineData.center.lenLocMap.getLocation(-capInsetPx);
    const startInsets = this.getSideInsetAtLocation(sLoc, sideInsetPx);
    const ringCoords: Coordinate[] = [startInsets.left, startInsets.right];
    for (let i = sLoc.getSegmentIndex() + 1; i <= eLoc.getSegmentIndex(); i++) {
      const loc = new LinearLocation(i, 0);
      const currInsets = this.getSideInsetAtLocation(loc, sideInsetPx);
      ringCoords.unshift(currInsets.left);
      ringCoords.push(currInsets.right);
    }
    const endInsets = this.getSideInsetAtLocation(eLoc, sideInsetPx);
    ringCoords.unshift(endInsets.left);
    ringCoords.push(endInsets.right);
    ringCoords.push(ringCoords[0]);
    const ring: LinearRing = geometryFactory.createLinearRing(ringCoords);
    const ringLen = ring.getLength();
    const ringLenIndex = new LengthIndexedLine(ring);
    const steps = Math.round(ringLen / (stitchLengthMm * pixelsPerMm));
    const ringStart = ringLenIndex.project(new Coordinate(start.x, start.y));
    for (let i = 0; i <= steps; i++) {
      const currLen = ringStart + (i / steps) * ringLen;
      const coord = ringLenIndex.extractPoint(
        currLen > ringLen ? currLen - ringLen : currLen,
      );
      stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.NORMAL));
    }
    return stitches;
  }

  getCenterLineUnderlay(
    start: Vector,
    options: UnderlayOptions,
    pixelsPerMm: number,
  ): Stitch[] {
    const { stitchLengthMm, capInsetMm } = this.getUnderlayOptionsOrDefault(options);
    if (capInsetMm <= 0) {
      const coords = this.lineData.center.line.getCoordinates();
      const polyline = Polyline.fromObjects(coords, this.isClosed);
      const centerLineRun = new Run(polyline, { startPosition: start, stitchLengthMm });
      return centerLineRun.getStitches(pixelsPerMm);
    } else {
      const capInsetPx = capInsetMm * pixelsPerMm;
      const from = this.lineData.center.lenLocMap.getLocation(capInsetPx);
      const to = this.lineData.center.lenLocMap.getLocation(-capInsetPx);
      const inset = this.lineData.center.locIndex.extractLine(from, to);
      const polyline = Polyline.fromObjects(inset.getCoordinates(), false);
      const centerLineRun = new Run(polyline, { startPosition: start, stitchLengthMm });
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
    const zigZag: LinearRing = geometryFactory.createLinearRing([
      ...zigCoords,
      ...zagCoords.reverse(),
      zigCoords[0],
    ]);
    const zigZagLocIndex = new LocationIndexedLine(zigZag);
    const zigZagStart = zigZagLocIndex.project(new Coordinate(start.x, start.y));
    for (let i = 0, n = zigZag.getNumPoints(); i < n; i++) {
      const coord = zigZag.getCoordinateN((i + zigZagStart.getSegmentIndex()) % n);
      stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.NORMAL));
    }
    return stitches;
  }
}
