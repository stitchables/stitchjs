import { Pattern } from '../Core/Pattern';
import { DensityGrid } from '../Math/DensityGrid';
import { Utils } from '../Math/Utils';

export function getStitchDensityCanvas(
  pattern: Pattern,
  widthPx: number,
  heightPx: number,
  widthMm: number,
  heightMm: number,
  gridSizeMm: number,
  minStitchesPerBin: number = 5,
  maxStitchesPerBin: number = 10,
  color: number[] = [255, 0, 0],
): HTMLCanvasElement {
  const resolvedStitches = pattern.getStitchPlan(widthMm, heightMm, 1);
  const densityGrid = new DensityGrid(widthMm, heightMm, gridSizeMm);
  for (const t of resolvedStitches.threads) {
    for (const r of t.runs) {
      for (const [i, stitch] of r.entries()) {
        densityGrid.addDensityAtPoint(
          stitch.position.x / resolvedStitches.pixelsPerUnit,
          stitch.position.y / resolvedStitches.pixelsPerUnit,
          1,
        );
      }
      for (let i = 1; i < r.length; i++) {
        densityGrid.addDensityXW(
          r[i - 1].position.divide(resolvedStitches.pixelsPerUnit),
          r[i].position.divide(resolvedStitches.pixelsPerUnit),
          Infinity,
        );
      }
    }
  }
  const canvas = document.createElement('canvas');
  if (pattern.widthPx / pattern.heightPx > widthPx / heightPx) {
    [canvas.width, canvas.height] = [
      widthPx,
      (pattern.heightPx / pattern.widthPx) * widthPx,
    ];
  } else {
    [canvas.width, canvas.height] = [
      (pattern.widthPx / pattern.heightPx) * heightPx,
      heightPx,
    ];
  }
  const context = canvas.getContext('2d');
  if (!context) {
    return canvas;
  }
  for (let i = 0; i < densityGrid.xBinCount; i++) {
    for (let j = 0; j < densityGrid.yBinCount; j++) {
      const density = Utils.map(
        densityGrid.getDensityAtBin(i, j),
        minStitchesPerBin,
        maxStitchesPerBin,
        0,
        1,
        true,
      );
      context.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${density})`;
      context.fillRect(
        ((i * densityGrid.binSize - 0.5 * widthMm) * canvas.width) / widthMm +
          0.5 * canvas.width,
        ((j * densityGrid.binSize - 0.5 * heightMm) * canvas.width) / widthMm +
          0.5 * canvas.height,
        (densityGrid.binSize * canvas.width) / widthMm,
        (densityGrid.binSize * canvas.width) / widthMm,
      );
    }
  }
  return canvas;
}
