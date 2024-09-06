import { Pattern } from '../Core/Pattern';
import { getData } from './getData';
import { Utils } from './Writers/Utils';

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
  const data = getData(pattern, widthMm, heightMm, filename);
  if (data) {
    Utils.saveData(data, filename);
  }
}
