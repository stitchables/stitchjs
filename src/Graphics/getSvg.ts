import { Pattern } from '../Core/Pattern';

export interface ISvgOptions {
  units: string;
  pixelMultiplier: number;
  svgNamespace: string;
  significantFigures: number;
}

const defaultSvgOptions: ISvgOptions = {
  units: 'px',
  pixelMultiplier: 3.78,
  svgNamespace: 'http://www.w3.org/2000/svg',
  significantFigures: 5,
};

export function getSvg(
  pattern: Pattern,
  widthPx: number,
  heightPx: number,
  svgOptions: ISvgOptions = defaultSvgOptions,
): SVGElement {
  svgOptions = { ...svgOptions, ...defaultSvgOptions };
  const resolvedStitches = pattern.getStitches(
    widthPx,
    heightPx,
    svgOptions.pixelMultiplier,
  );
  const svg = document.createElementNS(svgOptions.svgNamespace, 'svg') as SVGElement;
  svg.setAttribute('viewBox', `0 0 ${pattern.widthPx} ${pattern.heightPx}`);
  svg.setAttribute('width', `${resolvedStitches.width}${svgOptions.units}`);
  svg.setAttribute('height', `${resolvedStitches.height}${svgOptions.units}`);
  for (const t of resolvedStitches.threads) {
    const group = document.createElementNS(svgOptions.svgNamespace, 'g');
    group.setAttribute(
      'style',
      `fill: none; stroke: rgb(${t.thread.red}, ${t.thread.green}, ${t.thread.blue});`,
    );
    svg.appendChild(group);
    for (const r of t.runs) {
      let d = '';
      for (const [i, stitch] of r.entries()) {
        const x = Number(stitch.x.toPrecision(svgOptions.significantFigures));
        const y = Number(stitch.y.toPrecision(svgOptions.significantFigures));
        d += `${i === 0 ? 'M' : ' L'} ${x} ${y}`;
      }
      const path = document.createElementNS(svgOptions.svgNamespace, 'path');
      path.setAttribute('stroke-linejoin', 'bevel');
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      path.setAttribute('d', d);
      group.appendChild(path);
    }
  }
  return svg;
}
