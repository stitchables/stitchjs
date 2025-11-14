import { Polyline } from '../../Math/Polyline';
import { Vector } from '../../Math/Vector';
import { IRun } from '../IRun';
import { Stitch } from '../Stitch';
import { Coordinate, LinearRing, LineString } from 'jsts/org/locationtech/jts/geom';
import {
  LengthIndexedLine,
  LinearGeometryBuilder,
} from 'jsts/org/locationtech/jts/linearref';
import { DouglasPeuckerSimplifier } from 'jsts/org/locationtech/jts/simplify';
import { geometryFactory } from '../../util/jsts';
import { StitchType } from '../EStitchType';

export class Run implements IRun {
  line: LineString | LinearRing;
  stitchLengthMm: number;
  startPosition: Coordinate;
  endPosition: Coordinate;
  constructor(
    polyline: Polyline,
    options?: {
      startPosition?: Vector;
      endPosition?: Vector;
      stitchLengthMm?: number;
    },
  ) {
    const lineBuilder = new LinearGeometryBuilder(geometryFactory);
    for (const v of polyline.vertices) lineBuilder.add(new Coordinate(v.x, v.y));
    if (polyline.isClosed)
      lineBuilder.add(new Coordinate(polyline.vertices[0].x, polyline.vertices[0].y));
    this.line = lineBuilder.getGeometry();
    this.stitchLengthMm = options?.stitchLengthMm ?? 3;
    [this.startPosition, this.endPosition] = this.getStartAndEndPositions(
      options?.startPosition,
      options?.endPosition,
    );
  }

  getStartAndEndPositions(
    start: Vector | undefined,
    end: Vector | undefined,
  ): Coordinate[] {
    const s = start ? new Coordinate(start.x, start.y) : undefined;
    const e = end ? new Coordinate(end.x, end.y) : undefined;
    if (s && e) return [s, e];
    if (s) {
      if (this.line.getGeometryType() === 'LinearRing') return [s, s];
      const length = this.line.getLength();
      const index = new LengthIndexedLine(this.line);
      const proj = index.project(s);
      if (proj < 0.5 * length)
        return [s, this.line.getCoordinateN(this.line.getNumPoints() - 1)];
      return [s, this.line.getCoordinateN(0)];
    }
    if (e) {
      if (this.line.getGeometryType() === 'LinearRing') return [e, e];
      const length = this.line.getLength();
      const index = new LengthIndexedLine(this.line);
      const proj = index.project(e);
      if (proj < 0.5 * length)
        return [this.line.getCoordinateN(this.line.getNumPoints() - 1), e];
      return [this.line.getCoordinateN(0), e];
    }
    if (this.line.getGeometryType() === 'LinearRing')
      return [this.line.getCoordinateN(0), this.line.getCoordinateN(0)];
    return [
      this.line.getCoordinateN(0),
      this.line.getCoordinateN(this.line.getNumPoints() - 1),
    ];
  }

  getResampled(
    line: LineString | LinearRing,
    spacingPx: number,
  ): LineString | LinearRing {
    const resampledCoordinates = [line.getCoordinateN(0)];
    const length = line.getLength();
    if (length < spacingPx) return line;
    const lengthIndex = new LengthIndexedLine(line);
    const samples = Math.round(length / spacingPx);
    for (let i = 1; i < samples; i++) {
      resampledCoordinates.push(lengthIndex.extractPoint((length * i) / samples));
    }
    if (line.getGeometryType() === 'LinearRing') {
      resampledCoordinates.push(resampledCoordinates[0]);
      return geometryFactory.createLinearRing(resampledCoordinates);
    } else {
      resampledCoordinates.push(line.getCoordinateN(line.getNumPoints() - 1));
      return geometryFactory.createLineString(resampledCoordinates);
    }
  }

  getStitches(pixelsPerMm: number): Stitch[] {
    const simplified: LineString | LinearRing = DouglasPeuckerSimplifier.simplify(
      this.line,
      pixelsPerMm,
    );
    const stitchLengthPx = this.stitchLengthMm * pixelsPerMm;
    const resamp = this.getResampled(simplified, stitchLengthPx);
    const length = resamp.getLength();
    const index = new LengthIndexedLine(resamp);
    const startLen = index.project(this.startPosition);
    const start = index.extractPoint(startLen);
    const endLen = index.project(this.endPosition);
    const end = index.extractPoint(endLen);

    const stitches: Stitch[] = [];

    // travel from start to start projection
    if (this.startPosition.distance(start) > stitchLengthPx) {
      const line = geometryFactory.createLineString([this.startPosition, start]);
      const lineResamp = this.getResampled(line, stitchLengthPx);
      for (let i = 1, n = lineResamp.getNumPoints(); i < n; i++) {
        const coord = lineResamp.getCoordinateN(i);
        stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.TRAVEL));
      }
    } else {
      stitches.push(new Stitch(new Vector(start.x, start.y), StitchType.TRAVEL));
    }

    const l1 = startLen < endLen ? 0 : length;
    const l2 = startLen < endLen ? length : 0;
    if (this.line.getGeometryType() === 'LinearRing') {
      // if necessary travel from start to end (pick the shortest route)
      if (startLen !== endLen) {
        if (Math.abs(startLen - endLen) < 0.5 * length) {
          stitches.push(
            ...this.extractStitches(index, startLen, endLen, StitchType.TRAVEL),
          );
        } else {
          stitches.push(...this.extractStitches(index, startLen, l1, StitchType.TRAVEL));
          stitches.push(...this.extractStitches(index, l2, endLen, StitchType.TRAVEL));
        }
      }
      // add the normal stitches for the run
      stitches.push(...this.extractStitches(index, endLen, length, StitchType.NORMAL));
      stitches.push(...this.extractStitches(index, 0, endLen, StitchType.NORMAL));
    } else {
      stitches.push(...this.extractStitches(index, startLen, l1, StitchType.TRAVEL));
      stitches.push(...this.extractStitches(index, l1, l2, StitchType.NORMAL));
      stitches.push(...this.extractStitches(index, l2, endLen, StitchType.TRAVEL));
    }

    // travel from end projection to end
    if (this.endPosition.distance(end) > stitchLengthPx) {
      const line = geometryFactory.createLineString([end, this.endPosition]);
      const lineResamp = this.getResampled(line, stitchLengthPx);
      for (let i = 1, n = lineResamp.getNumPoints(); i < n; i++) {
        const coord = lineResamp.getCoordinateN(i);
        stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.TRAVEL));
      }
    } else {
      stitches.push(
        new Stitch(new Vector(this.endPosition.x, this.endPosition.y), StitchType.TRAVEL),
      );
    }

    return stitches;
  }

  extractStitches(
    lengthIndex: LengthIndexedLine,
    from: number,
    to: number,
    stitchType: StitchType,
  ) {
    const stitches: Stitch[] = [];
    const line = lengthIndex.extractLine(from, to);
    for (let i = 1, n = line.getNumPoints(); i < n; i++) {
      const coord = line.getCoordinateN(i);
      stitches.push(new Stitch(new Vector(coord.x, coord.y), stitchType));
    }
    return stitches;
  }
}
