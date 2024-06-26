import { Utils } from '../Math/Utils';
import { Vector } from '../Math/Vector';

interface ISegmentSide {
  startIndex: number;
  endIndex: number;
  length: number;
}

export class ClassicSatin {
  densityMm: number;
  vertices: Vector[];
  segments: { side0: ISegmentSide; side1: ISegmentSide }[];
  constructor(densityMm = 0.4) {
    this.densityMm = densityMm;
    this.vertices = [];
    this.segments = [];
  }

  static fromQuadStripVectors(vectors: Vector[], densityMm = 0.4) {
    const run = new ClassicSatin(densityMm);
    for (let i = 0; i < vectors.length; i += 2) {
      run.addVector(vectors[i]);
    }
    return run;
  }

  addVertex(x: number, y: number) {
    this.addVector(new Vector(x, y));
  }

  addVector(v: Vector) {
    this.vertices.push(v);
    const vertexCount = this.vertices.length;
    if (vertexCount > 2 && vertexCount % 2 === 0) {
      this.segments.push({
        side0: {
          startIndex: vertexCount - 4,
          endIndex: vertexCount - 2,
          length: this.vertices[vertexCount - 4].distance(this.vertices[vertexCount - 2]),
        },
        side1: {
          startIndex: vertexCount - 3,
          endIndex: vertexCount - 1,
          length: this.vertices[vertexCount - 3].distance(this.vertices[vertexCount - 1]),
        },
      });
    }
  }

  getStitches(pixelsPerMm: number) {
    const run = [] as Vector[];
    run.push(this.vertices[this.segments[0].side0.startIndex]);
    run.push(this.vertices[this.segments[0].side1.startIndex]);
    for (const segment of this.segments) {
      const countSamples = Math.ceil(
        Math.max(segment.side0.length, segment.side1.length) /
          (this.densityMm * pixelsPerMm),
      );
      for (let i = 0; i < countSamples; i++) {
        const w = Utils.map(i + 1, 0, countSamples, 0, 1);
        run.push(
          this.vertices[segment.side0.startIndex].lerp(
            this.vertices[segment.side0.endIndex],
            w,
          ),
        );
        run.push(
          this.vertices[segment.side1.startIndex].lerp(
            this.vertices[segment.side1.endIndex],
            w,
          ),
        );
      }
    }
    return run;
  }
}
