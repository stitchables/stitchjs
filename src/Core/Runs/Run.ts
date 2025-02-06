import { Polyline } from '../../Math/Polyline';
import { Vector } from '../../Math/Vector';
import { IRun } from '../IRun';
import { Stitch } from '../Stitch';

export class Run implements IRun {
  polyline: Polyline;
  density: number;
  constructor(polyline: Polyline, density: number) {
    this.polyline = polyline;
    this.density = density;
  }
  getStitches(pixelsPerMm: number): Stitch[] {
    const resampled = this.polyline.getRadialDistanceResampled(
      pixelsPerMm * this.density,
    ).vertices;
    if (this.polyline.isClosed) return Stitch.fromVectors([...resampled, resampled[0]]);
    return Stitch.fromVectors(resampled);
  }
}
