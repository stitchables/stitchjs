/*
 * Mesa 3-D graphics library
 * Version:  6.5
 *
 * Copyright (C) 2006  Brian Paul   All Rights Reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included
 * in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 * OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL
 * BRIAN PAUL BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN
 * AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/*
 * SimplexNoise1234
 * Copyright (c) 2003-2005, Stefan Gustavson
 *
 * Contact: stegu@itn.liu.se
 */

/** \file
 \brief C implementation of Perlin Simplex Noise over 1,2,3, and 4 dimensions.
 \author Stefan Gustavson (stegu@itn.liu.se)
 */

/*
 * This implementation is "Simplex Noise" as presented by
 * Ken Perlin at a relatively obscure and not often cited course
 * session "Real-Time Shading" at Siggraph 2001 (before real
 * time shading actually took on), under the title "hardware noise".
 * The 3D function is numerically equivalent to his Java reference
 * code available in the PDF course notes, although I re-implemented
 * it from scratch to get more readable code. The 1D, 2D and 4D cases
 * were implemented from scratch by me from Ken Perlin's text.
 *
 * This file has no dependencies on any other file, not even its own
 * header file. The header file is made for use by external code only.
 */

function fastFloor(x: number): number {
  return x > 0 ? Math.floor(x) : Math.floor(x) - 1;
}

/*
 * ---------------------------------------------------------------------
 * inline data
 */

/*
 * Permutation table. This is just a random jumble of all numbers 0-255,
 * repeated twice to avoid wrapping the index at 255 for each lookup.
 * This needs to be exactly the same for all instances on all platforms,
 * so it's easiest to just keep it as inline explicit data.
 * This also removes the need for any initialisation of this class.
 *
 * Note that making this an int[] instead of a char[] might make the
 * code run faster on platforms with a high penalty for unaligned single
 * byte addressing. Intel x86 is generally single-byte-friendly, but
 * some other CPUs are faster with 4-aligned reads.
 * However, a char[] is smaller, which avoids cache trashing, and that
 * is probably the most important aspect on most architectures.
 * This array is accessed a *lot* by the noise functions.
 * A vector-valued noise over 3D accesses it 96 times, and a
 * float-valued 4D noise 64 times. We want this to fit in the cache!
 */

const perm: number[] = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30,
  69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94,
  252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136,
  171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229,
  122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25,
  63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116,
  188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202,
  38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28,
  42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43,
  172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218,
  246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145,
  235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115,
  121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141,
  128, 195, 78, 66, 215, 61, 156, 180, 151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96,
  53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6,
  148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33,
  88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48,
  27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55,
  46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208,
  89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
  52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59,
  227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154,
  163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79,
  113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144,
  12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199,
  106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222,
  114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
];

/*
 * ---------------------------------------------------------------------
 */

/*
 * Helper functions to compute gradients-dot-residualvectors (1D to 4D)
 * Note that these generate gradients of more than unit length. To make
 * a close match with the value range of classic Perlin noise, the final
 * noise values need to be rescaled to fit nicely within [-1,1].
 * (The simplex noise functions as such also have different scaling.)
 * Note also that these noise functions are the most practical and useful
 * signed version of Perlin noise. To return values according to the
 * RenderMan specification from the SL noise() and pnoise() functions,
 * the noise values need to be scaled and offset to [0,1], like this:
 * float SLnoise = (SimplexNoise1234::noise(x,y,z) + 1.0) * 0.5;
 */

function grad1(hash: number, x: number): number {
  const h = hash & 15;
  let grad = 1.0 + (h & 7); // Gradient value 1.0, 2.0, ..., 8.0
  if (h & 8) grad = -grad; // Set a random sign for the gradient
  return grad * x; // Multiply the gradient with the distance
}

function grad2(hash: number, x: number, y: number): number {
  const h = hash & 7; // Convert low 3 bits of hash code
  const u = h < 4 ? x : y; // into 8 simple gradient directions
  const v = h < 4 ? y : x; // and compute the dot product with (x, y)
  return (h & 1 ? -u : u) + (h & 2 ? -2.0 * v : 2.0 * v);
}

function grad3(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15; // Convert low 4 bits of hash code into 12 simple gradients
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z; // Fix repeats at h = 12 to 15
  return (h & 1 ? -u : u) + (h & 2 ? -v : v);
}

function grad4(hash: number, x: number, y: number, z: number, t: number): number {
  const h = hash & 31; // Convert low 5 bits of hash code into 32 simple gradients
  const u = h < 24 ? x : y;
  const v = h < 16 ? y : z;
  const w = h < 8 ? z : t;
  return (h & 1 ? -u : u) + (h & 2 ? -v : v) + (h & 4 ? -w : w);
}

/* A lookup table to traverse the simplex around a given point in 4D. */
/* Details can be found where this table is used, in the 4D noise method. */
/* TODO: This should not be required, backport it from Bill's GLSL code! */
const simplex: number[][] = [
  [0, 1, 2, 3],
  [0, 1, 3, 2],
  [0, 0, 0, 0],
  [0, 2, 3, 1],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [1, 2, 3, 0],
  [0, 2, 1, 3],
  [0, 0, 0, 0],
  [0, 3, 1, 2],
  [0, 3, 2, 1],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [1, 3, 2, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [1, 2, 0, 3],
  [0, 0, 0, 0],
  [1, 3, 0, 2],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [2, 3, 0, 1],
  [2, 3, 1, 0],
  [1, 0, 2, 3],
  [1, 0, 3, 2],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [2, 0, 3, 1],
  [0, 0, 0, 0],
  [2, 1, 3, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [2, 0, 1, 3],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [3, 0, 1, 2],
  [3, 0, 2, 1],
  [0, 0, 0, 0],
  [3, 1, 2, 0],
  [2, 1, 0, 3],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [3, 1, 0, 2],
  [0, 0, 0, 0],
  [3, 2, 0, 1],
  [3, 2, 1, 0],
];

/* 1D simplex noise */
function _slang_library_noise1(x: number): number {
  const i0 = fastFloor(x);
  const i1 = i0 + 1;
  const x0 = x - i0;
  const x1 = x0 - 1.0;

  let t0 = 1.0 - x0 * x0;
  t0 *= t0;
  const n0 = t0 * t0 * grad1(perm[i0 & 0xff], x0);

  let t1 = 1.0 - x1 * x1;
  t1 *= t1;
  const n1 = t1 * t1 * grad1(perm[i1 & 0xff], x1);

  // Scale the result to fit the expected range
  return 0.25 * (n0 + n1);
}

/* 2D simplex noise */
function _slang_library_noise2(x: number, y: number): number {
  const F2 = 0.366025403; // F2 = 0.5 * (Math.sqrt(3.0) - 1.0)
  const G2 = 0.211324865; // G2 = (3.0 - Math.sqrt(3.0)) / 6.0

  let n0: number, n1: number, n2: number;

  // Skew the input space to determine which simplex cell we're in
  const s = (x + y) * F2;
  const xs = x + s;
  const ys = y + s;
  const i = fastFloor(xs);
  const j = fastFloor(ys);

  const t = (i + j) * G2;
  const X0 = i - t;
  const Y0 = j - t;
  const x0 = x - X0;
  const y0 = y - Y0;

  let i1: number, j1: number;
  if (x0 > y0) {
    i1 = 1;
    j1 = 0; // Lower triangle, XY order
  } else {
    i1 = 0;
    j1 = 1; // Upper triangle, YX order
  }

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1.0 + 2.0 * G2;
  const y2 = y0 - 1.0 + 2.0 * G2;

  const ii = i & 0xff;
  const jj = j & 0xff;

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 < 0.0) {
    n0 = 0.0;
  } else {
    t0 *= t0;
    n0 = t0 * t0 * grad2(perm[ii + perm[jj]], x0, y0);
  }

  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 < 0.0) {
    n1 = 0.0;
  } else {
    t1 *= t1;
    n1 = t1 * t1 * grad2(perm[ii + i1 + perm[jj + j1]], x1, y1);
  }

  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 < 0.0) {
    n2 = 0.0;
  } else {
    t2 *= t2;
    n2 = t2 * t2 * grad2(perm[ii + 1 + perm[jj + 1]], x2, y2);
  }

  return 40.0 * (n0 + n1 + n2); // Scale factor for [-1, 1] interval
}

/* 3D simplex noise */
function _slang_library_noise3(x: number, y: number, z: number): number {
  const F3 = 0.333333333;
  const G3 = 0.166666667;

  let n0: number, n1: number, n2: number, n3: number;

  const s = (x + y + z) * F3;
  const xs = x + s;
  const ys = y + s;
  const zs = z + s;
  const i = fastFloor(xs);
  const j = fastFloor(ys);
  const k = fastFloor(zs);

  const t = (i + j + k) * G3;
  const X0 = i - t;
  const Y0 = j - t;
  const Z0 = k - t;
  const x0 = x - X0;
  const y0 = y - Y0;
  const z0 = z - Z0;

  let i1: number, j1: number, k1: number;
  let i2: number, j2: number, k2: number;

  if (x0 >= y0) {
    if (y0 >= z0) {
      i1 = 1;
      j1 = 0;
      k1 = 0;
      i2 = 1;
      j2 = 1;
      k2 = 0; // X Y Z order
    } else if (x0 >= z0) {
      i1 = 1;
      j1 = 0;
      k1 = 0;
      i2 = 1;
      j2 = 0;
      k2 = 1; // X Z Y order
    } else {
      i1 = 0;
      j1 = 0;
      k1 = 1;
      i2 = 1;
      j2 = 0;
      k2 = 1; // Z X Y order
    }
  } else {
    if (y0 < z0) {
      i1 = 0;
      j1 = 0;
      k1 = 1;
      i2 = 0;
      j2 = 1;
      k2 = 1; // Z Y X order
    } else if (x0 < z0) {
      i1 = 0;
      j1 = 1;
      k1 = 0;
      i2 = 0;
      j2 = 1;
      k2 = 1; // Y Z X order
    } else {
      i1 = 0;
      j1 = 1;
      k1 = 0;
      i2 = 1;
      j2 = 1;
      k2 = 0; // Y X Z order
    }
  }

  const x1 = x0 - i1 + G3;
  const y1 = y0 - j1 + G3;
  const z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2.0 * G3;
  const y2 = y0 - j2 + 2.0 * G3;
  const z2 = z0 - k2 + 2.0 * G3;
  const x3 = x0 - 1.0 + 3.0 * G3;
  const y3 = y0 - 1.0 + 3.0 * G3;
  const z3 = z0 - 1.0 + 3.0 * G3;

  const ii = i & 0xff;
  const jj = j & 0xff;
  const kk = k & 0xff;

  const t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
  if (t0 < 0.0) {
    n0 = 0.0;
  } else {
    const t0_sq = t0 * t0;
    n0 = t0_sq * t0_sq * grad3(perm[ii + perm[jj + perm[kk]]], x0, y0, z0);
  }

  const t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
  if (t1 < 0.0) {
    n1 = 0.0;
  } else {
    const t1_sq = t1 * t1;
    n1 = t1_sq * t1_sq * grad3(perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]], x1, y1, z1);
  }

  const t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
  if (t2 < 0.0) {
    n2 = 0.0;
  } else {
    const t2_sq = t2 * t2;
    n2 = t2_sq * t2_sq * grad3(perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]], x2, y2, z2);
  }

  const t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
  if (t3 < 0.0) {
    n3 = 0.0;
  } else {
    const t3_sq = t3 * t3;
    n3 = t3_sq * t3_sq * grad3(perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]], x3, y3, z3);
  }

  return 32.0 * (n0 + n1 + n2 + n3);
}

/* 4D simplex noise */
function _slang_library_noise4(x: number, y: number, z: number, w: number): number {
  /* The skewing and unskewing factors are hairy again for the 4D case */
  const F4 = (Math.sqrt(5.0) - 1.0) / 4.0;
  const G4 = (5.0 - Math.sqrt(5.0)) / 20.0;

  let n0: number, n1: number, n2: number, n3: number, n4: number;

  /* Skew the (x,y,z,w) space to determine which cell of 24 simplices we're in */
  const s = (x + y + z + w) * F4;
  const xs = x + s;
  const ys = y + s;
  const zs = z + s;
  const ws = w + s;
  const i = Math.floor(xs);
  const j = Math.floor(ys);
  const k = Math.floor(zs);
  const l = Math.floor(ws);

  const t = (i + j + k + l) * G4;
  const X0 = i - t;
  const Y0 = j - t;
  const Z0 = k - t;
  const W0 = l - t;

  const x0 = x - X0;
  const y0 = y - Y0;
  const z0 = z - Z0;
  const w0 = w - W0;

  /* Magnitude ordering to find which simplex we're in */
  const c1 = x0 > y0 ? 32 : 0;
  const c2 = x0 > z0 ? 16 : 0;
  const c3 = y0 > z0 ? 8 : 0;
  const c4 = x0 > w0 ? 4 : 0;
  const c5 = y0 > w0 ? 2 : 0;
  const c6 = z0 > w0 ? 1 : 0;
  const c = c1 + c2 + c3 + c4 + c5 + c6;

  let i1, j1, k1, l1;
  let i2, j2, k2, l2;
  let i3, j3, k3, l3;

  /* Determine the integer offsets for the simplex corners */
  i1 = simplex[c][0] >= 3 ? 1 : 0;
  j1 = simplex[c][1] >= 3 ? 1 : 0;
  k1 = simplex[c][2] >= 3 ? 1 : 0;
  l1 = simplex[c][3] >= 3 ? 1 : 0;

  i2 = simplex[c][0] >= 2 ? 1 : 0;
  j2 = simplex[c][1] >= 2 ? 1 : 0;
  k2 = simplex[c][2] >= 2 ? 1 : 0;
  l2 = simplex[c][3] >= 2 ? 1 : 0;

  i3 = simplex[c][0] >= 1 ? 1 : 0;
  j3 = simplex[c][1] >= 1 ? 1 : 0;
  k3 = simplex[c][2] >= 1 ? 1 : 0;
  l3 = simplex[c][3] >= 1 ? 1 : 0;

  /* Calculate the offsets for each corner */
  const x1 = x0 - i1 + G4;
  const y1 = y0 - j1 + G4;
  const z1 = z0 - k1 + G4;
  const w1 = w0 - l1 + G4;

  const x2 = x0 - i2 + 2.0 * G4;
  const y2 = y0 - j2 + 2.0 * G4;
  const z2 = z0 - k2 + 2.0 * G4;
  const w2 = w0 - l2 + 2.0 * G4;

  const x3 = x0 - i3 + 3.0 * G4;
  const y3 = y0 - j3 + 3.0 * G4;
  const z3 = z0 - k3 + 3.0 * G4;
  const w3 = w0 - l3 + 3.0 * G4;

  const x4 = x0 - 1.0 + 4.0 * G4;
  const y4 = y0 - 1.0 + 4.0 * G4;
  const z4 = z0 - 1.0 + 4.0 * G4;
  const w4 = w0 - 1.0 + 4.0 * G4;

  const ii = i & 0xff;
  const jj = j & 0xff;
  const kk = k & 0xff;
  const ll = l & 0xff;

  /* Contribution from each of the corners */
  let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0 - w0 * w0;
  if (t0 < 0) {
    n0 = 0;
  } else {
    t0 *= t0;
    n0 = t0 * t0 * grad4(perm[ii + perm[jj + perm[kk + perm[ll]]]], x0, y0, z0, w0);
  }

  let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1 - w1 * w1;
  if (t1 < 0) {
    n1 = 0;
  } else {
    t1 *= t1;
    n1 =
      t1 *
      t1 *
      grad4(
        perm[ii + i1 + perm[jj + j1 + perm[kk + k1 + perm[ll + l1]]]],
        x1,
        y1,
        z1,
        w1,
      );
  }

  let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2 - w2 * w2;
  if (t2 < 0) {
    n2 = 0;
  } else {
    t2 *= t2;
    n2 =
      t2 *
      t2 *
      grad4(
        perm[ii + i2 + perm[jj + j2 + perm[kk + k2 + perm[ll + l2]]]],
        x2,
        y2,
        z2,
        w2,
      );
  }

  let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3 - w3 * w3;
  if (t3 < 0) {
    n3 = 0;
  } else {
    t3 *= t3;
    n3 =
      t3 *
      t3 *
      grad4(
        perm[ii + i3 + perm[jj + j3 + perm[kk + k3 + perm[ll + l3]]]],
        x3,
        y3,
        z3,
        w3,
      );
  }

  let t4 = 0.6 - x4 * x4 - y4 * y4 - z4 * z4 - w4 * w4;
  if (t4 < 0) {
    n4 = 0;
  } else {
    t4 *= t4;
    n4 =
      t4 *
      t4 *
      grad4(perm[ii + 1 + perm[jj + 1 + perm[kk + 1 + perm[ll + 1]]]], x4, y4, z4, w4);
  }

  /* Sum up and scale the result */
  return 27.0 * (n0 + n1 + n2 + n3 + n4);
}

export function noise(
  x: number,
  y: number | undefined = undefined,
  z: number | undefined = undefined,
  w: number | undefined = undefined,
) {
  if (!y) {
    return _slang_library_noise1(x) * 0.5 + 0.5;
  } else if (!z) {
    return _slang_library_noise2(x, y) * 0.5 + 0.5;
  } else if (!w) {
    return _slang_library_noise3(x, y, z) * 0.5 + 0.5;
  } else {
    return _slang_library_noise4(x, y, z, w) * 0.5 + 0.5;
  }
}
