import { Polyline } from '../../Math/Polyline';
import { Vector } from '../../Math/Vector';
import { Stitch } from '../Stitch';

export class Satin {
  polyline: Polyline;
  widthPx: number;
  densityMm: number;
  constructor(polyline: Polyline, widthPx: number, densityMm: number) {
    [this.polyline, this.widthPx, this.densityMm] = [polyline, widthPx, densityMm];
  }
  getStitches(pixelsPerMm: number) {
    const resampled = this.polyline.getRadialDistanceResampled(
      pixelsPerMm * this.densityMm,
    ).vertices;
    if (this.polyline.isClosed) resampled.push(resampled[0]);
    const stitches = [] as Vector[];
    for (let i = 0; i < resampled.length; i++) {
      const current = resampled[i];
      let normal = new Vector(0, 0);
      if (i > 0) normal = normal.add(current.subtract(resampled[i - 1]).normalized());
      if (i < resampled.length - 1)
        normal = normal.add(resampled[i + 1].subtract(current).normalized());
      normal = normal.normalized().rotate(0.5 * Math.PI);
      stitches.push(current.add(normal.multiply(0.5 * this.widthPx)));
      stitches.push(current.subtract(normal.multiply(0.5 * this.widthPx)));
    }
    return Stitch.fromVectors(stitches);
  }
}
