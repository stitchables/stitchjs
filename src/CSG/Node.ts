import { Segment } from './Segment';
import { Line } from './Line';

export class Node {
  line: Line | undefined;
  right: Node | undefined;
  left: Node | undefined;
  segments: Segment[];
  constructor(segments?: Segment[]) {
    this.segments = [];
    if (segments) this.build(segments);
  }
  clone(): Node {
    const node = new Node();
    if (this.line) node.line = this.line.clone();
    if (this.right) node.right = this.right.clone();
    if (this.left) node.left = this.left.clone();
    node.segments = this.segments.map((p) => p.clone());
    return node;
  }
  invert(): void {
    for (let i = 0; i < this.segments.length; i++) this.segments[i].flip();
    if (this.line) this.line.flip();
    if (this.right) this.right.invert();
    if (this.left) this.left.invert();
    [this.right, this.left] = [this.left, this.right];
  }
  clipSegments(segments: Segment[]): Segment[] {
    if (!this.line) return segments.slice();
    let right: Segment[] = [];
    let left: Segment[] = [];
    for (let i = 0; i < segments.length; i++) {
      this.line.splitSegment(segments[i], right, left, right, left);
    }
    if (this.right) right = this.right.clipSegments(right);
    if (this.left) left = this.left.clipSegments(left);
    else left = [];
    return right.concat(left);
  }
  clipTo(bsp: Node): void {
    this.segments = bsp.clipSegments(this.segments);
    if (this.right) this.right.clipTo(bsp);
    if (this.left) this.left.clipTo(bsp);
  }
  allSegments(): Segment[] {
    let segments = this.segments.slice();
    if (this.right) segments = segments.concat(this.right.allSegments());
    if (this.left) segments = segments.concat(this.left.allSegments());
    return segments;
  }
  build(segments: Segment[]): void {
    if (!segments || segments.length < 1) return;
    if (!this.line) this.line = segments[0].line.clone();
    let [right, left] = [[], []];
    for (let i = 0; i < segments.length; i++) {
      this.line.splitSegment(segments[i], this.segments, this.segments, right, left);
    }
    if (right.length > 0) {
      if (!this.right) this.right = new Node();
      this.right.build(right);
    }
    if (left.length > 0) {
      if (!this.left) this.left = new Node();
      this.left.build(left);
    }
  }
}
