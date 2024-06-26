import { Vector } from './Vector';

export const Utils = {
  constrain: function (value, low, high) {
    return Math.max(Math.min(value, high), low);
  },
  map: function (value, a, b, c, d, clamp = false) {
    const mapped = ((value - a) / (b - a)) * (d - c) + c;
    if (!clamp) return mapped;
    if (c < d) return Utils.constrain(mapped, c, d);
    else return Utils.constrain(mapped, d, c);
  },
  isPointLeft: function (start, end, point) {
    return (
      (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x) >
      0
    );
  },
  lineSegmentIntersection: function (p1, p2, q1, q2) {
    const s1 = p2.subtract(p1);
    const s2 = q2.subtract(q1);
    const d = -s2.x * s1.y + s1.x * s2.y;
    const s = (-s1.y * (p1.x - q1.x) + s1.x * (p1.y - q1.y)) / d;
    const t = (s2.x * (p1.y - q1.y) - s2.y * (p1.x - q1.x)) / d;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1)
      return new Vector(p1.x + t * s1.x, p1.y + t * s1.y);
    else return null;
  },
  getAngleBetween: function (a, b, c) {
    const v1 = b.subtract(a).normalized();
    const v2 = c.subtract(b).normalized();
    return Math.atan2(v2.y * v1.x - v2.x * v1.y, v2.x * v1.x + v2.y * v1.y) + Math.PI;
  },
  lineLineIntersection: function (p1, p2, q1, q2) {
    const denominator = (q2.y - q1.y) * (p2.x - p1.x) - (q2.x - q1.x) * (p2.y - p1.y);
    if (denominator === 0) return false;
    const ua =
      ((q2.x - q1.x) * (p1.y - q1.y) - (q2.y - q1.y) * (p1.x - q1.x)) / denominator;
    const ub =
      ((p2.x - p1.x) * (p1.y - q1.y) - (p2.y - p1.y) * (p1.x - q1.x)) / denominator;
    return p1.add(p2.subtract(p1).multiply(ua));
  },
  sdfLine: function (p1, p2, v) {
    const m = (p2.y - p1.y) / (p2.x - p1.x);
    const b = p1.y - m * p1.x;
    return Math.min(
      p1.distance(v),
      p2.distance(v),
      Math.abs(v.y - m * v.x - b) / Math.sqrt(m * m + 1),
    );
  },
  distance(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
  },
  inToMm: function (inches) {
    return inches * 25.4;
  },
  mmToIn: function (millimeters) {
    return millimeters / 25.4;
  },
};
