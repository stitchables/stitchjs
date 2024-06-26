import { IResolvedStitches } from '../../Core/Pattern';

export interface IWriter {
  write: (resolvedStitches: IResolvedStitches, filename: string) => void;
}
