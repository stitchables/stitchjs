import { Vector } from '../Math/Vector';
import { StitchType } from './EStitchType';

export class Stitch {
  position: Vector;
  stitchType: StitchType;
  constructor(position: Vector, stitchType: StitchType = StitchType.NORMAL) {
    this.position = position;
    this.stitchType = stitchType;
  }

  static fromVectors(
    positions: Vector[],
    stitchType: StitchType = StitchType.NORMAL,
  ): Stitch[] {
    return positions.map((v) => new Stitch(v, stitchType));
  }
}
