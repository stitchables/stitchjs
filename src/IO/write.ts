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
  for (let t of resolvedStitches.threads) {
    for (let r of t.runs) {
      for (let v of r) {
        v = v.subtract(vTranslate).divide(scale);
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
