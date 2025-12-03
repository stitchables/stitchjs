import { Vector } from '../../Math/Vector';
import { IRun } from '../IRun';
import { Stitch } from '../Stitch';
import { StitchType } from '../EStitchType';
import { Coordinate, LineString } from 'jsts/org/locationtech/jts/geom';
import { LengthIndexedLine } from 'jsts/org/locationtech/jts/linearref';
import { geometryFactory } from '../../util/jsts';

export class Run implements IRun {
  // Turn a continuous path into a running stitch with as close to even stitch length as
  // possible while keeping it within the tolerance of the path
  vertices: Vector[];
  line: LineString;
  lineIndex: LengthIndexedLine;
  startPosition: Vector | undefined;
  endPosition: Vector | undefined;
  stitchLengthMm: number;
  stitchToleranceMm: number;
  travelLengthMm: number;
  travelToleranceMm: number;
  isClosed: boolean;
  constructor(
    vertices: Vector[],
    options?: {
      startPosition?: Vector;
      endPosition?: Vector;
      stitchLengthMm?: number;
      stitchToleranceMm?: number;
      travelLengthMm?: number;
      travelToleranceMm?: number;
    },
  ) {
    this.vertices = vertices;
    this.line = geometryFactory.createLineString(
      this.vertices.map((v) => new Coordinate(v.x, v.y)),
    );
    this.lineIndex = new LengthIndexedLine(this.line);
    if (this.vertices.length < 2) this.isClosed = false;
    else
      this.isClosed =
        this.vertices[0].distance(this.vertices[this.vertices.length - 1]) < 1e-7;
    this.startPosition = options?.startPosition;
    this.endPosition = options?.endPosition;
    this.stitchLengthMm = options?.stitchLengthMm ?? 3;
    this.stitchToleranceMm = options?.stitchToleranceMm ?? 1;
    this.travelLengthMm = options?.travelLengthMm ?? 3;
    this.travelToleranceMm = options?.travelToleranceMm ?? 1;
  }

  getStartAndEndPositions(run: LineString, runIndex: LengthIndexedLine): Coordinate[] {
    const s = this.startPosition
      ? new Coordinate(this.startPosition?.x, this.startPosition?.y)
      : undefined;
    const e = this.endPosition
      ? new Coordinate(this.endPosition?.x, this.endPosition?.y)
      : undefined;
    if (s && e) return [s, e];
    if (s) {
      if (this.isClosed) return [s, s];
      const length = run.getLength();
      const proj = runIndex.project(s);
      if (proj < 0.5 * length) return [s, run.getCoordinateN(run.getNumPoints() - 1)];
      return [s, run.getCoordinateN(0)];
    }
    if (e) {
      if (this.isClosed) return [e, e];
      const length = run.getLength();
      const proj = runIndex.project(e);
      if (proj < 0.5 * length) return [run.getCoordinateN(run.getNumPoints() - 1), e];
      return [run.getCoordinateN(0), e];
    }
    if (this.isClosed) return [run.getCoordinateN(0), run.getCoordinateN(0)];
    return [run.getCoordinateN(0), run.getCoordinateN(run.getNumPoints() - 1)];
  }

  splitPath(line: Vector[], tolerancePx: number): Vector[][] {
    if (line.length < 3) return [line.slice()];
    const splits: Vector[][] = [];
    let last = 0;
    let lastSeg = line[1].subtract(line[0]);
    let segLen = lastSeg.length();
    for (let i = 1; i < line.length - 1; i++) {
      const a = lastSeg;
      const b = line[i + 1].subtract(line[i]);
      const [aa, bb, ab] = [a.dot(a), b.dot(b), a.dot(b)];
      const aabb = aa * bb;
      const abab = ab * Math.abs(ab);
      if (aabb > 0 && abab <= 0.5 * aabb) {
        if (segLen >= tolerancePx) {
          splits.push(line.slice(last, i + 1));
          last = i;
        }
        segLen = 0;
      }
      if (bb > 0) {
        lastSeg = b;
      }
      segLen += b.length();
    }
    splits.push(line.slice(last));
    return splits;
  }

  resampleEvenly(
    vertices: Vector[],
    stitchLengthPx: number,
    tolerancePx: number,
  ): Vector[] {
    const resampled: Vector[] = [];
    if (vertices.length < 2) return resampled;
    const distLeft = new Array(vertices.length).fill(0);
    for (let j = vertices.length - 2; j >= 0; j--) {
      distLeft[j] = distLeft[j + 1] + vertices[j].distance(vertices[j + 1]);
    }
    let i: number | undefined = 1;
    let last = vertices[0];
    while (i !== undefined && i < vertices.length) {
      const d = last.distance(vertices[i]) + distLeft[i];
      if (d === 0) return resampled;
      const length = d / Math.ceil(d / stitchLengthPx) + 0.000001;
      const { p, idx } = this.takeStitch(last, vertices, i, length, tolerancePx);
      i = idx;
      if (p !== undefined) {
        resampled.push(p);
        last = p;
      }
    }
    return resampled;
  }

  takeStitch(
    start: Vector,
    points: Vector[],
    idx: number,
    stitchLengthPx: number,
    tolerancePx: number,
  ): { p: Vector | undefined; idx: number | undefined } {
    // Based on a single step of the Zhao-Saalfeld curve simplification algorithm.
    // https://cartogis.org/docs/proceedings/archive/auto-carto-13/pdf/linear-time-sleeve-fitting-polyline-simplification-algorithms.pdf
    // Adds early termination condition based on stitch length.
    if (idx >= points.length) return { p: undefined, idx: undefined };
    let sleeve: AngleInterval | undefined = AngleInterval.all();
    let last = start;
    for (let i = idx; i < points.length; i++) {
      const p = points[i];
      const rel = p.subtract(start);
      if (sleeve?.containsPoint(rel)) {
        if (start.distance(p) < stitchLengthPx) {
          sleeve = sleeve?.intersect(AngleInterval.fromBall(rel, tolerancePx));
          last = p;
        } else {
          const cut = cutSegmentWithCircle(start, stitchLengthPx, last, p);
          return { p: cut, idx: i };
        }
      } else {
        let cut = sleeve?.cutSegment(start, last, p);
        if (cut && start.distance(cut) > stitchLengthPx) {
          cut = cutSegmentWithCircle(start, stitchLengthPx, last, p);
        }
        return { p: cut, idx: i };
      }
    }
    return { p: points[points.length - 1], idx: undefined };
  }

  evenRunLine(line: LineString, lengthPx: number, tolerancePx: number): LineString {
    const vertices = line.getCoordinates().map((c: Coordinate) => new Vector(c.x, c.y));
    const runCoords: Coordinate[] = [line.getCoordinateN(0)];
    for (const split of this.splitPath(vertices, 2 * tolerancePx)) {
      const resampled = this.resampleEvenly(split, lengthPx, tolerancePx);
      runCoords.push(...resampled.map((v) => new Coordinate(v.x, v.y)));
    }
    return geometryFactory.createLineString(runCoords);
  }

  getStitches(pixelsPerMm: number): Stitch[] {
    const stitches: Stitch[] = [];

    const stitchLengthPx = this.stitchLengthMm * pixelsPerMm;
    const stitchTolerancePx = this.stitchToleranceMm * pixelsPerMm;
    const travelLengthPx = this.travelLengthMm * pixelsPerMm;
    const travelTolerancePx = this.travelToleranceMm * pixelsPerMm;

    const [start, end] = this.getStartAndEndPositions(this.line, this.lineIndex);
    const startProjLength = this.lineIndex.project(start);
    const startProjCoord = this.lineIndex.extractPoint(startProjLength);
    const endProjLength = this.lineIndex.project(end);
    const endProjCoord = this.lineIndex.extractPoint(endProjLength);
    const l1 = startProjLength < endProjLength ? 0 : this.line.getLength();
    const l2 = startProjLength < endProjLength ? this.line.getLength() : 0;

    // if necessary jump from start to start projection
    if (start.distance(startProjCoord) > pixelsPerMm) {
      const startProjVec = new Vector(startProjCoord.x, startProjCoord.y);
      stitches.push(new Stitch(startProjVec, StitchType.JUMP));
    }

    // if necessary travel from start projection to one end of the run
    // pick the end that results in the least amount of travel
    // if run is closed just take the shortest route to the end projection
    let startExtract: LineString | undefined = undefined;
    if (this.isClosed) {
      if (startProjCoord.distance(endProjCoord) > 1e-7) {
        if (Math.abs(startProjLength - endProjLength) < 0.5 * this.line.getLength()) {
          startExtract = this.lineIndex.extractLine(startProjLength, endProjLength);
        } else {
          startExtract = geometryFactory.createLineString([
            ...this.lineIndex.extractLine(startProjLength, l1).getCoordinates(),
            ...this.lineIndex.extractLine(l2, endProjLength).getCoordinates().slice(1),
          ]);
        }
      }
    } else if (startProjLength > 0 && startProjLength < this.line.getLength()) {
      startExtract = this.lineIndex.extractLine(startProjLength, l1);
    }
    if (startExtract) {
      const startTravel = this.evenRunLine(
        startExtract,
        travelLengthPx,
        travelTolerancePx,
      );
      for (let i = 1, n = startTravel.getNumPoints(); i < n; i++) {
        const coord = startTravel.getCoordinateN(i);
        stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.TRAVEL));
      }
    }

    // main run
    const main = this.isClosed
      ? geometryFactory.createLineString([
        ...this.lineIndex.extractLine(endProjLength, l1).getCoordinates(),
        ...this.lineIndex.extractLine(l2, endProjLength).getCoordinates().slice(1),
      ])
      : geometryFactory.createLineString([
        ...this.lineIndex.extractLine(l1, l2).getCoordinates(),
      ]);
    const mainRun = this.evenRunLine(main, stitchLengthPx, stitchTolerancePx);
    for (let i = 1, n = mainRun.getNumPoints(); i < n; i++) {
      const coord = mainRun.getCoordinateN(i);
      stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.NORMAL));
    }

    // travel from other end of the run to the end projection
    if (!this.isClosed && endProjLength > 0 && endProjLength < this.line.getLength()) {
      const endExtract = this.lineIndex.extractLine(l2, endProjLength);
      const endTravel = this.evenRunLine(endExtract, travelLengthPx, travelTolerancePx);
      for (let i = 1, n = endTravel.getNumPoints(); i < n; i++) {
        const coord = endTravel.getCoordinateN(i);
        stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.TRAVEL));
      }
    }

    // jump from the end projection to the end
    if (end.distance(endProjCoord) > pixelsPerMm) {
      stitches.push(new Stitch(new Vector(end.x, end.y), StitchType.JUMP));
    }

    return stitches;
    // const simplified: LineString | LinearRing = DouglasPeuckerSimplifier.simplify(
    //   this.line,
    //   pixelsPerMm,
    // );
    // const stitchLengthPx = this.stitchLengthMm * pixelsPerMm;
    // const resamp = this.getResampled(simplified, stitchLengthPx);
    // const length = resamp.getLength();
    // const index = new LengthIndexedLine(resamp);
    // const startLen = index.project(this.startPosition);
    // const start = index.extractPoint(startLen);
    // const endLen = index.project(this.endPosition);
    // const end = index.extractPoint(endLen);
    //
    // const stitches: Stitch[] = [];
    //
    // // travel from start to start projection
    // if (this.startPosition.distance(start) > stitchLengthPx) {
    //   const line = geometryFactory.createLineString([this.startPosition, start]);
    //   const lineResamp = this.getResampled(line, stitchLengthPx);
    //   for (let i = 1, n = lineResamp.getNumPoints(); i < n; i++) {
    //     const coord = lineResamp.getCoordinateN(i);
    //     stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.TRAVEL));
    //   }
    // } else {
    //   stitches.push(new Stitch(new Vector(start.x, start.y), StitchType.TRAVEL));
    // }
    //
    // const l1 = startLen < endLen ? 0 : length;
    // const l2 = startLen < endLen ? length : 0;
    // if (this.line.getGeometryType() === 'LinearRing') {
    //   // if necessary travel from start to end (pick the shortest route)
    //   if (startLen !== endLen) {
    //     if (Math.abs(startLen - endLen) < 0.5 * length) {
    //       stitches.push(
    //         ...this.extractStitches(index, startLen, endLen, StitchType.TRAVEL),
    //       );
    //     } else {
    //       stitches.push(...this.extractStitches(index, startLen, l1, StitchType.TRAVEL));
    //       stitches.push(...this.extractStitches(index, l2, endLen, StitchType.TRAVEL));
    //     }
    //   }
    //   // add the normal stitches for the run
    //   stitches.push(...this.extractStitches(index, endLen, length, StitchType.NORMAL));
    //   stitches.push(...this.extractStitches(index, 0, endLen, StitchType.NORMAL));
    // } else {
    //   stitches.push(...this.extractStitches(index, startLen, l1, StitchType.TRAVEL));
    //   stitches.push(...this.extractStitches(index, l1, l2, StitchType.NORMAL));
    //   stitches.push(...this.extractStitches(index, l2, endLen, StitchType.TRAVEL));
    // }
    //
    // // travel from end projection to end
    // if (this.endPosition.distance(end) > stitchLengthPx) {
    //   const line = geometryFactory.createLineString([end, this.endPosition]);
    //   const lineResamp = this.getResampled(line, stitchLengthPx);
    //   for (let i = 1, n = lineResamp.getNumPoints(); i < n; i++) {
    //     const coord = lineResamp.getCoordinateN(i);
    //     stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.TRAVEL));
    //   }
    // } else {
    //   stitches.push(
    //     new Stitch(new Vector(this.endPosition.x, this.endPosition.y), StitchType.TRAVEL),
    //   );
    // }
    //
    // return stitches;
  }
}

function cutSegmentWithAngle(
  origin: Vector,
  angle: number,
  a: Vector,
  b: Vector,
): Vector {
  const p = a.subtract(origin);
  const d = b.subtract(a);
  const c = Vector.fromAngle(angle);
  const t = (p.y * c.x - p.x * c.y) / (d.x * c.y - d.y * c.x);
  if (t < 1e-7 || t > 1 + 1e-7) {
    console.warn(
      `cutSegmentWithAngle returned a parameter of ${t} with points ${p} ${b.subtract(origin)} and cut line ${c}`,
    );
  }
  return a.add(d.multiply(t));
}

function cutSegmentWithCircle(origin: Vector, r: number, a: Vector, b: Vector): Vector {
  const p = a.subtract(origin);
  const d = b.subtract(a);
  const p2 = p.dot(p);
  const d2 = d.dot(d);
  const r2 = r * r;
  const pd = p.dot(d);
  const t = (Math.sqrt(pd * pd + r2 * d2 - p2 * d2) - pd) / d2;
  if (t < 1e-7 || t > 1 + 1e-7) {
    console.warn(`cutSegmentWithCircle returned a parameter of ${t}`);
  }
  return a.add(d.multiply(t));
}

const TAU = 2 * Math.PI;
export class AngleInterval {
  // Modular interval containing either the entire circle or less than half of it
  // Partially based on https://fgiesen.wordpress.com/2015/09/24/intervals-in-modular-arithmetic/

  a: number;
  b: number;
  isAll: boolean;

  constructor(a: number, b: number, isAll: boolean = false) {
    this.a = a;
    this.b = b;
    this.isAll = isAll;
  }

  static all(): AngleInterval {
    return new AngleInterval(0, TAU, true);
  }

  static fromBall(p: Vector, epsilon: number): AngleInterval {
    const d = p.length();
    if (d <= epsilon) {
      return AngleInterval.all();
    }
    const center = p.heading();
    const delta = Math.asin(epsilon / d);
    return new AngleInterval(center - delta, center + delta);
  }

  static fromSegment(a: Vector, b: Vector): AngleInterval | undefined {
    const angleA = a.heading();
    const angleB = b.heading();
    const diffRaw = angleB - angleA;
    const diff = ((diffRaw % TAU) + TAU) % TAU;
    if (diff === 0 || diff === Math.PI) {
      return undefined;
    } else if (diff < Math.PI) {
      return new AngleInterval(angleA - 1e-6, angleB + 1e-6);
    } else {
      return new AngleInterval(angleB - 1e-6, angleA + 1e-6);
    }
  }

  containsAngle(angle: number): boolean {
    if (this.isAll) return true;
    const span = (((this.b - this.a) % TAU) + TAU) % TAU;
    const offset = (((angle - this.a) % TAU) + TAU) % TAU;
    return offset <= span;
  }

  containsPoint(p: Vector): boolean {
    return this.containsAngle(p.heading());
  }

  intersect(other: AngleInterval | undefined): AngleInterval | undefined {
    if (other === undefined) return undefined;
    if (this.isAll) return other;
    if (other.isAll) return this;
    if (this.containsAngle(other.a)) {
      if (other.containsAngle(this.b)) return new AngleInterval(other.a, this.b);
      return new AngleInterval(other.a, other.b);
    }
    if (other.containsAngle(this.a)) {
      if (this.containsAngle(other.b)) return new AngleInterval(this.a, other.b);
      return new AngleInterval(this.a, this.b);
    }
    return undefined;
  }

  cutSegment(origin: Vector, a: Vector, b: Vector): Vector | undefined {
    if (this.isAll) return undefined;
    const segArc = AngleInterval.fromSegment(a.subtract(origin), b.subtract(origin));
    if (segArc === undefined) return a;
    if (segArc.containsAngle(this.a)) return cutSegmentWithAngle(origin, this.a, a, b);
    if (segArc.containsAngle(this.b)) return cutSegmentWithAngle(origin, this.b, a, b);
    return undefined;
  }
}
