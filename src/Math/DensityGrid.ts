import { Vector } from './Vector';

export class DensityGrid {
  width: number;
  height: number;
  binSize: number;
  xBinCount: number;
  yBinCount: number;
  bins: number[];
  maxDensity: number;
  constructor(width: number, height: number, binSize: number) {
    this.width = width;
    this.height = height;
    this.binSize = binSize;
    this.xBinCount = Math.ceil(this.width / this.binSize);
    this.yBinCount = Math.ceil(this.height / this.binSize);
    this.bins = Array(this.xBinCount * this.yBinCount).fill(0);
    this.maxDensity = 0;
  }
  getDensityAtBin(x: number, y: number): number {
    if (x < 0 || x >= this.xBinCount || y < 0 || y >= this.yBinCount) return 0;
    return this.bins[Math.floor(y) * this.xBinCount + Math.floor(x)];
  }
  getDensityAtPoint(x: number, y: number): number {
    return this.getDensityAtBin(x / this.binSize, y / this.binSize);
  }
  addDensityAtBin(x: number, y: number, density: number): boolean {
    if (x >= 0 && x < this.xBinCount && y >= 0 && y < this.yBinCount) {
      this.bins[Math.floor(y) * this.xBinCount + Math.floor(x)] += density;
      if (this.bins[Math.floor(y) * this.xBinCount + Math.floor(x)] > this.maxDensity) {
        this.maxDensity = this.bins[Math.floor(y) * this.xBinCount + Math.floor(x)];
      }
      return true;
    }
    return false;
  }
  addDensityAtPoint(x: number, y: number, density: number): boolean {
    return this.addDensityAtBin(x / this.binSize, y / this.binSize, density);
  }
  // https://www.geeksforgeeks.org/anti-aliased-line-xiaolin-wus-algorithm/
  addDensityXW(p: Vector, q: Vector, rejectionLimit: number): boolean {
    function iPartOfNumber(x: number): number {
      return Math.floor(x);
    }
    function fPartOfNumber(x: number): number {
      return x > 0 ? x - iPartOfNumber(x) : x - (iPartOfNumber(x) + 1);
    }
    function rfPartOfNumber(x: number): number {
      return 1 - fPartOfNumber(x);
    }
    function getDensityAdditions(
      x0: number,
      y0: number,
      x1: number,
      y1: number,
    ): { x: number; y: number; density: number }[] {
      let densityAdditions = [];
      const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
      if (steep) {
        [x0, y0] = [y0, x0];
        [x1, y1] = [y1, x1];
      }
      if (x0 > x1) {
        [x0, x1] = [x1, x0];
        [y0, y1] = [y1, y0];
      }
      const [dx, dy] = [x1 - x0, y1 - y0];
      const gradient = dy / dx || 1;
      let [xpxl1, xpxl2] = [Math.floor(x0), Math.floor(x1)];
      let intersectY = y0;
      if (steep) {
        for (let x = xpxl1; x <= xpxl2; x++) {
          densityAdditions.push({
            x: Math.floor(intersectY),
            y: x,
            density: rfPartOfNumber(intersectY),
          });
          densityAdditions.push({
            x: Math.floor(intersectY) - 1,
            y: x,
            density: fPartOfNumber(intersectY),
          });
          intersectY += gradient;
        }
      } else {
        for (let x = xpxl1; x <= xpxl2; x++) {
          densityAdditions.push({
            x: x,
            y: Math.floor(intersectY),
            density: rfPartOfNumber(intersectY),
          });
          densityAdditions.push({
            x: x,
            y: Math.floor(intersectY) - 1,
            density: fPartOfNumber(intersectY),
          });
          intersectY += gradient;
        }
      }
      return densityAdditions;
    }
    const densityAdditions = getDensityAdditions(
      p.x / this.binSize,
      p.y / this.binSize,
      q.x / this.binSize,
      q.y / this.binSize,
    );
    let isRejected = false;
    for (let densityAddition of densityAdditions) {
      if (
        this.getDensityAtBin(densityAddition.x, densityAddition.y) +
          densityAddition.density >
        rejectionLimit
      ) {
        isRejected = true;
        break;
      }
    }
    if (!isRejected) {
      for (let densityAddition of densityAdditions) {
        this.addDensityAtBin(
          densityAddition.x,
          densityAddition.y,
          1 - densityAddition.density,
        );
      }
      return true;
    }
    return false;
  }
}
