import { Polyline } from '../Math/Polyline';
import { Vector } from '../Math/Vector';
import { IRun } from './IRun';

export class Run implements IRun {
  polyline: Polyline;
  density: number;
  constructor(polyline: Polyline, density: number) {
    this.polyline = polyline;
    this.density = density;
  }
  getStitches(pixelsPerMm: number): Vector[] {
    const resampled = this.polyline.getResampled(pixelsPerMm * this.density).vertices;
    if (this.polyline.isClosed) return [...resampled, resampled[0]];
    return resampled;
  }
}
