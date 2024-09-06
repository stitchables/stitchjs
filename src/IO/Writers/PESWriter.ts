import { IResolvedStitches } from '../../Core/Pattern';
import { IWriter } from './IWriter';
import { Utils } from './Utils';

export class PESWriter implements IWriter {
  data: (number | string | Uint8Array)[];
  constructor() {
    this.data = [];
  }
  writeString(string: string): void {
    this.data.push(string);
  }
  writeBytes(bytes: Uint8Array): void {
    this.data.push(bytes);
  }
  writeInt(value: number, bytes: number, endien = 'L'): void {
    this.data.push(Utils.integerToBinary(value, bytes, endien));
  }
  write(
    stitchPattern: IResolvedStitches,
    filename: string,
  ): (number | string | Uint8Array)[] {
    this.data = [];
    this.writeString('#PES0001');
    this.writeBytes(new Uint8Array([0x16]));
    this.writeBytes(new Uint8Array(new Array(13).fill(0x00)));
    this.writeString(
      `LA:${Utils.padRight(filename.split('.')[0].substring(0, 8), 16, ' ')}\r`,
    );
    this.writeBytes(new Uint8Array(new Array(12).fill(0x20)));
    this.writeBytes(new Uint8Array([0xff]));
    this.writeBytes(new Uint8Array([0x00]));
    this.writeBytes(new Uint8Array([0x06]));
    this.writeBytes(new Uint8Array([0x26]));
    this.writeBytes(new Uint8Array(new Array(12).fill(0x20)));
    this.writeInt(stitchPattern.threads.length - 1, 1, 'L');
    // todo: implemenet color matching
    const colorList = [0x05, 0x38, 0x15];
    for (let i = 0; i < stitchPattern.threads.length; i++) {
      this.writeInt(colorList[i % 3], 1, 'L');
    }
    this.writeBytes(
      new Uint8Array(new Array(463 - stitchPattern.threads.length).fill(0x20)),
    );
    this.writeBytes(new Uint8Array([0x00, 0x00]));
    const graphicsOffsetValue = new Uint8Array(3);
    this.writeBytes(graphicsOffsetValue);
    this.writeBytes(new Uint8Array([0x31]));
    this.writeBytes(new Uint8Array([0xff]));
    this.writeBytes(new Uint8Array([0xf0]));
    this.writeInt(
      2 * Math.ceil(10 * 0.5 * stitchPattern.width * stitchPattern.pixelsPerUnit),
      2,
      'L',
    );
    this.writeInt(
      2 * Math.ceil(10 * 0.5 * stitchPattern.height * stitchPattern.pixelsPerUnit),
      2,
      'L',
    );
    this.writeBytes(new Uint8Array([0xe0, 0x01]));
    this.writeBytes(new Uint8Array([0xb0, 0x01]));
    this.writeInt(
      0x9000 + Math.ceil(10 * 0.5 * stitchPattern.width * stitchPattern.pixelsPerUnit),
      2,
      'B',
    );
    this.writeInt(
      0x9000 + Math.ceil(10 * 0.5 * stitchPattern.height * stitchPattern.pixelsPerUnit),
      2,
      'B',
    );
    const stitchEncodingByteCount = this.encodeStitches(stitchPattern);
    const graphicsOffsetBytes = Utils.integerToBinary(
      20 + stitchEncodingByteCount,
      3,
      'L',
    );
    for (let i = 0; i < 3; i++) graphicsOffsetValue[i] = graphicsOffsetBytes[i];
    for (let i = 0; i < stitchPattern.threads.length + 1; i++) this.writePECGraphics();
    return this.data;
  }
  encodeCommand(command: string, dx: number, dy: number): number {
    switch (command) {
      case 'STITCH':
        if (dx < 63 && dx > -64 && dy < 63 && dy > -64) {
          this.writeInt((dx >>> 0) & 0b01111111, 1, 'L');
          this.writeInt((dy >>> 0) & 0b01111111, 1, 'L');
          return 2;
        } else {
          this.writeInt(((dx >>> 0) & 0b00001111_11111111) | 0b10000000_00000000, 2, 'B');
          this.writeInt(((dy >>> 0) & 0b00001111_11111111) | 0b10000000_00000000, 2, 'B');
          return 4;
        }
      case 'TRIM':
        this.writeInt(((dx >>> 0) & 0b00001111_11111111) | 0b10100000_00000000, 2, 'B');
        this.writeInt(((dy >>> 0) & 0b00001111_11111111) | 0b10100000_00000000, 2, 'B');
        return 4;
      case 'COLOR_CHANGE':
        this.writeBytes(new Uint8Array([0xfe]));
        this.writeBytes(new Uint8Array([0xb0]));
        this.writeInt(dx % 2 === 0 ? 2 : 1, 1, 'L');
        return 3;
      case 'END':
        this.writeBytes(new Uint8Array([0xff]));
        return 1;
      default:
        console.log(`Unexpected command: ${command}`);
        return 1;
    }
  }
  encodeStitches(stitchPattern: IResolvedStitches): number {
    let byteCounter = 0;
    let [xx, yy] = [0, 0];
    for (let i = 0; i < stitchPattern.threads.length; i++) {
      if (i > 0) byteCounter += this.encodeCommand('COLOR_CHANGE', i - 1, 0);
      for (let j = 0; j < stitchPattern.threads[i].runs.length; j++) {
        for (let k = 0; k < stitchPattern.threads[i].runs[j].length; k++) {
          const stitch = stitchPattern.threads[i].runs[j][k];
          let dx = Math.round(10 * stitch.x - xx);
          let dy = Math.round(10 * stitch.y - yy);
          xx += dx;
          yy += dy;
          if (k === 0) {
            byteCounter += this.encodeCommand('TRIM', dx, dy);
            byteCounter += this.encodeCommand('STITCH', 0, 0);
            dx = 0;
            dy = 0;
          }
          byteCounter += this.encodeCommand('STITCH', dx, dy);
        }
      }
    }
    byteCounter += this.encodeCommand('END', 0, 0);
    return byteCounter;
  }
  writePECGraphics(): void {
    this.writeBytes(
      new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0xff, 0xff, 0xff, 0xff, 0x0f, 0x08,
        0x00, 0x00, 0x00, 0x00, 0x10, 0x04, 0x00, 0x00, 0x00, 0x00, 0x20, 0x02, 0x00,
        0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00,
        0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00,
        0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00,
        0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
        0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02,
        0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00,
        0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00,
        0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00,
        0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00,
        0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40,
        0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02,
        0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00,
        0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x02, 0x00, 0x00,
        0x00, 0x00, 0x40, 0x02, 0x00, 0x00, 0x00, 0x00, 0x40, 0x04, 0x00, 0x00, 0x00,
        0x00, 0x20, 0x08, 0x00, 0x00, 0x00, 0x00, 0x10, 0xf0, 0xff, 0xff, 0xff, 0xff,
        0x0f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]),
    );
  }
}
