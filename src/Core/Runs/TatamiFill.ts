import { Polyline } from '../../Math/Polyline';
import { Vector } from '../../Math/Vector';
import { IRun } from '../IRun';
import { PatternFill } from './PatternFill';
import { Stitch } from '../Stitch';

export class TatamiFill implements IRun {
  patternFill: PatternFill;
  constructor(
    shape: Polyline[],
    angle: number,
    rowSpacingMm: number,
    stitchSpacingMm: number,
    startPosition: Vector,
    endPosition: Vector,
  ) {
    this.patternFill = new PatternFill(
      shape,
      angle,
      rowSpacingMm,
      [
        { rowOffsetMm: 0, rowPatternMm: [stitchSpacingMm] },
        { rowOffsetMm: 0.5 * stitchSpacingMm, rowPatternMm: [stitchSpacingMm] },
      ],
      stitchSpacingMm,
      startPosition,
      endPosition,
    );
  }
  getStitches(pixelsPerMm: number): Stitch[] {
    return this.patternFill.getStitches(pixelsPerMm);
  }
}
