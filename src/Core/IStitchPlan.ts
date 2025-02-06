import { BoundingBox } from '../Math/BoundingBox';
import { Thread } from './Thread';
import { Stitch } from './Stitch';

export interface IStitchPlan {
  width: number;
  height: number;
  pixelsPerUnit: number;
  boundingBox: BoundingBox;
  stitchCount: number;
  threads: {
    thread: Thread;
    runs: Stitch[][];
  }[];
}
