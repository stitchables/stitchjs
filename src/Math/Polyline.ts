import { BoundingBox } from './BoundingBox';
import { Utils } from './Utils';
import { Vector } from './Vector';

export class Polyline {
  isClosed: boolean;
  vertices: Vector[];
  constructor(isClosed = false) {
    this.isClosed = isClosed;
    this.vertices = [];
  }
  static fromVectors(vectors: Vector[], isClosed: false): Polyline {
    const polyline = new Polyline(isClosed);
    polyline.vertices = vectors;
    return polyline;
  }
  static fromArrays(arrays: [number, number][], isClosed = false) {
    const polyline = new Polyline(isClosed);
    for (const array of arrays) polyline.addVertex(array[0], array[1]);
    return polyline;
  }
  static fromObjects(objects: { x: number; y: number }[], isClosed = false) {
    const polyline = new Polyline(isClosed);
    for (const object of objects) polyline.addVertex(object.x, object.y);
    return polyline;
  }
  addVertex(x: number, y: number, unshift = false): void {
    let v = new Vector(x, y);
    if (this.vertices.length === 0) {
      this.vertices.push(v);
    } else {
      let other = unshift ? this.vertices[0] : this.vertices[this.vertices.length - 1];
      if (other.distance(v) > 1e-3) {
        if (unshift) {
          this.vertices.unshift(v);
        } else {
          this.vertices.push(v);
        }
      }
    }
  }
  translate(x: number, y: number): Polyline {
    const translatePolyline = new Polyline(this.isClosed);
    for (const vertex of this.vertices)
      translatePolyline.addVertex(vertex.x + x, vertex.y + y);
    return translatePolyline;
  }
  getRounded(radius: number, stepAngle = 0.1): Polyline {
    const roundedPolyline = new Polyline(this.isClosed);
    if (!this.isClosed) roundedPolyline.addVertex(this.vertices[0].x, this.vertices[0].y);
    for (
      let i = this.isClosed ? 0 : 1;
      this.isClosed ? i < this.vertices.length : i < this.vertices.length - 1;
      i++
    ) {
      const A =
        this.vertices[(i - 1 + this.vertices.length) % this.vertices.length].copy();
      const B = this.vertices[i].copy();
      const C = this.vertices[(i + 1) % this.vertices.length].copy();
      const BA = A.subtract(B);
      const BC = C.subtract(B);
      const BAnorm = BA.copy().normalized();
      const BCnorm = BC.copy().normalized();
      const sinA = -BAnorm.dot(BCnorm.copy().rotate(Math.PI / 2));
      const sinA90 = BAnorm.dot(BCnorm);
      let angle = Math.asin(sinA);
      let radDirection = 1;
      let drawDirection = false;
      if (sinA90 < 0)
        angle < 0
          ? (angle += Math.PI)
          : ((angle += Math.PI), (radDirection = -1), (drawDirection = true));
      else angle > 0 ? ((radDirection = -1), (drawDirection = true)) : 0;
      const halfAngle = angle / 2;
      let lenOut = Math.abs((Math.cos(halfAngle) * radius) / Math.sin(halfAngle));
      let cRadius = 0;
      if (lenOut > Math.min(BA.magnitude() / 2, BC.magnitude() / 2)) {
        lenOut = Math.min(BA.magnitude() / 2, BC.magnitude() / 2);
        cRadius = Math.abs((lenOut * Math.sin(halfAngle)) / Math.cos(halfAngle));
      } else {
        cRadius = radius;
      }
      const x =
        B.x + BC.normalized().x * lenOut - BC.normalized().y * cRadius * radDirection;
      const y =
        B.y + BC.normalized().y * lenOut + BC.normalized().x * cRadius * radDirection;
      const fromAngle =
        (((BA.heading() + (Math.PI / 2) * radDirection + 6 * Math.PI) / (2 * Math.PI)) %
          1) *
        2 *
        Math.PI;
      const toAngle =
        (((BC.heading() - (Math.PI / 2) * radDirection + 6 * Math.PI) / (2 * Math.PI)) %
          1) *
        2 *
        Math.PI;
      if (Math.abs(toAngle - fromAngle) < 0.01) continue;
      if (!drawDirection) {
        if (fromAngle < toAngle) {
          for (let a = fromAngle; a < toAngle; a += stepAngle) {
            roundedPolyline.addVertex(
              cRadius * Math.cos(a) + x,
              cRadius * Math.sin(a) + y,
            );
          }
        } else {
          for (let a = fromAngle; a < toAngle + 2 * Math.PI; a += stepAngle) {
            roundedPolyline.addVertex(
              cRadius * Math.cos(a) + x,
              cRadius * Math.sin(a) + y,
            );
          }
        }
      } else {
        if (fromAngle > toAngle) {
          for (let a = fromAngle; a > toAngle; a -= stepAngle) {
            roundedPolyline.addVertex(
              cRadius * Math.cos(a) + x,
              cRadius * Math.sin(a) + y,
            );
          }
        } else {
          for (let a = fromAngle; a > toAngle - 2 * Math.PI; a -= stepAngle) {
            roundedPolyline.addVertex(
              cRadius * Math.cos(a) + x,
              cRadius * Math.sin(a) + y,
            );
          }
        }
      }
    }
    if (!this.isClosed)
      roundedPolyline.addVertex(
        this.vertices[this.vertices.length - 1].x,
        this.vertices[this.vertices.length - 1].y,
      );
    return roundedPolyline;
  }
  getResampled(spacing: number): Polyline {
    if (spacing <= 0 || this.vertices.length === 0) return this;
    let totalLength = 0;
    const lengths = [0];
    for (let i = 1; i < this.vertices.length; i++) {
      const length = this.vertices[i].distance(this.vertices[i - 1]);
      totalLength += length;
      lengths.push(lengths[lengths.length - 1] + length);
    }
    if (this.isClosed) {
      const length = this.vertices[this.vertices.length - 1].distance(this.vertices[0]);
      totalLength += length;
      lengths.push(totalLength);
    }
    const resampledPolyline = new Polyline(this.isClosed);
    let currentIndex = 1;
    const modifiedSpacing = totalLength / Math.floor(totalLength / spacing);
    for (let l = 0; l < totalLength - 0.5 * modifiedSpacing; l += modifiedSpacing) {
      while (lengths[currentIndex] < l) currentIndex++;
      const p = this.vertices[currentIndex - 1];
      const q = this.vertices[currentIndex % this.vertices.length];
      const t =
        (lengths[currentIndex] - l) / (lengths[currentIndex] - lengths[currentIndex - 1]);
      const v = q.lerp(p, t);
      resampledPolyline.addVertex(v.x, v.y);
    }
    if (!this.isClosed)
      resampledPolyline.addVertex(
        this.vertices[this.vertices.length - 1].x,
        this.vertices[this.vertices.length - 1].y,
      );
    return resampledPolyline;
  }
  getOffset(distance: number): Polyline {
    const offsetPolyline = new Polyline(this.isClosed);
    for (let i = 0; i < this.vertices.length; i++) {
      const prev = this.vertices[(i - 1 + this.vertices.length) % this.vertices.length];
      const curr = this.vertices[i];
      const next = this.vertices[(i + 1) % this.vertices.length];
      if (prev.distance(curr) === 0 || curr.distance(next) === 0) continue;
      const np = prev
        .subtract(curr)
        .normalized()
        .multiply(distance)
        .rotate(0.5 * Math.PI);
      const nq = curr
        .subtract(next)
        .normalized()
        .multiply(distance)
        .rotate(0.5 * Math.PI);
      const [p1, p2, q1, q2] = [prev.add(np), curr.add(np), curr.add(nq), next.add(nq)];
      if (p2.distance(q1) === 0) {
        offsetPolyline.vertices.push(p2);
        continue;
      }
      const intersection = Utils.lineLineIntersection(p1, p2, q1, q2);
      if (intersection instanceof Vector) offsetPolyline.vertices.push(intersection);
    }
    return offsetPolyline;
  }
  getSimplified(tolerance: number): Polyline {
    // https://gist.github.com/adammiller/826148?permalink_comment_id=317898#gistcomment-317898
    const squaredTolerance = tolerance * tolerance;
    const simplifyDP = function (v: Vector[], j: number, k: number, mk: number[]) {
      if (k < j) return;
      // let [maxi, maxd2, S] = [j, 0, [v[j], v[k]]];
      let maxi = j;
      let maxd2 = 0;
      const S = [v[j], v[k]];
      const u = S[1].subtract(S[0]);
      const cu = u.squaredLength();
      for (let i = j + 1; i < k; i++) {
        // let [cw, dv2] = [v[i].subtract(S[0]).dot(u), 0];
        const cw = v[i].subtract(S[0]).dot(u);
        let dv2 = 0;
        if (cw <= 0) dv2 = v[i].squaredDistance(S[0]);
        else if (cu <= cw) dv2 = v[i].squaredDistance(S[1]);
        else dv2 = v[i].squaredDistance(S[0].add(u.multiply(cw / cu)));
        if (dv2 <= maxd2) continue;
        [maxi, maxd2] = [i, dv2];
      }
      if (maxd2 > squaredTolerance) {
        mk[maxi] = 1;
        simplifyDP(v, j, maxi, mk);
        simplifyDP(v, maxi, k, mk);
      }
      return;
    };
    // let [n, i, k, m, pv, vt, mk] = [this.vertices.length, 0, 0, 0, 0, [], []];
    let [i, k, m, pv] = [0, 0, 0, 0];
    const [n, vt, mk] = [this.vertices.length, [] as Vector[], [] as number[]];
    vt[0] = this.vertices[0];
    for (i = k = 1, pv = 0; i < n; i++) {
      if (this.vertices[i].squaredDistance(this.vertices[pv]) < squaredTolerance)
        continue;
      vt[k++] = this.vertices[i];
      pv = i;
    }
    if (pv < n - 1) vt[k++] = this.vertices[n - 1];
    mk[0] = mk[k - 1] = 1;
    simplifyDP(vt, 0, k - 1, mk);
    const simplifiedPolyline = new Polyline(this.isClosed);
    for (i = m = 0; i < k; i++) if (mk[i]) simplifiedPolyline.vertices.push(vt[i]);
    return simplifiedPolyline;
  }
  getClosestVertex(position: Vector): Vector {
    let [minDistance, result] = [Infinity, new Vector(0, 0)];
    for (let i = 0; i < this.vertices.length; i++) {
      const distance = position.distance(this.vertices[i]);
      if (distance < minDistance) {
        minDistance = distance;
        result = this.vertices[i];
      }
    }
    return result;
  }
  getBoundingBox() {
    const boundingBox = new BoundingBox(
      new Vector(Infinity, Infinity),
      new Vector(-Infinity, -Infinity),
    );
    for (const vertex of this.vertices) {
      if (vertex.x < boundingBox.min.x) boundingBox.min.x = vertex.x;
      else if (vertex.x > boundingBox.max.x) boundingBox.max.x = vertex.x;
      if (vertex.y < boundingBox.min.y) boundingBox.min.y = vertex.y;
      else if (vertex.y > boundingBox.max.y) boundingBox.max.y = vertex.y;
    }
    boundingBox.recalculate();
    return boundingBox;
  }
  getArea() {
    let area = 0;
    for (let i = 0; i < this.vertices.length; i++) {
      const curr = this.vertices[i];
      const next = this.vertices[(i + 1) % this.vertices.length];
      area += curr.x * next.y - next.x * curr.y;
    }
    return 0.5 * Math.abs(area);
  }
  getCentroid() {
    const centroid = new Vector(0, 0);
    for (let i = 0; i < this.vertices.length; i++) {
      const curr = this.vertices[i];
      const next = this.vertices[(i + 1) % this.vertices.length];
      centroid.x += (curr.x + next.x) * (curr.x * next.y - next.x * curr.y);
      centroid.y += (curr.y + next.y) * (curr.x * next.y - next.x * curr.y);
    }
    return centroid.multiply(1 / 6 / this.getArea());
  }
  containsPoint(point: Vector): boolean {
    let contains = false;
    for (let i = 0, j = this.vertices.length - 1; i < this.vertices.length; j = i++) {
      if (
        this.vertices[i].y > point.y !== this.vertices[j].y > point.y &&
        point.x <
          ((this.vertices[j].x - this.vertices[i].x) * (point.y - this.vertices[i].y)) /
            (this.vertices[j].y - this.vertices[i].y) +
            this.vertices[i].x
      ) {
        contains = !contains;
      }
    }
    return contains;
  }
}
