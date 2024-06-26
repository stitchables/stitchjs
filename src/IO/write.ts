import { Pattern } from '../Core/Pattern';
import { Vector } from '../Math/Vector';
import { DSTWriter } from './Writers/DSTWriter';
import { IWriter } from './Writers/IWriter';
import { PESWriter } from './Writers/PESWriter';

export enum ESupportedOutputFormats {
  'dst' = 0,
  'pes' = 1,
}

export function write(
  pattern: Pattern,
  widthMm: number,
  heightMm: number,
  filename: string,
): void {
  const resolvedStitches = pattern.getStitches(widthMm, heightMm, 1);
  // center the pattern and convert units to millimeters
  const vTranslate = new Vector(
    0.5 * resolvedStitches.width * resolvedStitches.pixelsPerUnit,
    0.5 * resolvedStitches.height * resolvedStitches.pixelsPerUnit,
  );
  const scale = resolvedStitches.pixelsPerUnit;
  for (let i = 0; i < resolvedStitches.threads.length; i++) {
    for (let j = 0; j < resolvedStitches.threads[i].runs.length; j++) {
      for (let k = 0; k < resolvedStitches.threads[i].runs[j].length; k++) {
        resolvedStitches.threads[i].runs[j][k] =
          resolvedStitches.threads[i].runs[j][k].subtract(vTranslate);
        resolvedStitches.threads[i].runs[j][k] =
          resolvedStitches.threads[i].runs[j][k].divide(scale);
      }
    }
  }
  resolvedStitches.width /= resolvedStitches.pixelsPerUnit;
  resolvedStitches.height /= resolvedStitches.pixelsPerUnit;
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
    writer.write(resolvedStitches, filename);
  }
}
