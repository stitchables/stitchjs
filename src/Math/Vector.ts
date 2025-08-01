export class Vector {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  static fromAngle(angle: number): Vector {
    return new Vector(Math.cos(angle), Math.sin(angle));
  }
  static fromObject(obj: { x: number; y: number }): Vector {
    return new Vector(obj.x, obj.y);
  }
  static min(v1: Vector, v2: Vector): Vector {
    return new Vector(Math.min(v1.x, v2.x), Math.min(v1.y, v2.y));
  }
  static max(v1: Vector, v2: Vector): Vector {
    return new Vector(Math.max(v1.x, v2.x), Math.max(v1.y, v2.y));
  }
  copy(): Vector {
    return new Vector(this.x, this.y);
  }
  add(v: Vector): Vector {
    return new Vector(this.x + v.x, this.y + v.y);
  }
  subtract(v: Vector): Vector {
    return new Vector(this.x - v.x, this.y - v.y);
  }
  multiply(s: number): Vector {
    return new Vector(s * this.x, s * this.y);
  }
  product(v: Vector): Vector {
    return new Vector(this.x * v.x, this.y * v.y);
  }
  divide(s: number): Vector {
    return new Vector(this.x / s, this.y / s);
  }
  rotate(a: number): Vector {
    return new Vector(
      this.x * Math.cos(a) - this.y * Math.sin(a),
      this.x * Math.sin(a) + this.y * Math.cos(a),
    );
  }
  lerp(v: Vector, w: number): Vector {
    return new Vector((1 - w) * this.x + w * v.x, (1 - w) * this.y + w * v.y);
  }
  dot(v: Vector): number {
    return this.x * v.x + this.y * v.y;
  }
  cross(v: Vector): number {
    return this.x * v.y - this.y * v.x;
  }
  squaredDistance(v: Vector): number {
    return (this.x - v.x) * (this.x - v.x) + (this.y - v.y) * (this.y - v.y);
  }
  distance(v: Vector): number {
    return Math.sqrt((this.x - v.x) * (this.x - v.x) + (this.y - v.y) * (this.y - v.y));
  }
  heading(): number {
    return Math.atan2(this.y, this.x);
  }
  magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  normalized(): Vector {
    return this.magnitude() > 0 ? this.divide(this.magnitude()) : Vector.fromAngle(0);
  }
  squaredLength(): number {
    return this.x * this.x + this.y * this.y;
  }
  length(): number {
    return Math.sqrt(this.squaredLength());
  }
  angleBetween(v: Vector): number {
    const magSqMult = this.squaredLength() * v.squaredLength();
    // Returns NaN if either vector is the zero vector.
    if (magSqMult === 0) {
      return NaN;
    }
    const u = this.cross(v);
    return Math.atan2(u, this.dot(v)) * Math.sign(u || 1);
  }
}
