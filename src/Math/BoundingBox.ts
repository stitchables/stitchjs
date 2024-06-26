import { Vector } from './Vector';

export class BoundingBox {
  min: Vector;
  max: Vector;
  center: Vector;
  width: number;
  height: number;
  halfWidth: number;
  halfHeight: number;
  constructor(min = new Vector(0, 0), max = new Vector(0, 0)) {
    this.min = min;
    this.max = max;
    this.center = new Vector(0, 0);
    this.width = 0;
    this.height = 0;
    this.halfWidth = 0;
    this.halfHeight = 0;
    this.recalculate();
  }
  recalculate() {
    this.center = this.min.lerp(this.max, 0.5);
    this.width = this.max.x - this.min.x;
    this.height = this.max.y - this.min.y;
    this.halfWidth = 0.5 * this.width;
    this.halfHeight = 0.5 * this.height;
  }
  contains(x: number, y: number): boolean {
    return (
      x >= this.center.x - this.halfWidth &&
      x <= this.center.x + this.halfWidth &&
      y >= this.center.y - this.halfHeight &&
      y <= this.center.y + this.halfHeight
    );
  }
  intersects(boundingBox: BoundingBox): boolean {
    return !(
      boundingBox.center.x - boundingBox.halfWidth > this.center.x + this.halfWidth ||
      boundingBox.center.x + boundingBox.halfWidth < this.center.x - this.halfWidth ||
      boundingBox.center.y - boundingBox.halfHeight > this.center.y + this.halfHeight ||
      boundingBox.center.y + boundingBox.halfHeight < this.center.y - this.halfHeight
    );
  }
}
