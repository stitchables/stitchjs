import { IWriter } from './IWriter';
import { Utils } from './Utils';
import { IStitchPlan } from '../../Core/IStitchPlan';

export class DSTWriter implements IWriter {
  data: (number | string | Uint8Array)[];
  constructor() {
    this.data = [];
  }
  bit(b: number): number {
    return 1 << b;
  }
  encodeRecord(x: number, y: number, flag: string): Uint8Array {
    y = -y;
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    switch (flag) {
      case 'JUMP':
      case 'SEQUIN_EJECT':
        b2 += this.bit(7);
      // fallthrough
      case 'STITCH':
        b2 += this.bit(0);
        b2 += this.bit(1);
        if (x > 40) {
          b2 += this.bit(2);
          x -= 81;
        }
        if (x < -40) {
          b2 += this.bit(3);
          x += 81;
        }
        if (x > 13) {
          b1 += this.bit(2);
          x -= 27;
        }
        if (x < -13) {
          b1 += this.bit(3);
          x += 27;
        }
        if (x > 4) {
          b0 += this.bit(2);
          x -= 9;
        }
        if (x < -4) {
          b0 += this.bit(3);
          x += 9;
        }
        if (x > 1) {
          b1 += this.bit(0);
          x -= 3;
        }
        if (x < -1) {
          b1 += this.bit(1);
          x += 3;
        }
        if (x > 0) {
          b0 += this.bit(0);
          x -= 1;
        }
        if (x < 0) {
          b0 += this.bit(1);
          x += 1;
        }
        if (x != 0)
          console.log('[Stitch Writer] Error: Write exceeded possible distance.');
        if (y > 40) {
          b2 += this.bit(5);
          y -= 81;
        }
        if (y < -40) {
          b2 += this.bit(4);
          y += 81;
        }
        if (y > 13) {
          b1 += this.bit(5);
          y -= 27;
        }
        if (y < -13) {
          b1 += this.bit(4);
          y += 27;
        }
        if (y > 4) {
          b0 += this.bit(5);
          y -= 9;
        }
        if (y < -4) {
          b0 += this.bit(4);
          y += 9;
        }
        if (y > 1) {
          b1 += this.bit(7);
          y -= 3;
        }
        if (y < -1) {
          b1 += this.bit(6);
          y += 3;
        }
        if (y > 0) {
          b0 += this.bit(7);
          y -= 1;
        }
        if (y < 0) {
          b0 += this.bit(6);
          y += 1;
        }
        if (y != 0)
          console.log('[Stitch Writer] Error: Write exceeded possible distance.');
        break;
      case 'COLOR_CHANGE':
        b2 = 0b11000011;
        break;
      case 'STOP':
        b2 = 0b11110011;
        break;
      case 'END':
        b2 = 0b11110011;
        break;
      case 'SEQUIN_MODE':
        b2 = 0b01000011;
        break;
      default:
        console.log(`Unexpected flag: ${flag}`);
    }
    return new Uint8Array([b0, b1, b2]);
  }
  write(stitchPlan: IStitchPlan, filename: string): (number | string | Uint8Array)[] {
    this.data = [];
    this.data.push(`LA:${Utils.padRight(filename.split('.')[0] || '', 16, ' ')}\r`);
    this.data.push(`ST:${Utils.padLeft(stitchPlan.stitchCount.toString(), 7, ' ')}\r`);
    this.data.push(
      `CO:${Utils.padLeft((stitchPlan.threads.length - 1).toString(), 3, ' ')}\r`,
    );
    this.data.push(
      `+X:${Utils.padLeft(
        Math.ceil(0.1 * 0.5 * stitchPlan.width * stitchPlan.pixelsPerUnit).toString(),
        5,
        ' ',
      )}\r`,
    );
    this.data.push(
      `-X:${Utils.padLeft(
        Math.ceil(0.1 * 0.5 * stitchPlan.width * stitchPlan.pixelsPerUnit).toString(),
        5,
        ' ',
      )}\r`,
    );
    this.data.push(
      `+Y:${Utils.padLeft(
        Math.ceil(0.1 * 0.5 * stitchPlan.height * stitchPlan.pixelsPerUnit).toString(),
        5,
        ' ',
      )}\r`,
    );
    this.data.push(
      `-Y:${Utils.padLeft(
        Math.ceil(0.1 * 0.5 * stitchPlan.height * stitchPlan.pixelsPerUnit).toString(),
        5,
        ' ',
      )}\r`,
    );
    this.data.push('AX:+    0\r');
    this.data.push('AY:+    0\r');
    this.data.push('MX:+    0\r');
    this.data.push('MY:+    0\r');
    this.data.push('PD:******\r');
    this.data.push(new Uint8Array([0x1a]));
    this.data.push(' '.repeat(387));
    this.encodeStitches(stitchPlan);
    this.data.push(this.encodeRecord(0, 0, 'END'));
    return this.data;
  }
  encodeStitches(stitchPlan: IStitchPlan): void {
    let xx = 0;
    let yy = 0;
    for (let i = 0; i < stitchPlan.threads.length; i++) {
      if (i > 0) this.data.push(this.encodeRecord(0, 0, 'COLOR_CHANGE'));
      for (let j = 0; j < stitchPlan.threads[i].runs.length; j++) {
        if (j > 0)
          this.data.push(
            this.encodeRecord(2, 2, 'JUMP'),
            this.encodeRecord(-4, -4, 'JUMP'),
            this.encodeRecord(2, 2, 'JUMP'),
          ); // trim
        for (let k = 0; k < stitchPlan.threads[i].runs[j].length; k++) {
          const stitch = stitchPlan.threads[i].runs[j][k];
          const x = 10 * stitch.position.x;
          const y = 10 * stitch.position.y;
          let dx = Math.round(x - xx);
          let dy = Math.round(y - yy);
          xx += dx;
          yy += dy;
          if (Math.abs(dx) >= 121 || Math.abs(dy) >= 121) {
            const steps = Math.max(Math.abs(0.01 * dx), Math.abs(0.01 * dy)) + 1;
            const inc = 1 / steps;
            let accx = 0;
            let accy = 0;
            const ddx = Math.round(dx * inc);
            const ddy = Math.round(dy * inc);
            for (let n = 0; n < steps - 1; n++) {
              this.data.push(this.encodeRecord(ddx, ddy, k === 0 ? 'JUMP' : 'STITCH'));
              accx += ddx;
              accy += ddy;
            }
            dx -= accx;
            dy -= accy;
          }
          this.data.push(this.encodeRecord(dx, dy, 'STITCH'));
        }
      }
    }
  }
}
