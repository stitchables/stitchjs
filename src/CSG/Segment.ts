import { Vector } from '../Math/Vector';
import { Line } from './Line';

export class Segment {
  vertices: Vector[];
  line: Line;
  constructor(vertices: Vector[]) {
    this.vertices = vertices;
    this.line = Line.fromPoints(vertices[0], vertices[1]);
  }
  clone(): Segment {
    return new Segment(this.vertices.map((v) => v.copy()));
  }
  flip(): void {
    this.vertices.reverse().map((v) => v.multiply(-1));
    this.line.flip();
  }
}
