import { Polyline } from '../../Math/Polyline';
import { Vector } from '../../Math/Vector';
import { IRun } from '../IRun';
import { PatternFill } from './PatternFill';
import { Stitch } from '../Stitch';
import { AutoFill } from './AutoFill';

export class TatamiFill implements IRun {
  autoFill: AutoFill;
  constructor(
    shell: Polyline,
    holes: Polyline[],
    angle: number,
    rowSpacingMm: number,
    stitchSpacingMm: number,
    travelStitchLengthMm: number,
    startPosition: Vector,
    endPosition: Vector,
    centerPosition?: Vector,
    underpath = true,
  ) {
    this.autoFill = new AutoFill(
      shell,
      holes,
      angle,
      rowSpacingMm,
      [
        { rowOffsetMm: 0, rowPatternMm: [stitchSpacingMm] },
        { rowOffsetMm: 0.33 * stitchSpacingMm, rowPatternMm: [stitchSpacingMm] },
        { rowOffsetMm: 0.66 * stitchSpacingMm, rowPatternMm: [stitchSpacingMm] },
      ],
      travelStitchLengthMm,
      startPosition,
      endPosition,
      centerPosition,
      underpath,
    );
  }
  getStitches(pixelsPerMm: number): Stitch[] {
    return this.autoFill.getStitches(pixelsPerMm);
  }
}
