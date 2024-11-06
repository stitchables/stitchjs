import { BoundingBox } from './BoundingBox';
import { Vector } from './Vector';

export class Quadtree {
  boundingBox: BoundingBox;
  capacity: number;
  points: Vector[];
  divided: boolean;
  northeast: Quadtree | null = null;
  northwest: Quadtree | null = null;
  southeast: Quadtree | null = null;
  southwest: Quadtree | null = null;

  constructor(boundingBox: BoundingBox, capacity: number) {
    this.boundingBox = boundingBox;
    this.capacity = capacity;
    this.points = [];
    this.divided = false;
  }

  insert(x: number, y: number): boolean {
    if (!this.boundingBox.contains(x, y)) {
      return false;
    }
    const point = new Vector(x, y);
    if (this.points.length < this.capacity) {
      this.points.push(point);
      return true;
    } else {
      if (!this.divided) {
        this.subdivide();
      }
      // if (this.northeast?.insert(point.x, point.y)) {
      //   return true;
      // }
      // if (this.northwest?.insert(point.x, point.y)) {
      //   return true;
      // }
      // if (this.southeast?.insert(point.x, point.y)) {
      //   return true;
      // }
      // if (this.southwest?.insert(point.x, point.y)) {
      //   return true;
      // }
      // return false;
      return <boolean>(
        (this.northeast?.insert(point.x, point.y) ||
          this.northwest?.insert(point.x, point.y) ||
          this.southeast?.insert(point.x, point.y) ||
          this.southwest?.insert(point.x, point.y))
      );
    }
  }

  subdivide(): void {
    const w = new Vector(this.boundingBox.width, 0);
    const h = new Vector(0, this.boundingBox.height);
    const hw = new Vector(this.boundingBox.halfWidth, 0);
    const hh = new Vector(0, this.boundingBox.halfHeight);
    const ne = new BoundingBox(
      this.boundingBox.min.add(hw),
      this.boundingBox.min.add(w.add(hh)),
    );
    const nw = new BoundingBox(
      this.boundingBox.min.copy(),
      this.boundingBox.min.add(hw.add(hh)),
    );
    const se = new BoundingBox(
      this.boundingBox.min.add(hw.add(hh)),
      this.boundingBox.min.add(w.add(h)),
    );
    const sw = new BoundingBox(
      this.boundingBox.min.add(hh),
      this.boundingBox.min.add(hw.add(h)),
    );
    this.northeast = new Quadtree(ne, this.capacity);
    this.northwest = new Quadtree(nw, this.capacity);
    this.southeast = new Quadtree(se, this.capacity);
    this.southwest = new Quadtree(sw, this.capacity);
    this.divided = true;
  }

  query(range: BoundingBox, found: Vector[] = []): Vector[] {
    if (!this.boundingBox.intersects(range)) {
      return found;
    }
    for (const point of this.points) {
      if (range.contains(point.x, point.y)) {
        found.push(point);
      }
    }
    if (this.divided) {
      this.northeast?.query(range, found);
      this.northwest?.query(range, found);
      this.southeast?.query(range, found);
      this.southwest?.query(range, found);
    }
    return found;
  }
}
