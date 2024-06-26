import { BoundingBox } from '../Math/BoundingBox';
import { Vector } from '../Math/Vector';
import { Thread } from './Thread';

export interface IResolvedStitches {
  width: number;
  height: number;
  pixelsPerUnit: number;
  boundingBox: BoundingBox;
  stitchCount: number;
  threads: {
    thread: Thread;
    runs: Vector[][];
  }[];
}

export class Pattern {
  widthPx: number;
  heightPx: number;
  threads: Thread[];
  constructor(widthPx: number, heightPx: number) {
    this.widthPx = widthPx;
    this.heightPx = heightPx;
    this.threads = [];
  }
  addThread(red: number, green: number, blue: number): Thread {
    const thread = new Thread(red, green, blue);
    this.threads.push(thread);
    return thread;
  }
  getStitches(width: number, height: number, pixelMultiplier: number): IResolvedStitches {
    const dimensions =
      width / height > this.widthPx / this.heightPx
        ? { width: (this.widthPx / this.heightPx) * height, height: height }
        : { width: width, height: (this.heightPx / this.widthPx) * width };
    const pixelsPerUnit = (pixelMultiplier * this.widthPx) / dimensions.width;
    const resolvedStitches: IResolvedStitches = {
      width: dimensions.width,
      height: dimensions.height,
      pixelsPerUnit: pixelsPerUnit,
      boundingBox: new BoundingBox(
        new Vector(Infinity, Infinity),
        new Vector(-Infinity, -Infinity),
      ),
      stitchCount: 0,
      threads: [],
    };
    for (const t of this.threads) {
      const thread = { thread: t, runs: [] as Vector[][] };
      for (const r of t.runs) {
        const run: Vector[] = [];
        for (const stitch of r.getStitches(pixelsPerUnit)) {
          if (isNaN(stitch.x) || isNaN(stitch.y)) continue;
          run.push(stitch);
          resolvedStitches.stitchCount++;
          if (stitch.x < resolvedStitches.boundingBox.min.x)
            resolvedStitches.boundingBox.min.x = stitch.x;
          if (stitch.y < resolvedStitches.boundingBox.min.y)
            resolvedStitches.boundingBox.min.y = stitch.y;
          if (stitch.x > resolvedStitches.boundingBox.max.x)
            resolvedStitches.boundingBox.max.x = stitch.x;
          if (stitch.y > resolvedStitches.boundingBox.max.y)
            resolvedStitches.boundingBox.max.y = stitch.y;
        }
        thread.runs.push(run);
      }
      resolvedStitches.threads.push(thread);
    }
    return resolvedStitches;
  }
}
