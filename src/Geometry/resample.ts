import { Vector } from '../Math/Vector';
import { geometryFactory } from '../util/jsts';
import { Coordinate, LineString } from 'jsts/org/locationtech/jts/geom';

// Turn a continuous path into a path with even length segments.
// Creates points as close to even length as possible (including first and
// last segments), keeping within the tolerance of the path.
export function resample(
  line: LineString,
  lengthPx: number,
  tolerancePx: number,
): LineString {
  const vertices = line.getCoordinates().map((c: Coordinate) => new Vector(c.x, c.y));
  const runCoords: Coordinate[] = [line.getCoordinateN(0)];
  for (const split of splitPath(vertices, 2 * tolerancePx)) {
    const resampled = resampleEvenly(split, lengthPx, tolerancePx);
    runCoords.push(...resampled.map((v) => new Coordinate(v.x, v.y)));
  }
  return geometryFactory.createLineString(runCoords);
}

// Split a path at obvious corner points so they don't get "rounded" off.
// tolerancePx controls the minimum length after splitting for which it won't
// split again, used to avoid creating large numbers of corner points when
// encountering micro-messes.
function splitPath(line: Vector[], tolerancePx: number): Vector[][] {
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

// Resample a curve into even-length segments while handling curves correctly.
// Includes end point but not start point.
function resampleEvenly(
  vertices: Vector[],
  lengthPx: number,
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
    const length = d / Math.ceil(d / lengthPx) + 0.000001;
    const { p, idx } = takePoint(last, vertices, i, length, tolerancePx);
    i = idx;
    if (p !== undefined) {
      resampled.push(p);
      last = p;
    }
  }
  return resampled;
}

// Take a single point based on the Zhao-Saalfeld curve simplification algorithm.
// Based on: https://cartogis.org/docs/proceedings/archive/auto-carto-13/pdf/
// linear-time-sleeve-fitting-polyline-simplification-algorithms.pdf
function takePoint(
  start: Vector,
  points: Vector[],
  idx: number,
  lengthPx: number,
  tolerancePx: number,
): { p: Vector | undefined; idx: number | undefined } {
  if (idx >= points.length) return { p: undefined, idx: undefined };
  let sleeve: AngleInterval | undefined = AngleInterval.all();
  let last = start;
  for (let i = idx; i < points.length; i++) {
    const p = points[i];
    const rel = p.subtract(start);
    if (sleeve?.containsPoint(rel)) {
      if (start.distance(p) < lengthPx) {
        sleeve = sleeve?.intersect(AngleInterval.fromBall(rel, tolerancePx));
        last = p;
      } else {
        const cut = cutSegmentWithCircle(start, lengthPx, last, p);
        return { p: cut, idx: i };
      }
    } else {
      let cut = sleeve?.cutSegment(start, last, p);
      if (cut && start.distance(cut) > lengthPx) {
        cut = cutSegmentWithCircle(start, lengthPx, last, p);
      }
      return { p: cut, idx: i };
    }
  }
  return { p: points[points.length - 1], idx: undefined };
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
class AngleInterval {
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
