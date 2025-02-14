import { Pattern } from '../Core/Pattern';
import { Vector } from '../Math/Vector';

function rgbToHex(r: number, g: number, b: number): string {
  const rHex = Math.round(r).toString(16).padStart(2, '0');
  const gHex = Math.round(g).toString(16).padStart(2, '0');
  const bHex = Math.round(b).toString(16).padStart(2, '0');
  return `#${rHex}${gHex}${bHex}`;
}
function shadeColor(color: string, percent: number): string {
  const num = parseInt(color.slice(1), 16);
  const amt = Math.round(2.55 * percent);
  const r = (num >> 16) + amt;
  const g = ((num >> 8) & 0x00ff) + amt;
  const b = (num & 0x0000ff) + amt;
  return (
    '#' +
    (
      0x1000000 +
      (r < 255 ? (r < 1 ? 0 : r) : 255) * 0x10000 +
      (g < 255 ? (g < 1 ? 0 : g) : 255) * 0x100 +
      (b < 255 ? (b < 1 ? 0 : b) : 255)
    )
      .toString(16)
      .slice(1)
  );
}

export function getCanvas(
  pattern: Pattern,
  widthPx: number,
  heightPx: number,
  pixelMultiplier: number,
): HTMLCanvasElement {
  const stitchPlan = pattern.getStitchPlan(widthPx, heightPx, pixelMultiplier);
  const scale = pixelMultiplier / stitchPlan.pixelsPerUnit;
  const translate = new Vector(
    0.5 * (widthPx - stitchPlan.width),
    0.5 * (heightPx - stitchPlan.height),
  );
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [widthPx, heightPx];
  const context = canvas.getContext('2d');
  if (!context) {
    return canvas;
  }
  [context.lineWidth, context.lineJoin] = [3, 'round'];
  for (const t of stitchPlan.threads) {
    const hexColor = rgbToHex(t.thread.red, t.thread.green, t.thread.blue);
    const endColor = shadeColor(hexColor, -60);
    const midColor = shadeColor(hexColor, 60);
    for (const r of t.runs) {
      for (let i = 1; i < r.length; i++) {
        const prevStitch = r[i - 1].position.multiply(scale).add(translate);
        const currStitch = r[i].position.multiply(scale).add(translate);
        const [dx, dy] = [currStitch.x - prevStitch.x, currStitch.y - prevStitch.y];
        const gWidth = Math.sqrt(dx * dx + dy * dy);
        // const gradient = context.createRadialGradient(
        //   currStitch.x - dx,
        //   currStitch.y - dy,
        //   0,
        //   currStitch.x - dx,
        //   currStitch.y - dy,
        //   gWidth,
        // );
        const gradient = context.createRadialGradient(
          prevStitch.x,
          prevStitch.y,
          0,
          prevStitch.x,
          prevStitch.y,
          gWidth,
        );
        gradient.addColorStop(0, endColor);
        gradient.addColorStop(0.05, hexColor);
        gradient.addColorStop(0.5, midColor);
        gradient.addColorStop(0.9, hexColor);
        gradient.addColorStop(1.0, endColor);
        context.strokeStyle = gradient;
        context.beginPath();
        context.moveTo(prevStitch.x, prevStitch.y);
        context.lineTo(currStitch.x, currStitch.y);
        context.stroke();
      }
    }
  }
  return canvas;
}
