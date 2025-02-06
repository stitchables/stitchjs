import { IStitchPlan } from '../../Core/IStitchPlan';

export interface IWriter {
  write: (stitchPlan: IStitchPlan, filename: string) => (number | string | Uint8Array)[];
}
