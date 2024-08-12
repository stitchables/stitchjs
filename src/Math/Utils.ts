import { Vector } from './Vector';

export const Utils = {
  constrain: function (value: number, low: number, high: number) {
    return Math.max(Math.min(value, high), low);
  },
  map: function (
    value: number,
    a: number,
    b: number,
    c: number,
    d: number,
    clamp = false,
  ) {
    const mapped = ((value - a) / (b - a)) * (d - c) + c;
    if (!clamp) return mapped;
    if (c < d) return Utils.constrain(mapped, c, d);
    else return Utils.constrain(mapped, d, c);
  },
  isPointLeft: function (start: Vector, end: Vector, point: Vector) {
    return (
      (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x) >
      0
    );
  },
  lineSegmentIntersection: function (p1: Vector, p2: Vector, q1: Vector, q2: Vector) {
    const s1 = p2.subtract(p1);
    const s2 = q2.subtract(q1);
    const d = -s2.x * s1.y + s1.x * s2.y;
    const s = (-s1.y * (p1.x - q1.x) + s1.x * (p1.y - q1.y)) / d;
    const t = (s2.x * (p1.y - q1.y) - s2.y * (p1.x - q1.x)) / d;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1)
      return new Vector(p1.x + t * s1.x, p1.y + t * s1.y);
    else return null;
  },
  getAngleBetween: function (a: Vector, b: Vector, c: Vector) {
    const v1 = b.subtract(a).normalized();
    const v2 = c.subtract(b).normalized();
    return Math.atan2(v2.y * v1.x - v2.x * v1.y, v2.x * v1.x + v2.y * v1.y) + Math.PI;
  },
  lineLineIntersection: function (p1: Vector, p2: Vector, q1: Vector, q2: Vector) {
    const denominator = (q2.y - q1.y) * (p2.x - p1.x) - (q2.x - q1.x) * (p2.y - p1.y);
    if (denominator === 0) return false;
    const ua =
      ((q2.x - q1.x) * (p1.y - q1.y) - (q2.y - q1.y) * (p1.x - q1.x)) / denominator;
    const ub =
      ((p2.x - p1.x) * (p1.y - q1.y) - (p2.y - p1.y) * (p1.x - q1.x)) / denominator;
    return p1.add(p2.subtract(p1).multiply(ua));
  },
  sdfLine: function (p1: Vector, p2: Vector, v: Vector) {
    const m = (p2.y - p1.y) / (p2.x - p1.x);
    const b = p1.y - m * p1.x;
    return Math.min(
      p1.distance(v),
      p2.distance(v),
      Math.abs(v.y - m * v.x - b) / Math.sqrt(m * m + 1),
    );
  },
  closestPointsOnSegments: function (
    p1: Vector,
    p2: Vector,
    q1: Vector,
    q2: Vector,
  ): { distance: number; s: number; t: number; v1: Vector; v2: Vector } {
    const pd = p2.subtract(p1);
    const qd = q2.subtract(q1);
    const r = p1.subtract(q1);
    const pl2 = pd.squaredLength();
    const ql2 = qd.squaredLength();
    const pdr = pd.dot(r);
    const qdr = qd.dot(r);
    const pdq = pd.dot(qd);

    let s, t;
    const EPSILON = 1e-10;

    if (pl2 <= EPSILON && ql2 <= EPSILON) {
      s = t = 0.0;
    } else if (pl2 <= EPSILON) {
      s = 0.0;
      t = qdr / ql2;
      t = Math.min(Math.max(t, 0.0), 1.0);
    } else if (ql2 <= EPSILON) {
      t = 0.0;
      s = -pdr / pl2;
      s = Math.min(Math.max(s, 0.0), 1.0);
    } else {
      const denominator = pl2 * ql2 - pdq * pdq;
      if (denominator !== 0.0) {
        s = (pdq * qdr - pdr * ql2) / denominator;
        s = Math.min(Math.max(s, 0.0), 1.0);
      } else {
        s = 0.0;
      }
      t = (pdq * s + qdr) / ql2;
      if (t < 0.0) {
        t = 0.0;
        s = Math.min(Math.max(-pdr / pl2, 0.0), 1.0);
      } else if (t > 1.0) {
        t = 1.0;
        s = Math.min(Math.max((pdq - pdr) / pl2, 0.0), 1.0);
      }
    }

    const closestPointA = p1.add(pd.multiply(s));
    const closestPointB = q1.add(qd.multiply(t));
    return {
      distance: closestPointA.subtract(closestPointB).length(),
      s: s,
      t: t,
      v1: closestPointA,
      v2: closestPointB,
    };
  },
  distance(x1: number, y1: number, x2: number, y2: number) {
    return Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
  },
  inToMm: function (inches: number) {
    return inches * 25.4;
  },
  mmToIn: function (millimeters: number) {
    return millimeters / 25.4;
  },
};
