import { Stitch } from './Stitch';

export interface IRun {
  getStitches: (pixelsPerMm: number) => Stitch[];
}
