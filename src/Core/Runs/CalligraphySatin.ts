import { IRun } from '../IRun';
import { Vector } from '../../Math/Vector';
import { ClassicSatin, SatinSplitOptions, UnderlayOptions } from './ClassicSatin';

export class CalligraphySatin implements IRun {
  centerLine: Vector[];
  angle: number;
  widthMm: number;
  classicSatinOptions: {
    startPosition: Vector;
    endPosition: Vector;
    densityMm: number;
    travelLengthMm: number;
    travelToleranceMm: number;
    split: SatinSplitOptions | undefined;
    underlays: { type: string; options?: UnderlayOptions }[];
  };
  constructor(
    centerLine: Vector[],
    options?: {
      entry?: Vector;
      exit?: Vector;
      angle?: number;
      widthMm?: number;
      densityMm?: number;
      travelLengthMm?: number;
      travelToleranceMm?: number;
      split?: SatinSplitOptions;
      underlays?: { type: string; options?: UnderlayOptions }[];
    },
  ) {
    this.centerLine = centerLine;
    this.angle = options?.angle ?? 0;
    this.widthMm = options?.widthMm ?? 3;
    this.classicSatinOptions = {
      startPosition: options?.entry ?? this.centerLine[0],
      endPosition: options?.exit ?? this.centerLine[this.centerLine.length - 1],
      densityMm: options?.densityMm ?? 0.2,
      travelLengthMm: options?.travelLengthMm ?? 3,
      travelToleranceMm: options?.travelToleranceMm ?? 1,
      split: options?.split,
      underlays: options?.underlays ?? [],
    };
  }
  getStitches(pixelsPerMm: number) {
    const halfWidthPx = 0.5 * pixelsPerMm * this.widthMm;
    const offset = Vector.fromAngle(this.angle).multiply(halfWidthPx);
    const quadStripVertices = [];
    for (const v of this.centerLine) {
      quadStripVertices.push(v.add(offset));
      quadStripVertices.push(v.subtract(offset));
    }
    const classicSatin = new ClassicSatin(quadStripVertices, this.classicSatinOptions);
    return classicSatin.getStitches(pixelsPerMm);
  }
}
