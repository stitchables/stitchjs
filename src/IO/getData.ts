import { Pattern } from '../Core/Pattern';
import { Vector } from '../Math/Vector';
import { DSTWriter } from './Writers/DSTWriter';
import { IWriter } from './Writers/IWriter';
import { PESWriter } from './Writers/PESWriter';

export function getData(
  pattern: Pattern,
  widthMm: number,
  heightMm: number,
  filename: string,
): Blob | undefined {
  const stitchPlan = pattern.getStitchPlan(widthMm, heightMm, 1);
  // center the pattern and convert units to millimeters
  const vTranslate = new Vector(
    0.5 * stitchPlan.width * stitchPlan.pixelsPerUnit,
    0.5 * stitchPlan.height * stitchPlan.pixelsPerUnit,
  );
  const scale = stitchPlan.pixelsPerUnit;
  for (let i = 0; i < stitchPlan.threads.length; i++) {
    for (let j = 0; j < stitchPlan.threads[i].runs.length; j++) {
      for (let k = 0; k < stitchPlan.threads[i].runs[j].length; k++) {
        stitchPlan.threads[i].runs[j][k].position =
          stitchPlan.threads[i].runs[j][k].position.subtract(vTranslate);
        stitchPlan.threads[i].runs[j][k].position =
          stitchPlan.threads[i].runs[j][k].position.divide(scale);
      }
    }
  }
  stitchPlan.width /= stitchPlan.pixelsPerUnit;
  stitchPlan.height /= stitchPlan.pixelsPerUnit;
  let writer: IWriter | undefined = undefined;
  switch (filename.toLowerCase().split('.')[1]) {
    case 'dst':
      writer = new DSTWriter();
      break;
    case 'pes':
      writer = new PESWriter();
      break;
    default:
      alert(`[Stitch.IO.write] Unsupported file extension: ${filename}`);
  }
  if (writer !== undefined) {
    return new Blob(writer.write(stitchPlan, filename) as BlobPart[], {
      type: 'application/octet-stream',
    });
  }
  return undefined;
}
