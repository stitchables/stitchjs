import { Vector } from '../Math/Vector';

export interface IRun {
  getStitches: (pixelsPerMm: number) => Vector[];
}
