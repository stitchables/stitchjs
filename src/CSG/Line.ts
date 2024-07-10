import { Vector } from '../Math/Vector';
import { Segment } from './Segment';

export class Line {
  origin: Vector;
  direction: Vector;
  normal: Vector;
  constructor(origin: Vector, direction: Vector) {
    this.origin = origin;
    this.direction = direction.normalized();
    this.normal = new Vector(this.direction.y, -1 * this.direction.x);
  }
  static fromPoints(a: Vector, b: Vector): Line {
    return new Line(a, b.subtract(a).normalized());
  }
  clone(): Line {
    return new Line(this.origin.copy(), this.direction.copy());
  }
  flip(): void {
    this.direction = this.direction.multiply(-1);
    this.normal = this.normal.multiply(-1);
  }
  splitSegment(
    segment: Segment,
    collinearRight: Segment[],
    collinearLeft: Segment[],
    right: Segment[],
    left: Segment[],
    epsilon = 1e-5,
  ): void {
    const [COLLINEAR, RIGHT, LEFT, SPANNING] = [0, 1, 2, 3];

    let segmentType = 0;
    let t = 0;
    const types: number[] = [];
    for (let i = 0; i < segment.vertices.length; i++) {
      t = this.normal.dot(segment.vertices[i].subtract(this.origin));
      const type = t < -epsilon ? RIGHT : t > epsilon ? LEFT : COLLINEAR;
      segmentType |= type;
      types.push(type);
    }

    switch (segmentType) {
      case COLLINEAR:
        if (t > 0 || segment.line.origin.x >= this.origin.x) collinearRight.push(segment);
        else collinearLeft.push(segment);
        break;
      case RIGHT:
        right.push(segment);
        break;
      case LEFT:
        left.push(segment);
        break;
      case SPANNING:
        const [r, l]: [Vector[], Vector[]] = [[], []];
        const [ti, tj] = [types[0], types[1]];
        const [vi, vj] = [segment.vertices[0], segment.vertices[1]];
        if (ti === RIGHT && tj === RIGHT) {
          r.push(vi, vj);
        } else if (ti === LEFT && tj === LEFT) {
          l.push(vi, vj);
        } else if (ti === RIGHT && tj === LEFT) {
          const tw =
            this.normal.dot(this.origin.subtract(vi)) / this.normal.dot(vj.subtract(vi));
          const v = vi.lerp(vj, tw);
          r.push(vi, v);
          l.push(v.copy(), vj);
        } else if (ti === LEFT && tj === RIGHT) {
          const tw =
            this.normal.dot(this.origin.subtract(vi)) / this.normal.dot(vj.subtract(vi));
          const v = vi.lerp(vj, tw);
          l.push(vi, v);
          r.push(v.copy(), vj);
        }
        if (r.length >= 2) right.push(new Segment(r));
        if (l.length >= 2) left.push(new Segment(l));
        break;
    }
  }
}
