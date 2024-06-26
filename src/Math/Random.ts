function sfc32(uint128Hex: string): () => number {
  let a = parseInt(uint128Hex.substring(0, 8), 16);
  let b = parseInt(uint128Hex.substring(8, 16), 16);
  let c = parseInt(uint128Hex.substring(16, 24), 16);
  let d = parseInt(uint128Hex.substring(24, 32), 16);
  return function () {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export class Random {
  useA: boolean;
  prngA: () => number;
  prngB: () => number;
  constructor(hash: string) {
    if (hash === undefined) {
      hash = this.randomHash();
    }
    this.useA = false;
    this.prngA = sfc32(hash.substring(2, 34));
    this.prngB = sfc32(hash.substring(34, 66));
    for (let i = 0; i < 1e6; i += 2) {
      this.prngA();
      this.prngB();
    }
  }
  randomHash(): string {
    let hash = '0x';
    for (let i = 0; i < 64; i++) hash += Math.floor(Math.random() * 16).toString(16);
    return hash;
  }
  random_dec() {
    this.useA = !this.useA;
    return this.useA ? this.prngA() : this.prngB();
  }
  random_num(a: number, b: number): number {
    return a + (b - a) * this.random_dec();
  }
  random_int(a: number, b: number): number {
    return Math.floor(this.random_num(a, b + 1));
  }
  random_bool(p: number): boolean {
    return this.random_dec() < p;
  }
  random_choice(list: any[]): any {
    return list[this.random_int(0, list.length - 1)];
  }
}
