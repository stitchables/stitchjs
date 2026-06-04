import {
  Coordinate,
  LinearRing,
  LineString,
  Polygon,
} from 'jsts/org/locationtech/jts/geom';
import { LengthIndexedLine } from 'jsts/org/locationtech/jts/linearref';
import { IRoutedRun } from './IRoutedRun';
import { Vector } from '../../Math/Vector';
import { geometryFactory } from '../../util/jsts';
import { Stitch } from '../Stitch';
import { resample } from '../../Geometry/resample';
import { StitchType } from '../EStitchType';

export default class RoutedRun implements IRoutedRun {
  line: LineString | LinearRing;
  stitchLengthMm: number;
  stitchToleranceMm: number;
  constructor(
    line: Vector[],
    options?: {
      stitchLengthMm?: number;
      stitchToleranceMm?: number;
    },
  ) {
    const coordinates = line.map((v) => new Coordinate(v.x, v.y));
    if (line[0] === line[line.length - 1]) {
      this.line = geometryFactory.createLinearRing(coordinates);
    } else {
      this.line = geometryFactory.createLineString(coordinates);
    }
    this.stitchLengthMm = options?.stitchLengthMm ?? 3;
    this.stitchToleranceMm = options?.stitchToleranceMm ?? 0.1;
  }

  getShape(): Polygon {
    // return this.line;
    return geometryFactory.createPolygon();
  }
  getUnderlayRuns(): IRoutedRun[] {
    return [];
  }
  getUnderlayStitches(): Stitch[] {
    return [];
  }

  getStitches(
    pixelsPerMm: number,
    options?: { entry?: Coordinate; exit?: Coordinate },
  ): Stitch[] {
    const length = this.stitchLengthMm * pixelsPerMm;
    const tolerance = this.stitchToleranceMm * pixelsPerMm;
    const resampled = resample(this.line, length, tolerance);
    const toVector = (c: Coordinate) => new Vector(c.x, c.y);
    const toStitch = (c: Coordinate, stitchType: StitchType) =>
      new Stitch(toVector(c), stitchType);
    // case 0: no entry or exit given
    if (!options || (!options.entry && !options.exit)) {
      const coords: Coordinate[] = resampled.getCoordinates();
      return coords.map((c) => toStitch(c, StitchType.NORMAL));
    }
    // get the line length and create the length index
    const lineLength = resampled.getLength();
    const lengthIndex = new LengthIndexedLine(resampled);
    // figure out the optimal entry and exit
    let entryLength, exitLength;
    if (options.entry) {
      entryLength = lengthIndex.project(options.entry);
      if (!options.exit) {
        if (this.line instanceof LinearRing) {
          exitLength = entryLength;
        } else {
          exitLength = entryLength <= 0.5 * lineLength ? lineLength : 0;
        }
      }
    }
    if (options.exit) {
      exitLength = lengthIndex.project(options.exit);
      if (!options.entry) {
        if (this.line instanceof LinearRing) {
          entryLength = exitLength;
        } else {
          entryLength = exitLength <= 0.5 * lineLength ? lineLength : 0;
        }
      }
    }
    const entryCoordinate = lengthIndex.extractPoint(entryLength);
    const entryVector = new Vector(entryCoordinate.x, entryCoordinate.y);
    const entryStitch = new Stitch(entryVector, StitchType.START);
    const exitCoordinate = lengthIndex.extractPoint(exitLength);
    const exitVector = new Vector(exitCoordinate.x, exitCoordinate.y);
    const exitStitch = new Stitch(exitVector, StitchType.STOP);
    // case 1: same entry and exit points
    if (entryLength === exitLength) {
      const line1: Coordinate[] = lengthIndex
        .extractLine(entryLength, 0)
        .getCoordinates();
      line1.shift(); // remove the entry
      const line2: Coordinate[] = lengthIndex
        .extractLine(lineLength, exitLength)
        .getCoordinates();
      line2.pop(); // remove the exit
      // case 1a: ring with same entry and exit points
      if (this.line instanceof LinearRing) {
        line2.shift(); // remove the overlap
        const stitch1 = line1.map((c) => toStitch(c, StitchType.NORMAL));
        const stitch2 = line2.map((c) => toStitch(c, StitchType.NORMAL));
        return [entryStitch, ...stitch1, ...stitch2, exitStitch];
      }
      // case 1b: non-ring with same entry and exit points
      line1.pop(); // remove the first point
      line2.shift(); // remove the last point
      const stitches = resampled
        .getCoordinates()
        .map((c: Coordinate) => toStitch(c, StitchType.NORMAL));
      return [
        entryStitch,
        ...line1.map((c) => toStitch(c, StitchType.TRAVEL)),
        ...stitches,
        ...line2.map((c) => toStitch(c, StitchType.TRAVEL)),
        exitStitch,
      ];
    }
    // get the nearest lengths
    let l1 = 0,
      l2 = lineLength;
    if (entryLength > exitLength) [l1, l2] = [l2, l1];
    // case 2: ring with different entry and exit points
    if (this.line instanceof LinearRing) {
      const stitch1: Coordinate[] = lengthIndex
        .extractLine(exitLength, l2)
        .getCoordinates();
      const stitch2: Coordinate[] = lengthIndex
        .extractLine(l1, exitLength)
        .getCoordinates();
      stitch2.pop(); // remove the exit
      stitch2.shift(); // remove the overlap
      const stitches = [
        ...stitch1.map((c) => toStitch(c, StitchType.NORMAL)),
        ...stitch2.map((c) => toStitch(c, StitchType.NORMAL)),
      ];
      let travel: Stitch[];
      if (Math.abs(entryLength - exitLength) <= 0.5 * lineLength) {
        const travelLine = lengthIndex.extractLine(entryLength, exitLength);
        travel = travelLine
          .getCoordinates()
          .map((c: Coordinate) => toStitch(c, StitchType.TRAVEL));
        travel.shift(); // remove entry
        travel.pop(); // remove exit
      } else {
        const travelLine1 = lengthIndex.extractLine(entryLength, l1);
        const travel1 = travelLine1
          .getCoordinates()
          .map((c: Coordinate) => toStitch(c, StitchType.TRAVEL));
        travel1.shift(); // remove the entry
        const travelLine2 = lengthIndex.extractLine(l2, exitLength);
        const travel2 = travelLine2
          .getCoordinates()
          .map((c: Coordinate) => toStitch(c, StitchType.TRAVEL));
        travel2.shift(); // remove overlap
        travel2.pop(); // remove the exit
        travel = [...travel1, ...travel2];
      }
      return [entryStitch, ...travel, ...stitches, exitStitch];
    }
    // case 3: non-ring with different entry and exit points
    const travel1 = lengthIndex
      .extractLine(entryLength, l1)
      .getCoordinates()
      .map((c: Coordinate) => toStitch(c, StitchType.TRAVEL));
    travel1.pop(); // remove end point
    travel1.shift(); // remove entry
    const travel2 = lengthIndex
      .extractLine(l2, exitLength)
      .getCoordinates()
      .map((c: Coordinate) => toStitch(c, StitchType.TRAVEL));
    travel2.pop(); // remove exit
    travel2.shift(); // remove end point
    const stitches = lengthIndex
      .extractLine(l1, l2)
      .getCoordinates()
      .map((c: Coordinate) => toStitch(c, StitchType.NORMAL));
    return [entryStitch, ...travel1, ...stitches, ...travel2, exitStitch];
  }
}
