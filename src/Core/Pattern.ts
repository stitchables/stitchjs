import { BoundingBox } from '../Math/BoundingBox';
import { Vector } from '../Math/Vector';
import { Thread } from './Thread';
import { Stitch } from './Stitch';
import { IStitchPlan } from './IStitchPlan';

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
  getStitchPlan(width: number, height: number, pixelMultiplier: number): IStitchPlan {
    const dimensions =
      width / height > this.widthPx / this.heightPx
        ? { width: (this.widthPx / this.heightPx) * height, height: height }
        : { width: width, height: (this.heightPx / this.widthPx) * width };
    const pixelsPerUnit = (pixelMultiplier * this.widthPx) / dimensions.width;
    const stitchPlan: IStitchPlan = {
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
      const thread = { thread: t, runs: [] as Stitch[][] };
      for (const r of t.runs) {
        const run: Stitch[] = [];
        for (const stitch of r.getStitches(pixelsPerUnit)) {
          if (isNaN(stitch.position.x) || isNaN(stitch.position.y)) continue;
          run.push(stitch);
          stitchPlan.stitchCount++;
          if (stitch.position.x < stitchPlan.boundingBox.min.x)
            stitchPlan.boundingBox.min.x = stitch.position.x;
          if (stitch.position.y < stitchPlan.boundingBox.min.y)
            stitchPlan.boundingBox.min.y = stitch.position.y;
          if (stitch.position.x > stitchPlan.boundingBox.max.x)
            stitchPlan.boundingBox.max.x = stitch.position.x;
          if (stitch.position.y > stitchPlan.boundingBox.max.y)
            stitchPlan.boundingBox.max.y = stitch.position.y;
        }
        thread.runs.push(run);
      }
      stitchPlan.threads.push(thread);
    }
    return stitchPlan;
  }
}
