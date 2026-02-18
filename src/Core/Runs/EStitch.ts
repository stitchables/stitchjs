import { IRun } from '../IRun';
import { Vector } from '../../Math/Vector';
import { Coordinate, LineString } from 'jsts/org/locationtech/jts/geom';
import { LengthIndexedLine } from 'jsts/org/locationtech/jts/linearref';
import { geometryFactory } from '../../util/jsts';
import { Stitch } from '../Stitch';
import { resample } from '../../Geometry/resample';
import { StitchType } from '../EStitchType';

export class EStitch implements IRun {
  geometry: LineString;
  index: LengthIndexedLine;
  isClosed: boolean;
  startPosition: Vector | undefined;
  endPosition: Vector | undefined;
  widthMm: number;
  isFlipped: boolean;
  stitchLengthMm: number;
  stitchToleranceMm: number;
  travelLengthMm: number;
  travelToleranceMm: number;
  constructor(
    vertices: Vector[],
    options?: {
      startPosition?: Vector;
      endPosition?: Vector;
      widthMm?: number;
      isFlipped?: boolean;
      stitchLengthMm?: number;
      stitchToleranceMm?: number;
      travelLengthMm?: number;
      travelToleranceMm?: number;
    },
  ) {
    const coords = vertices.map((v) => new Coordinate(v.x, v.y));
    this.geometry = geometryFactory.createLineString(coords);
    this.index = new LengthIndexedLine(this.geometry);
    this.isClosed = vertices[0].distance(vertices[vertices.length - 1]) < 1e-7;
    this.startPosition = options?.startPosition;
    this.endPosition = options?.endPosition;
    this.widthMm = Math.max(options?.widthMm ?? 3, 0.1);
    this.isFlipped = options?.isFlipped ?? false;
    this.stitchLengthMm = Math.max(options?.stitchLengthMm ?? 3, 0.1);
    this.stitchToleranceMm = Math.max(options?.stitchToleranceMm ?? 1, 0.01);
    this.travelLengthMm = Math.max(options?.travelLengthMm ?? 3, 0.1);
    this.travelToleranceMm = Math.max(options?.travelToleranceMm ?? 1, 0.01);
  }
  getStartAndEndProjections(): { start: Coordinate; end: Coordinate } {
    if (this.startPosition === undefined && this.endPosition === undefined) {
      return {
        start: this.geometry.getCoordinateN(0),
        end: this.geometry.getCoordinateN(this.geometry.getNumPoints() - 1),
      };
    }
    const start =
      this.startPosition === undefined
        ? this.geometry.getCoordinateN(0)
        : new Coordinate(this.startPosition.x, this.startPosition.y);
    const end =
      this.endPosition === undefined
        ? this.geometry.getCoordinateN(this.geometry.getNumPoints() - 1)
        : new Coordinate(this.endPosition.x, this.endPosition.y);
    const startProjection = this.index.project(start);
    const endProjection = this.index.project(end);
    if (this.startPosition !== undefined && this.endPosition !== undefined) {
      return {
        start: this.index.extractPoint(startProjection),
        end: this.index.extractPoint(endProjection),
      };
    }
    const length = this.geometry.getLength();
    if (this.startPosition !== undefined && this.endPosition === undefined) {
      if (this.isClosed) {
        return {
          start: this.index.extractPoint(startProjection),
          end: this.index.extractPoint(startProjection),
        };
      } else {
        return {
          start: this.index.extractPoint(startProjection),
          end: this.index.extractPoint(startProjection <= 0.5 * length ? 1 : 0),
        };
      }
    }
    if (this.isClosed) {
      return {
        start: this.index.extractPoint(endProjection),
        end: this.index.extractPoint(endProjection),
      };
    } else {
      return {
        start: this.index.extractPoint(endProjection <= 0.5 * length ? 1 : 0),
        end: this.index.extractPoint(endProjection),
      };
    }
  }
  getStitches(pixelsPerMm: number): Stitch[] {
    const stitchLengthPx = this.stitchLengthMm * pixelsPerMm;
    const stitchTolerancePx = this.stitchToleranceMm * pixelsPerMm;
    const travelLengthPx = this.travelLengthMm * pixelsPerMm;
    const travelTolerancePx = this.travelToleranceMm * pixelsPerMm;
    const widthPx = this.widthMm * pixelsPerMm;
    const length = this.geometry.getLength();

    const { start, end } = this.getStartAndEndProjections();
    const startProjLength = this.index.project(start);
    const endProjLength = this.index.project(end);
    const l1 = startProjLength < endProjLength ? 0 : length;
    const l2 = startProjLength < endProjLength ? length : 0;

    const stitches: Stitch[] = [];

    if (Math.abs(startProjLength - l1) > travelLengthPx) {
      const startTravel = resample(
        this.index.extractLine(startProjLength, l1),
        travelLengthPx,
        travelTolerancePx,
      );
      for (let i = 0, n = startTravel.getNumPoints(); i < n; i++) {
        const coord = startTravel.getCoordinateN(i);
        stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.TRAVEL));
      }
    }

    const run = resample(
      this.index.extractLine(l1, l2),
      stitchLengthPx,
      stitchTolerancePx,
    );
    for (let i = 0, n = run.getNumPoints(); i < n; i++) {
      const prev = i === 0 ? undefined : run.getCoordinateN(i - 1);
      const curr = run.getCoordinateN(i);
      const next = i === n - 1 ? undefined : run.getCoordinateN(i + 1);
      const normal: Coordinate = normalAtPoint(curr, prev, next);
      const offset = this.isFlipped
        ? new Vector(curr.x + widthPx * normal.x, curr.y + widthPx * normal.y)
        : new Vector(curr.x - widthPx * normal.x, curr.y - widthPx * normal.y);
      stitches.push(new Stitch(new Vector(curr.x, curr.y), StitchType.NORMAL));
      stitches.push(new Stitch(offset, StitchType.NORMAL));
      stitches.push(new Stitch(new Vector(curr.x, curr.y), StitchType.NORMAL));
    }

    if (Math.abs(endProjLength - l2) > travelLengthPx) {
      const endTravel = resample(
        this.index.extractLine(l2, endProjLength),
        travelLengthPx,
        travelTolerancePx,
      );
      for (let i = 0, n = endTravel.getNumPoints(); i < n; i++) {
        const coord = endTravel.getCoordinateN(i);
        stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.TRAVEL));
      }
    }

    return stitches;
  }
}

function normalAtPoint(
  curr: Coordinate,
  prev?: Coordinate,
  next?: Coordinate,
): Coordinate {
  let tx = 0;
  let ty = 0;

  if (prev && next) {
    // Central difference (best)
    tx = next.x - prev.x;
    ty = next.y - prev.y;
  } else if (next) {
    // Forward difference (start of curve)
    tx = next.x - curr.x;
    ty = next.y - curr.y;
  } else if (prev) {
    // Backward difference (end of curve)
    tx = curr.x - prev.x;
    ty = curr.y - prev.y;
  } else {
    // Isolated point
    return new Coordinate(0, 0);
  }

  const tlen = Math.hypot(tx, ty);
  if (tlen === 0) return new Coordinate(0, 0);

  // Normalize tangent
  tx /= tlen;
  ty /= tlen;

  // Left-hand normal (rotate tangent 90° CCW)
  return new Coordinate(-ty, tx);
}
