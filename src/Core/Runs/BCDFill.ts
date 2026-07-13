// BCDFill: cover a polygon (with holes) with back-and-forth fill lanes as ONE
// continuous stitch path, using a boustrophedon cellular decomposition (bcd)
// for the cells and voron8's medial-axis path finder for the travel runs.
//
// The tour
//   - visits every BCD cell at least once,
//   - fills a cell on its LAST visit,
//   - never travels through a cell that has already been filled,
//   - and never travels back over the fill lines it has just drawn,
// so every travel stitch lands on ground that is still bare and will be
// covered later.
//
// The tour is a DFS walk of a spanning tree of the cell-adjacency graph with
// POST-ORDER filling: a cell is filled exactly when the walk backtracks out of
// it for the last time. The walk only ever backtracks through tree ancestors,
// and ancestors are filled later, so the unfilled region always stays
// connected for the rest of the tour. The tree is rooted at the cell holding
// the EXIT point, which is therefore filled last and the path finishes exactly
// at the requested exit; both entry and exit are snapped to the polygon
// boundary.
//
// "Never travels through a filled cell" is not left to bookkeeping: after a
// cell is filled the path finder is REBUILT over the union of the still
// unfilled cells — the filled cell simply stops being part of the region, so
// no route can enter it. (Rebuilding beats the finder's incremental addWall():
// a sealing wall's endpoints land exactly ON boundary segments, and each such
// T-junction insertion costs CGAL heavy exact-kernel degeneracy resolution,
// while a rebuild from clean rings is fast and degeneracy-free.)
//
// Two exceptions to medial-axis travel, both about the just-filled cell: the
// hop OUT of it must not recross the fresh lanes, so it goes straight when the
// straight segment stays inside the cell and clear of the lanes, else along
// the cell boundary on the exit side of the last lane; and that hop happens
// BEFORE the cell is sealed, since its start lies inside the cell.

import { IRun } from '../IRun';
import { Vector } from '../../Math/Vector';
import { Stitch } from '../Stitch';
import { StitchType } from '../EStitchType';
import { Coordinate, Geometry, Polygon } from 'jsts/org/locationtech/jts/geom';
import { DistanceOp } from 'jsts/org/locationtech/jts/operation/distance';
import VWSimplifier from 'jsts/org/locationtech/jts/simplify/VWSimplifier';
import { createPolygon } from '../../Geometry/createPolygon';
import { resample } from '../../Geometry/resample';
import { geometryFactory } from '../../util/jsts';
import { decompose, DecompositionResult } from '@matthewjacobson/bcd';
import { MedialAxisPathFinder } from 'voron8';

type AutoFillPatternRow = {
  rowOffsetMm: number;
  rowPatternMm: number[];
};

type FillGradient = { endRowSpacingMm: number } & (
  | { mode: 'ramp'; start: number; end: number }
  | { mode: 'plateau'; center: number; plateauWidth: number }
);

type Pt = { x: number; y: number };

type Rot = { toSweep: (p: Pt) => Pt; fromSweep: (p: Pt) => Pt };

export type BCDFillPlanStep =
  | { type: 'travel'; path: Pt[]; found: boolean }
  | { type: 'fill'; cell: number; path: Pt[] }
  | { type: 'seal'; cell: number; walls: Array<[Pt, Pt]> };

export interface BCDFillPlan {
  steps: BCDFillPlanStep[];
  /** Cell rings (after any exit-cell split), in face order. */
  faces: Pt[][];
  /** Cells in the order they are FILLED. */
  fillSequence: number[];
  startCell: number;
  endCell: number;
  /** The snapped tour endpoints. */
  start: Pt;
  end: Pt;
  travelLength: number;
  fillLength: number;
  /** Travel legs the path finder failed on (should be 0). */
  unroutable: number;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const midPt = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const cross3 = (a: Pt, b: Pt, c: Pt) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function polylineLength(pts: Pt[]): number {
  let len = 0;
  for (let i = 0; i + 1 < pts.length; i++) len += dist(pts[i], pts[i + 1]);
  return len;
}

/** Even-odd point-in-ring test. */
function pointInRing(pt: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    const hit =
      a.y > pt.y !== b.y > pt.y &&
      pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x;
    if (hit) inside = !inside;
  }
  return inside;
}

/** Distance from point `p` to segment ab. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Index of the ring edge nearest to `p`, plus its distance. */
function nearestEdge(ring: Pt[], p: Pt): { edge: number; d: number } {
  const n = ring.length;
  let edge = 0,
    d = Infinity;
  for (let i = 0; i < n; i++) {
    const a = ring[i],
      b = ring[(i + 1) % n];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const di = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (di < d) {
      d = di;
      edge = i;
    }
  }
  return { edge, d };
}

/**
 * The two boundary arcs from `a` (on edge `ea` of `ring`) to `b` (on edge
 * `eb`), one walking the ring forward and one backward.
 */
function ringArcs(ring: Pt[], ea: number, eb: number, a: Pt, b: Pt): [Pt[], Pt[]] {
  const n = ring.length;
  const fwd: Pt[] = [a];
  for (let k = (ea + 1) % n; ; k = (k + 1) % n) {
    if ((k - 1 + n) % n === eb) break;
    fwd.push(ring[k]);
    if (fwd.length > n + 1) break;
  }
  fwd.push(b);
  const bwd: Pt[] = [a];
  for (let k = ea; ; k = (k - 1 + n) % n) {
    bwd.push(ring[k]);
    if (k === (eb + 1) % n) break;
    if (bwd.length > n + 1) break;
  }
  bwd.push(b);
  return [fwd, bwd];
}

/**
 * Proper crossing of open segments p1p2 and p3p4 with a grazing tolerance: an
 * endpoint within `tol` (absolute distance) of the other segment's line counts
 * as touching, not crossing. Planner points sit exactly ON boundaries and lane
 * ends up to float residue.
 */
function properCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt, tol: number): boolean {
  const d1 = cross3(p3, p4, p1),
    d2 = cross3(p3, p4, p2);
  const d3 = cross3(p1, p2, p3),
    d4 = cross3(p1, p2, p4);
  if (!(d1 * d2 < 0 && d3 * d4 < 0)) return false;
  const l34 = Math.hypot(p4.x - p3.x, p4.y - p3.y) * tol;
  const l12 = Math.hypot(p2.x - p1.x, p2.y - p1.y) * tol;
  return (
    Math.min(Math.abs(d1), Math.abs(d2)) > l34 &&
    Math.min(Math.abs(d3), Math.abs(d4)) > l12
  );
}

/** Ring centroid (area-weighted). */
function centroid(ring: Pt[]): Pt {
  let a = 0,
    cx = 0,
    cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i],
      q = ring[(i + 1) % n];
    const w = p.x * q.y - q.x * p.y;
    a += w;
    cx += (p.x + q.x) * w;
    cy += (p.y + q.y) * w;
  }
  return a !== 0
    ? { x: cx / (3 * a), y: cy / (3 * a) }
    : ring.reduce(
        (s, p) => ({ x: s.x + p.x / ring.length, y: s.y + p.y / ring.length }),
        { x: 0, y: 0 },
      );
}

/** Rotation between the original frame and a "sweep frame" (sweep angle -> +x). */
function makeRot(angle: number): Rot {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return {
    toSweep: (p) => ({ x: p.x * c + p.y * s, y: -p.x * s + p.y * c }),
    fromSweep: (p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }),
  };
}

/** Vertical span [lo, hi] where line X = x crosses an x-monotone ring, or null. */
function rowSpan(ring: Pt[], x: number): { lo: number; hi: number } | null {
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i],
      b = ring[(i + 1) % n];
    if (a.x === b.x) continue;
    if ((a.x <= x && x < b.x) || (b.x <= x && x < a.x)) {
      const y = a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  return hi > lo ? { lo, hi } : null;
}

/**
 * Back-and-forth fill corners for one BCD cell (original frame), leaving near
 * `exit`. Lanes are perpendicular to the sweep axis; the cell is x-monotone
 * in the sweep frame, so each lane is a single span. The lanes march from the
 * entry side toward the exit side (so the LAST lane is the one nearest the
 * exit portal and the hop out never recrosses the fill). `laneXs` is the
 * SHAPE-WIDE lane lattice (ascending sweep-x): every cell clips the same
 * lattice to its own span, so fill rows continue collinearly across cell
 * boundaries instead of each cell restarting its own grid at its own edge.
 *
 * Each lane's stitching DIRECTION is fixed by its global lattice ordinal
 * (even: lo->hi, odd: hi->lo), not chosen per cell: renderers and real thread
 * both shade a stitch by its direction, so the two halves of a row split
 * across a cut must run the SAME way or the fill texture visibly changes
 * phase along the cut. Parity alternates lane-to-lane, so the serpentine
 * still connects adjacent lane ends whichever way the march runs.
 */
function fillCorners(ringOrig: Pt[], exit: Pt, laneXs: number[], rot: Rot): Pt[] {
  const ring = ringOrig.map(rot.toSweep);
  const x2 = rot.toSweep(exit);
  let xmin = Infinity,
    xmax = -Infinity;
  for (const p of ring) {
    if (p.x < xmin) xmin = p.x;
    if (p.x > xmax) xmax = p.x;
  }

  // A lattice lane exactly on a shared portal is drawn by exactly one of the
  // two cells: rowSpan's half-open edge test yields a span only on the side
  // whose interior starts there. A sliver cell narrower than the lattice
  // pitch gets NO lane — its area lies between two global rows that its
  // neighbours stitch along its borders, so the gap stays within the fill's
  // ordinary row spacing (an extra off-lattice lane would crowd those rows
  // and break the pattern phase). The caller handles empty corners.
  const xs: Array<{ x: number; k: number }> = [];
  for (let k = 0; k < laneXs.length; k++) {
    if (laneXs[k] >= xmin && laneXs[k] <= xmax) xs.push({ x: laneXs[k], k });
  }
  if (xs.length === 0) return [];
  // March toward the exit — the LAST lane must be the one nearest the exit
  // portal. When the entry portal is on the same side as the exit, the entry
  // connector crosses the (still clean) cell to the far side first and the
  // plough works its way back.
  if (Math.abs(xs[0].x - x2.x) < Math.abs(xs[xs.length - 1].x - x2.x)) xs.reverse();

  const corners: Pt[] = [];
  for (const { x, k } of xs) {
    const span = rowSpan(ring, x);
    if (!span) continue;
    const atLo = k % 2 === 0;
    corners.push({ x, y: atLo ? span.lo : span.hi }, { x, y: atLo ? span.hi : span.lo });
  }
  return corners.map(rot.fromSweep);
}

/**
 * Boundary rings of the union of a set of cell rings (as `[x,y][]` rings for
 * the path finder). Cells share edges exactly (bcd's dcel option normalises
 * T-junctions), so the union boundary is: every directed cell edge whose
 * reverse is NOT also present (shared edges cancel), chained into loops.
 * Collinear runs (from T-junction vertices along a shared cut) are simplified
 * away so the finder never sees collinear adjacent ring vertices.
 */
function unionRings(cellRings: Pt[][], diag: number): Array<Array<[number, number]>> {
  const keyOf = (a: Pt, b: Pt) => `${a.x},${a.y}|${b.x},${b.y}`;
  const ptKey = (p: Pt) => `${p.x},${p.y}`;
  const edges = new Map<string, [Pt, Pt]>(); // directed key -> [a, b]
  for (const ring of cellRings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i],
        b = ring[(i + 1) % n];
      if (a.x === b.x && a.y === b.y) continue;
      const rev = keyOf(b, a);
      if (edges.has(rev)) edges.delete(rev);
      else edges.set(keyOf(a, b), [a, b]);
    }
  }

  // Outgoing edges per vertex. Usually one; a pinch (the union touching
  // itself at a critical vertex) gives several, disambiguated by taking the
  // first candidate clockwise from the reversed incoming direction — the
  // standard face-on-the-left traversal rule.
  const outs = new Map<string, Array<[Pt, Pt]>>();
  for (const e of edges.values()) {
    const k = ptKey(e[0]);
    if (!outs.has(k)) outs.set(k, []);
    outs.get(k)!.push(e);
  }
  const used = new Set<string>();
  const loops: Pt[][] = [];
  for (const e0 of edges.values()) {
    if (used.has(keyOf(e0[0], e0[1]))) continue;
    const loop: Pt[] = [];
    let cur = e0;
    for (;;) {
      used.add(keyOf(cur[0], cur[1]));
      loop.push(cur[0]);
      const cands = (outs.get(ptKey(cur[1])) ?? []).filter(
        (e) => !used.has(keyOf(e[0], e[1])),
      );
      if (!cands.length) break; // loop closed (back at e0's start)
      let next = cands[0];
      if (cands.length > 1) {
        const back = Math.atan2(cur[0].y - cur[1].y, cur[0].x - cur[1].x);
        let bestAng = Infinity;
        for (const c of cands) {
          const ang = Math.atan2(c[1].y - c[0].y, c[1].x - c[0].x);
          let d = back - ang; // clockwise angle from the reversed incoming
          while (d <= 0) d += 2 * Math.PI;
          while (d > 2 * Math.PI) d -= 2 * Math.PI;
          if (d < bestAng) {
            bestAng = d;
            next = c;
          }
        }
      }
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }

  // Drop collinear vertices: a vertex on the straight line of its neighbours
  // carries no geometry and would seed degenerate collinear-site bisectors.
  const areaTol = 1e-9 * diag;
  return loops.map((loop) => {
    const out: Array<[number, number]> = [];
    const m = loop.length;
    for (let i = 0; i < m; i++) {
      const p = loop[(i - 1 + m) % m],
        v = loop[i],
        q = loop[(i + 1) % m];
      const cr = (v.x - p.x) * (q.y - p.y) - (v.y - p.y) * (q.x - p.x);
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      if (Math.abs(cr) / len > areaTol) out.push([v.x, v.y]);
    }
    return out.length >= 3 ? out : loop.map((v) => [v.x, v.y] as [number, number]);
  });
}

export class BCDFill implements IRun {
  shell: Vector[];
  holes: Vector[][];
  entry: Pt | undefined;
  exit: Pt | undefined;
  /** Direction of the fill rows, like AutoFill's angle (the sweep is perpendicular). */
  angle: number;
  rowSpacingMm: number;
  fillPattern: AutoFillPatternRow[];
  fillPatternCenterPosition: Pt;
  travelStitchLengthMm: number;
  travelStitchToleranceMm: number;
  gradient: FillGradient | undefined;
  /**
   * When true, drop the last stitch of every fill row: it lands right beside
   * the first stitch of the next row, so skipping it thins the doubled-up
   * penetrations along the row ends without changing the path (the row's
   * final corner still shapes the serpentine; it just isn't penetrated).
   */
  skipLast: boolean;
  /**
   * How the cell tour is scheduled.
   * 'dfs' (default): depth-first walk of a spanning tree rooted at the end
   * cell, children ordered with lookahead, post-order filling.
   * 'peel': beam-searched connectivity-preserving peeling — at every step
   * ANY cell whose removal keeps the unfilled region connected may be filled
   * next, a strict superset of the DFS's orders. Same wet-paint guarantees;
   * can avoid boxed-in fill endings the DFS is forced into on branchy
   * shapes, at a modest planning-time cost.
   */
  tour: 'dfs' | 'peel';
  /**
   * When true (default) travel runs through the interior of the still-
   * unfilled region (straight legs or the medial axis), where the fill
   * stitched over it later hides it. When false ALL travel runs along the
   * border of the shape — the shorter way around — which never needs the
   * medial-axis path finder, so the WASM diagram is never built. Fill lanes
   * start and end on the border by construction, so border travel connects
   * them directly; the travels remain visible on the border unless a border
   * run is stitched over them afterwards. Travel routes over the border
   * NETWORK — border arcs bridged by portal cuts (short interior chords,
   * weighted 2x so the border is preferred; the only way between the outer
   * ring and a hole) — so every leg stays inside the polygon.
   */
  underpath: boolean;

  polygon: Polygon;
  boundary: Geometry;
  decomposition: DecompositionResult;

  private rot: Rot;
  private rings: Pt[][]; // outer + holes, open (no repeated closing vertex)
  private diag: number;
  private sweepXMin: number;
  private sweepXMax: number;

  constructor(
    polygon: { shell: Vector[]; holes?: Vector[][] },
    options?: {
      entry?: Vector;
      exit?: Vector;
      angle?: number;
      rowSpacingMm?: number;
      fillPattern?: AutoFillPatternRow[];
      fillPatternCenterPosition?: Vector;
      travelStitchLengthMm?: number;
      travelStitchToleranceMm?: number;
      gradient?: FillGradient;
      skipLast?: boolean;
      underpath?: boolean;
      tour?: 'dfs' | 'peel';
    },
  ) {
    this.shell = polygon.shell;
    this.holes = polygon.holes ?? [];
    if (options?.entry) this.entry = { x: options.entry.x, y: options.entry.y };
    if (options?.exit) this.exit = { x: options.exit.x, y: options.exit.y };
    this.angle = options?.angle ?? 0;
    this.rowSpacingMm = options?.rowSpacingMm ?? 0.2;
    this.fillPattern = options?.fillPattern ?? [
      { rowOffsetMm: 0, rowPatternMm: [3] },
      { rowOffsetMm: 1, rowPatternMm: [3] },
      { rowOffsetMm: 2, rowPatternMm: [3] },
    ];
    this.travelStitchLengthMm = options?.travelStitchLengthMm ?? 3;
    this.travelStitchToleranceMm = options?.travelStitchToleranceMm ?? 0.1;
    this.gradient = options?.gradient;
    this.skipLast = options?.skipLast ?? true;
    this.tour = options?.tour ?? 'peel';
    this.underpath = options?.underpath ?? true;

    this.polygon = createPolygon(polygon.shell, polygon.holes);
    this.boundary = this.polygon.getBoundary();
    const c =
      options?.fillPatternCenterPosition ?? this.polygon.getCentroid().getCoordinate();
    this.fillPatternCenterPosition = { x: c.x, y: c.y };

    // Drop the closing duplicate vertex: bcd and voron8 both take open rings.
    const open = (ring: Vector[]): Pt[] => {
      const f = ring[0],
        l = ring[ring.length - 1];
      const pts = ring.map((v) => ({ x: v.x, y: v.y }));
      return f.x === l.x && f.y === l.y ? pts.slice(0, -1) : pts;
    };
    this.rings = [open(this.shell), ...this.holes.map(open)];

    let minx = Infinity,
      miny = Infinity,
      maxx = -Infinity,
      maxy = -Infinity;
    for (const ring of this.rings)
      for (const p of ring) {
        minx = Math.min(minx, p.x);
        maxx = Math.max(maxx, p.x);
        miny = Math.min(miny, p.y);
        maxy = Math.max(maxy, p.y);
      }
    this.diag = Math.hypot(maxx - minx, maxy - miny) || 1;

    // `angle` is the fill-row direction (as in AutoFill); the boustrophedon
    // sweep advances perpendicular to the rows.
    const sweepAngle = this.angle + 0.5 * Math.PI;
    this.rot = makeRot(sweepAngle);
    this.sweepXMin = Infinity;
    this.sweepXMax = -Infinity;
    for (const ring of this.rings)
      for (const p of ring) {
        const sx = this.rot.toSweep(p).x;
        this.sweepXMin = Math.min(this.sweepXMin, sx);
        this.sweepXMax = Math.max(this.sweepXMax, sx);
      }

    // The dcel option normalises T-junctions on shared cuts, which the
    // region-union sealing below depends on (shared edges must cancel by
    // exact coordinate match).
    this.decomposition = decompose(
      { outer: this.rings[0], holes: this.rings.slice(1) },
      sweepAngle,
      { dcel: true },
    );
  }

  /** Row spacing (px) at gradient position t in [0, 1] along the sweep axis. */
  private rowSpacingAtT(t: number, pixelsPerMm: number): number {
    const startSpacing = this.rowSpacingMm * pixelsPerMm;
    if (!this.gradient) return startSpacing;
    const endSpacing = this.gradient.endRowSpacingMm * pixelsPerMm;
    if (endSpacing === startSpacing) return startSpacing;
    const { gradient } = this;

    if (gradient.mode === 'ramp') {
      const start = Math.max(0, Math.min(1, gradient.start));
      const end = Math.max(0, Math.min(1, gradient.end));
      if (start === end) return startSpacing;
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      const s0 = start < end ? startSpacing : endSpacing;
      const s1 = start < end ? endSpacing : startSpacing;
      if (t <= lo) return s0;
      if (t >= hi) return s1;
      return s0 + ((t - lo) / (hi - lo)) * (s1 - s0);
    }

    const center = Math.max(0, Math.min(1, gradient.center));
    const halfWidth = 0.5 * Math.max(0, Math.min(1, gradient.plateauWidth));
    const plateauStart = Math.max(0, center - halfWidth);
    const plateauEnd = Math.min(1, center + halfWidth);
    if (t >= plateauStart && t <= plateauEnd) return startSpacing;
    if (t < plateauStart) {
      return plateauStart === 0
        ? startSpacing
        : endSpacing + (t / plateauStart) * (startSpacing - endSpacing);
    }
    return plateauEnd === 1
      ? startSpacing
      : startSpacing +
          ((t - plateauEnd) / (1 - plateauEnd)) * (endSpacing - startSpacing);
  }

  /** Lane spacing (px) at a sweep-x position (constant without a gradient). */
  private spacingAtSweep(sweepX: number, pixelsPerMm: number): number {
    if (!this.gradient) return Math.max(this.rowSpacingMm * pixelsPerMm, 0.001);
    const sweepSpan = this.sweepXMax - this.sweepXMin;
    const t =
      sweepSpan > 0 ? Math.max(0, Math.min(1, (sweepX - this.sweepXMin) / sweepSpan)) : 0;
    return Math.max(this.rowSpacingAtT(t, pixelsPerMm), 0.001);
  }

  /**
   * Lane positions (sweep-x) for the WHOLE shape — one lattice shared by all
   * cells, so fill rows run collinearly across cell boundaries and the
   * pattern-row cycle keeps phase (a lane's row is its ordinal here). With
   * uniform spacing the lattice is anchored at the pattern center, like
   * AutoFill's grating; a gradient instead marches one sequence from the
   * shape's sweep-min. Ascending.
   */
  private globalLaneXs(pixelsPerMm: number): number[] {
    const xs: number[] = [];
    if (!this.gradient) {
      const nominal = Math.max(this.rowSpacingMm * pixelsPerMm, 0.001);
      const anchor = this.rot.toSweep(this.fillPatternCenterPosition).x;
      for (
        let k = Math.ceil((this.sweepXMin - anchor) / nominal);
        anchor + k * nominal <= this.sweepXMax;
        k++
      ) {
        xs.push(anchor + k * nominal);
      }
    } else {
      let x = this.sweepXMin + this.spacingAtSweep(this.sweepXMin, pixelsPerMm) / 2;
      while (x <= this.sweepXMax) {
        xs.push(x);
        x += this.spacingAtSweep(x, pixelsPerMm);
      }
    }
    return xs;
  }

  private snapToBoundary(p: Pt): Pt {
    const pt = geometryFactory.createPoint(new Coordinate(p.x, p.y));
    const nearest = DistanceOp.nearestPoints(this.boundary, pt)[0];
    return { x: nearest.x, y: nearest.y };
  }

  // Last plan, keyed by scale, so getPlan() + getStitches() (which replays
  // the plan) only plan once. The run's inputs are fixed at construction;
  // reassigning public fields afterwards will not invalidate this.
  private planCache: { pixelsPerMm: number; plan: BCDFillPlan } | null = null;

  /**
   * Plan the coverage tour at a given scale. Exposed for inspection and
   * rendering (cells, travel/fill polylines, fill order); getStitches() turns
   * the plan into stitches.
   */
  getPlan(pixelsPerMm: number): BCDFillPlan {
    if (this.planCache && this.planCache.pixelsPerMm === pixelsPerMm) {
      return this.planCache.plan;
    }
    // 'peel' searches a wider order space than the DFS but with cheap
    // straight-line proxies, so it wins on some shapes (notably far-apart
    // endpoints) and loses on others. Both schedulers are fast; plan with
    // both and keep the better plan, so 'peel' can never regress.
    let plan = this.planTour(pixelsPerMm, 'dfs');
    if (this.tour === 'peel') {
      const alt = this.planTour(pixelsPerMm, 'peel');
      if (this.planScore(alt, pixelsPerMm) < this.planScore(plan, pixelsPerMm)) {
        plan = alt;
      }
    }
    this.planCache = { pixelsPerMm, plan };
    return plan;
  }

  /**
   * Plan quality for scheduler selection: travel length plus a flat charge
   * for every fill that ends beside already-sealed work (the same "boxed
   * ending" the exit selection avoids; the final cell is inherently
   * surrounded and exempt).
   */
  private planScore(plan: BCDFillPlan, pixelsPerMm: number): number {
    const nominal = Math.max(this.rowSpacingMm * pixelsPerMm, 0.001);
    const walls: Array<[Pt, Pt]> = [];
    let boxed = 0,
      fillIdx = 0;
    for (const s of plan.steps) {
      if (s.type === 'seal') {
        walls.push(...s.walls);
        continue;
      }
      if (s.type !== 'fill' || !s.path.length) continue;
      fillIdx++;
      if (fillIdx >= plan.fillSequence.length) break;
      const e = s.path[s.path.length - 1];
      if (walls.some(([a, b]) => segDist(e, a, b) <= 2 * nominal)) boxed++;
    }
    return plan.travelLength + boxed * 10 * nominal;
  }

  private planTour(pixelsPerMm: number, tour: 'dfs' | 'peel'): BCDFillPlan {
    const rot = this.rot;
    const diag = this.diag;
    const grazeTol = 1e-9 * diag;
    const nominal = this.rowSpacingMm * pixelsPerMm;
    const laneXs = this.globalLaneXs(pixelsPerMm);

    // Per-plan mutable copies (the exit-cell split below rewires them):
    // decomposition itself is reused across calls.
    const dec = this.decomposition;
    const dcel = dec.dcel!;
    const faces: Pt[][] = dec.faces.map((f) => f.map((v) => dec.vertices[v]));
    const centers = faces.map(centroid);
    const adjacency = dec.graph.adjacency.map((a) => a.slice());

    // Portal segments per adjacent face pair, from the DCEL: every half-edge
    // whose twin lies in a different bounded face is a piece of shared cut
    // (T-junction vertices are already inserted, so pieces align exactly).
    const pairKey = (i: number, j: number) => (i < j ? `${i},${j}` : `${j},${i}`);
    const portals = new Map<string, { segs: Array<[Pt, Pt]>; mid: Pt }>();
    const seenHE = new Set<number>();
    dcel.halfEdges.forEach((h, hi) => {
      const t = dcel.halfEdges[h.twin];
      if (h.face < 0 || t.face < 0 || h.face === t.face) return;
      const lo = Math.min(hi, h.twin);
      if (seenHE.has(lo)) return;
      seenHE.add(lo);
      const key = pairKey(h.face, t.face);
      let entry = portals.get(key);
      if (!entry) portals.set(key, (entry = { segs: [], mid: { x: 0, y: 0 } }));
      entry.segs.push([dec.vertices[h.origin], dec.vertices[t.origin]]);
    });
    // Portal crossing point: midpoint of the longest shared piece.
    for (const entry of portals.values()) {
      let best = entry.segs[0],
        bl = -1;
      for (const s of entry.segs) {
        const l = dist(s[0], s[1]);
        if (l > bl) {
          bl = l;
          best = s;
        }
      }
      entry.mid = midPt(best[0], best[1]);
    }
    const portalMid = (i: number, j: number): Pt => {
      const entry = portals.get(pairKey(i, j));
      return entry ? entry.mid : midPt(centers[i], centers[j]); // degenerate adjacency
    };
    // Closest point to `p` on any piece of the portal between faces i and j.
    // Used as the exit anchor after a fill: the lane march ends beside the
    // portal (cuts are parallel to the lanes), so projecting the last lane end
    // onto it gives a short perpendicular hop instead of a jump along the cut
    // to its midpoint.
    const portalClosest = (i: number, j: number, p: Pt): Pt => {
      const entry = portals.get(pairKey(i, j));
      if (!entry) return midPt(centers[i], centers[j]);
      let best = entry.mid,
        bd = Infinity;
      for (const [a, b] of entry.segs) {
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const q = { x: a.x + t * dx, y: a.y + t * dy };
        const d = dist(p, q);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
      return best;
    };

    // The free region: initially the whole polygon; after each seal, the
    // union of the still-unfilled cells. The medial-axis finder over it is
    // built LAZILY — the straight-line and boundary shortcuts in route()
    // satisfy most travel legs, and a finder that is never asked for a path
    // skips its whole CGAL construction, the dominant planning cost.
    let finderRings: Array<Array<[number, number]>> = this.rings.map((r) =>
      r.map((p) => [p.x, p.y] as [number, number]),
    );
    let regionRings: Pt[][] = this.rings.map((r) => r.map((p) => ({ ...p })));
    let finder: MedialAxisPathFinder | null = null;
    const getFinder = (): MedialAxisPathFinder =>
      (finder ??= new MedialAxisPathFinder(finderRings));

    const locate = (pt: Pt): number => {
      for (let i = 0; i < faces.length; i++) if (pointInRing(pt, faces[i])) return i;
      // On a cell boundary (e.g. a snapped point) the even-odd test is
      // unstable; fall back to the cell whose ring passes closest.
      let best = 0,
        bd = Infinity;
      for (let i = 0; i < faces.length; i++) {
        const d = nearestEdge(faces[i], pt).d;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best;
    };

    // The tour's endpoints live on the border (they are entry/exit points of
    // the region, not interior positions).
    const start = this.snapToBoundary(this.entry ?? centers[0]);
    const end = this.snapToBoundary(this.exit ?? start);
    let endCell = locate(end);

    // If the exit falls in the sweep-interior of its cell, split that cell
    // into two pseudo-cells along the lane through the exit. Otherwise the
    // root's lane march can only finish at one x-extreme of the cell and the
    // final travel drags across half of it; with the split, both halves'
    // marches converge on the shared cut where the exit sits, so the last hop
    // is at most about a lane. Valid because a BCD cell is x-monotone in the
    // sweep frame with portals only at its x-extremes: a vertical clip yields
    // two monotone pseudo-cells, old neighbours reassign cleanly by side, and
    // the cut becomes an ordinary portal between them.
    {
      const ringO = faces[endCell];
      const ringS = ringO.map(rot.toSweep);
      const n = ringS.length;
      const xe = rot.toSweep(end).x;
      let xmin = Infinity,
        xmax = -Infinity;
      for (const p of ringS) {
        xmin = Math.min(xmin, p.x);
        xmax = Math.max(xmax, p.x);
      }
      if (xe - xmin > nominal && xmax - xe > nominal) {
        // Clip in the sweep frame but EMIT original-frame vertices: untouched
        // vertices keep their exact original coordinates (unionRings cancels
        // shared edges by exact coordinate match — a rotate/unrotate round
        // trip would perturb every vertex by ~1e-13, un-pairing the
        // pseudo-cells' edges from their neighbours' and littering the union
        // with degenerate slit edges). Each true crossing is constructed
        // ONCE, in the original frame, and shared by both halves; a vertex on
        // the line goes to both.
        const eps = 1e-9 * diag;
        const sideOf = (p: Pt) => (Math.abs(p.x - xe) <= eps ? 0 : p.x < xe ? -1 : 1);
        const cutCache = new Map<number, Pt>();
        const edgeCut = (i: number): Pt => {
          let q = cutCache.get(i);
          if (!q) {
            const aS = ringS[i],
              bS = ringS[(i + 1) % n];
            const t = (xe - aS.x) / (bS.x - aS.x);
            const aO = ringO[i],
              bO = ringO[(i + 1) % n];
            q = { x: aO.x + t * (bO.x - aO.x), y: aO.y + t * (bO.y - aO.y) };
            cutCache.set(i, q);
          }
          return q;
        };
        const clipHalf = (keep: number): Pt[] => {
          const out: Pt[] = [];
          for (let i = 0; i < n; i++) {
            const sa = sideOf(ringS[i]),
              sb = sideOf(ringS[(i + 1) % n]);
            if (sa === 0 || sa === keep) out.push(ringO[i]);
            if (sa !== 0 && sb !== 0 && sa !== sb) out.push(edgeCut(i));
          }
          return out;
        };
        const leftO = clipHalf(-1),
          rightO = clipHalf(1);
        // The split segment: the extreme on-line points (cuts + on-line verts).
        const linePts = [
          ...cutCache.values(),
          ...ringO.filter((_, i) => sideOf(ringS[i]) === 0),
        ];
        linePts.sort((u, v) => rot.toSweep(u).y - rot.toSweep(v).y);
        if (leftO.length >= 3 && rightO.length >= 3 && linePts.length >= 2) {
          const splitSeg: [Pt, Pt] = [linePts[0], linePts[linePts.length - 1]];
          const newIdx = faces.length;
          faces[endCell] = leftO;
          faces.push(rightO);
          centers[endCell] = centroid(leftO);
          centers.push(centroid(rightO));
          // Reassign the old cell's neighbours by which extreme their portal
          // sits on (portals live at the cell's x-extremes, never at xe).
          const leftAdj: number[] = [],
            rightAdj: number[] = [];
          for (const nb of adjacency[endCell]) {
            const entry = portals.get(pairKey(endCell, nb));
            const px = rot.toSweep(entry ? entry.mid : centers[nb]).x;
            if (px <= xe) {
              leftAdj.push(nb);
            } else {
              rightAdj.push(nb);
              if (entry) {
                portals.delete(pairKey(endCell, nb));
                portals.set(pairKey(newIdx, nb), entry);
              }
              adjacency[nb] = adjacency[nb].map((x) => (x === endCell ? newIdx : x));
            }
          }
          leftAdj.push(newIdx);
          rightAdj.push(endCell);
          adjacency[endCell] = leftAdj;
          adjacency.push(rightAdj);
          portals.set(pairKey(endCell, newIdx), {
            segs: [splitSeg],
            mid: midPt(splitSeg[0], splitSeg[1]),
          });
          endCell = newIdx; // root at one pseudo-cell; the exit is on their shared cut
        }
      }
    }

    const startCell = locate(start);

    const steps: BCDFillPlanStep[] = [];
    let pos = start;
    let travelLength = 0,
      fillLength = 0,
      unroutable = 0;

    const pushTravel = (path: Pt[], found: boolean) => {
      steps.push({ type: 'travel', path, found });
      travelLength += polylineLength(path);
      const last = path[path.length - 1];
      pos = { x: last.x, y: last.y };
    };

    // Walk along the current region boundary from a to b — the shorter of the
    // two arcs — when both lie on the SAME boundary ring. Returns null when
    // either point is interior (e.g. on an open portal) or they sit on
    // different rings (outer vs hole), where the border cannot connect them.
    const boundaryWalk = (a: Pt, b: Pt): Pt[] | null => {
      const onTol = 1e-6 * diag;
      let ra = -1,
        rb = -1,
        ea = 0,
        eb = 0;
      for (let r = 0; r < regionRings.length; r++) {
        if (ra < 0) {
          const hit = nearestEdge(regionRings[r], a);
          if (hit.d <= onTol) {
            ra = r;
            ea = hit.edge;
          }
        }
        if (rb < 0) {
          const hit = nearestEdge(regionRings[r], b);
          if (hit.d <= onTol) {
            rb = r;
            eb = hit.edge;
          }
        }
      }
      if (ra < 0 || ra !== rb) return null;
      const arcs = ringArcs(regionRings[ra], ea, eb, a, b);
      return polylineLength(arcs[0]) <= polylineLength(arcs[1]) ? arcs[0] : arcs[1];
    };

    // A straight travel leg is safe iff it properly crosses no edge of the
    // current region boundary and none of the `avoid` segments (the fresh
    // lanes of a just-filled, not-yet-sealed cell), AND its interior actually
    // runs through the region. The second condition is not implied by the
    // first: travel endpoints sit ON the boundary (portal exits, lane ends),
    // so a segment can slip out of the region exactly AT an endpoint — no
    // proper crossing anywhere — and run its whole length through a sealed
    // cell or an exterior notch before grazing back in at the other end.
    // Interior sample points (even-odd over the region rings) reject that; a
    // leg that merely rides along a boundary edge fails the samples too and
    // falls through to the boundary walk, which handles it correctly.
    const inRegion = (q: Pt): boolean => {
      let inside = false;
      for (const ring of regionRings) if (pointInRing(q, ring)) inside = !inside;
      return inside;
    };
    const straightClear = (a: Pt, b: Pt, avoid?: Array<[Pt, Pt]>): boolean => {
      for (const ring of regionRings) {
        const n = ring.length;
        for (let i = 0; i < n; i++)
          if (properCross(a, b, ring[i], ring[(i + 1) % n], grazeTol)) return false;
      }
      if (avoid)
        for (const [u, v] of avoid) if (properCross(a, b, u, v, grazeTol)) return false;
      for (const t of [0.25, 0.5, 0.75]) {
        if (!inRegion({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }))
          return false;
      }
      return true;
    };

    // The original polygon border, for `underpath: false` travel. Fill lanes
    // start and end ON these rings by construction (lane ends are crossings
    // of the boundary edges; portal edges are parallel to lanes and never
    // supply a lane end), so border legs connect fills directly.
    const borderRings: Pt[][] = this.rings.map((r) => r.map((p) => ({ ...p })));
    const borderTol = 1e-6 * diag;
    const borderPath = (a: Pt, b: Pt): Pt[] | null => {
      let ra = -1,
        rb = -1,
        ea = 0,
        eb = 0;
      for (let r = 0; r < borderRings.length; r++) {
        if (ra < 0) {
          const hit = nearestEdge(borderRings[r], a);
          if (hit.d <= borderTol) {
            ra = r;
            ea = hit.edge;
          }
        }
        if (rb < 0) {
          const hit = nearestEdge(borderRings[r], b);
          if (hit.d <= borderTol) {
            rb = r;
            eb = hit.edge;
          }
        }
      }
      if (ra < 0 || ra !== rb) return null; // off-border or different rings
      const arcs = ringArcs(borderRings[ra], ea, eb, a, b);
      return polylineLength(arcs[0]) <= polylineLength(arcs[1]) ? arcs[0] : arcs[1];
    };
    // Travel-distance proxy in border mode: the shorter border arc, or the
    // straight distance when the border cannot join the points.
    const borderDist = (a: Pt, b: Pt): number => {
      const bp = borderPath(a, b);
      return bp ? polylineLength(bp) : dist(a, b);
    };
    // Exact border-mode router over the border NETWORK (assigned later, once
    // the portal list exists): border rings bridged by portal cuts.
    let borderGraphRoute: ((a: Pt, b: Pt) => Pt[] | null) | null = null;
    // Cumulative perimeter position of each border-ring vertex, for ordering
    // points around a ring.
    const ringPerim: number[][] = borderRings.map((ring) => {
      const acc: number[] = [0];
      for (let i = 1; i < ring.length; i++)
        acc.push(acc[i - 1] + dist(ring[i - 1], ring[i]));
      return acc;
    });
    const ringTotal: number[] = borderRings.map(
      (ring, r) => ringPerim[r][ring.length - 1] + dist(ring[ring.length - 1], ring[0]),
    );

    const route = (target: Pt, avoid?: Array<[Pt, Pt]>) => {
      if (dist(pos, target) < 1e-12) return;
      if (!this.underpath) {
        // Border-only travel: shortest path over the border NETWORK — arcs
        // along the border rings, bridged where necessary by portal cuts
        // (short interior chords whose endpoints lie on the border; the only
        // way between different rings). Riding the border or a frontier cut
        // grazes lane ENDS (endpoint touching, never a proper crossing), so
        // it is safe past filled cells, and every leg stays inside the
        // polygon by construction.
        const bg = borderGraphRoute ? borderGraphRoute(pos, target) : null;
        if (bg) {
          pushTravel(bg, true);
          return;
        }
        if (straightClear(pos, target, avoid)) {
          pushTravel([{ ...pos }, { ...target }], true);
          return;
        }
        const bw2 = boundaryWalk(pos, target);
        if (bw2) {
          pushTravel(bw2, true);
          return;
        }
        unroutable++;
        pushTravel([{ ...pos }, { ...target }], false);
        return;
      }
      // Most legs are a hop into an adjacent cell with nothing in the way:
      // go straight, and skip both the medial-axis query and (often) ever
      // building the finder for this region at all.
      if (straightClear(pos, target, avoid)) {
        pushTravel([{ ...pos }, { ...target }], true);
        return;
      }
      // Prefer the border for SHORT local slides — two nearby points on the
      // boundary (a fill's exit beside the next fill's entry) should slip
      // along the edge, not detour through the interior axis and back. Long
      // transfers stay on the medial axis instead: a long wall-hugging run
      // reads (and clears) worse than the axis route. "Short" is measured in
      // lane spacings — at most ~2 spacings, so taking the border without
      // consulting the axis costs nothing measurable and avoids building a
      // finder. The border also rescues a leg the axis fails to route.
      const bw = boundaryWalk(pos, target);
      const bwLen = bw ? polylineLength(bw) : Infinity;
      if (bw && bwLen <= 2 * nominal) {
        pushTravel(bw, true);
        return;
      }
      const r = getFinder().findPath(pos, target);
      if (bw && !r.found) {
        pushTravel(bw, true);
        return;
      }
      if (!r.found) unroutable++;
      pushTravel(r.found ? r.path : [{ ...pos }, { ...target }], r.found);
    };

    // Hop from the end of a fresh fill to the exit portal without recrossing
    // the fill lines: straight when the segment stays inside the cell (a cell
    // is simply connected, so "crosses no ring edge" ⇒ inside) and clear of
    // the lanes; otherwise along the cell boundary, choosing the arc that
    // passes the fewest lane ends (the exit-side arc, since lanes march
    // toward the exit). Returns null when the fill was empty or nothing safe
    // was found.
    const exitHop = (cell: number, corners: Pt[], exit: Pt): Pt[] | null => {
      if (!corners.length) return null;
      const last = corners[corners.length - 1];
      if (dist(last, exit) < 1e-12) return [last, exit];
      const ring = faces[cell];
      const n = ring.length;
      const fillSegs: Array<[Pt, Pt]> = [];
      for (let i = 0; i + 1 < corners.length; i++)
        fillSegs.push([corners[i], corners[i + 1]]);

      const crossesRing = (a: Pt, b: Pt) => {
        for (let i = 0; i < n; i++)
          if (properCross(a, b, ring[i], ring[(i + 1) % n], grazeTol)) return true;
        return false;
      };
      const crossesFill = (a: Pt, b: Pt) => {
        for (const [u, v] of fillSegs) if (properCross(a, b, u, v, grazeTol)) return true;
        return false;
      };

      if (!crossesRing(last, exit) && !crossesFill(last, exit)) return [last, exit];

      // Boundary walk: locate both points on the ring, build the two arcs.
      const ei = nearestEdge(ring, last).edge,
        ej = nearestEdge(ring, exit).edge;
      const arcs = ringArcs(ring, ei, ej, last, exit);
      // Prefer the arc passing the fewest lane ends (grazing the boundary
      // over a lane END is unavoidable at the last lane, but the entry-side
      // arc would ride over every cross-connector).
      const nearTol = Math.max(1e-6 * diag, grazeTol * 10);
      const laneEndsOn = (arc: Pt[]) => {
        let count = 0;
        for (const c of corners) {
          for (let i = 0; i + 1 < arc.length; i++) {
            const a = arc[i],
              b = arc[i + 1];
            const dx = b.x - a.x,
              dy = b.y - a.y;
            const l2 = dx * dx + dy * dy;
            let t = l2 > 0 ? ((c.x - a.x) * dx + (c.y - a.y) * dy) / l2 : 0;
            t = Math.max(0, Math.min(1, t));
            if (Math.hypot(c.x - (a.x + t * dx), c.y - (a.y + t * dy)) <= nearTol) {
              count++;
              break;
            }
          }
        }
        return count;
      };
      arcs.sort(
        (u, v) => laneEndsOn(u) - laneEndsOn(v) || polylineLength(u) - polylineLength(v),
      );
      const arc = arcs[0];
      for (let i = 0; i + 1 < arc.length; i++)
        if (crossesFill(arc[i], arc[i + 1])) return null; // give up -> findPath
      return arc;
    };

    // Seal a filled cell: remove it from the free region by rebuilding the
    // finder over the union of the remaining unfilled cells. The `walls` on
    // the seal step are the newly sealed portal segments, reported for
    // visualization and invariant checks only — they are not finder walls,
    // the cell is simply no longer part of the region.
    const filled = new Set<number>();
    const sealedPortal = new Set<string>();
    const seal = (c: number) => {
      filled.add(c);
      const walls: Array<[Pt, Pt]> = [];
      for (const nb of adjacency[c]) {
        const key = pairKey(c, nb);
        if (sealedPortal.has(key)) continue; // already sealed from the other side
        sealedPortal.add(key);
        const entry = portals.get(key);
        if (!entry) continue;
        for (const [a, b] of entry.segs) walls.push([a, b]);
      }
      steps.push({ type: 'seal', cell: c, walls });
      if (filled.size < faces.length) {
        const remaining = faces.filter((_, i) => !filled.has(i));
        finderRings = unionRings(remaining, diag);
        regionRings = finderRings.map((r) => r.map(([x, y]) => ({ x, y })));
        if (finder) {
          finder.dispose();
          finder = null; // rebuilt lazily, only if a leg actually needs it
        }
      }
    };

    // A cell's fill path is fully determined by its exit point (lanes come
    // from the shared lattice, direction from global parity), so fill
    // endpoints can be computed BEFORE the walk commits to an order. Cached:
    // the lookahead below asks for the same corners the eventual fill() uses.
    const cornersCache = new Map<string, Pt[]>();
    const cornersFor = (c: number, exitPt: Pt): Pt[] => {
      const key = `${c}|${exitPt.x},${exitPt.y}`;
      let cs = cornersCache.get(key);
      if (!cs) {
        cs = fillCorners(faces[c], exitPt, laneXs, rot);
        cornersCache.set(key, cs);
      }
      return cs;
    };

    // Swap the two ends of every lane: the same serpentine walked from the
    // other side. Reverses every lane's stitch direction in the cell,
    // trading a little texture coherence at its cuts (largely hidden by a
    // staggered fillPattern) for a better-placed fill end.
    const flipPhase = (corners: Pt[]): Pt[] => corners.map((_, i, a) => a[i ^ 1]);

    const fillSequence: number[] = [];
    const fill = (c: number, exitPt: Pt, flip = false): Pt[] => {
      let corners = cornersFor(c, exitPt);
      if (flip && corners.length >= 2) corners = flipPhase(corners);
      fillSequence.push(c);
      if (!corners.length) return corners;
      route(corners[0]); // onto the first lane end, along the medial axis
      steps.push({ type: 'fill', cell: c, path: corners });
      fillLength += polylineLength(corners);
      pos = corners[corners.length - 1];
      return corners;
    };

    // When the lane-safe exitHop fails and we fall back to route(), the
    // just-drawn lanes are still inside the open region — pass them as avoid
    // segments so the straight shortcut cannot recross them.
    const segsOf = (corners: Pt[]): Array<[Pt, Pt]> => {
      const segs: Array<[Pt, Pt]> = [];
      for (let i = 0; i + 1 < corners.length; i++)
        segs.push([corners[i], corners[i + 1]]);
      return segs;
    };
    // Ending beside already-filled territory strands the walk against a
    // sealed wall and rides the fresh fill on the way out. Checked against
    // EVERY sealed wall, not just the cell's own: at a critical vertex the
    // wall between two OTHER cells can sit exactly at the end corner.
    // Parameterised by a filled-set so the peel search can score
    // hypothetical states; the walk's real state is `filled`.
    const portalList: Array<{ i: number; j: number; segs: Array<[Pt, Pt]> }> = [];
    for (const [key, entry] of portals) {
      const comma = key.indexOf(',');
      portalList.push({
        i: Number(key.slice(0, comma)),
        j: Number(key.slice(comma + 1)),
        segs: entry.segs,
      });
    }
    const nearSealedFor = (p: Pt, filledSet: Set<number>): boolean => {
      const tol = 2 * nominal;
      for (const pe of portalList) {
        if (!filledSet.has(pe.i) && !filledSet.has(pe.j)) continue;
        for (const [a, b] of pe.segs) if (segDist(p, a, b) <= tol) return true;
      }
      return false;
    };

    // Border travel network for `underpath: false`. Nodes are query points
    // and portal-segment endpoints; edges are arcs along each border ring
    // between perimeter-consecutive nodes, plus the portal segments — the
    // only interior bridges, and the ONLY way between different border rings
    // (outer vs a hole). Portal edges are weighted 2x so routes prefer the
    // border, and a portal between two SEALED cells is closed (riding it
    // would stitch across finished fill; a frontier portal merely grazes).
    // Every emitted leg is a border arc or an interior chord of the polygon,
    // so border-mode travel can never leave the shape.
    if (!this.underpath) {
      type BNode = { p: Pt; ring: number; e: number; s: number };
      const bNodes: BNode[] = [];
      const bKey = new Map<string, number>();
      const nodeId = (p: Pt): number => {
        const k = `${p.x},${p.y}`;
        let id = bKey.get(k);
        if (id !== undefined) return id;
        let ring = -1,
          e = 0,
          s = 0;
        for (let r = 0; r < borderRings.length; r++) {
          const hit = nearestEdge(borderRings[r], p);
          if (hit.d <= borderTol) {
            ring = r;
            e = hit.edge;
            s = ringPerim[r][hit.edge] + dist(borderRings[r][hit.edge], p);
            break;
          }
        }
        id = bNodes.length;
        bNodes.push({ p, ring, e, s });
        bKey.set(k, id);
        return id;
      };
      // portal edges: [nodeA, nodeB, length, cellI, cellJ]
      const bPortalEdges: Array<[number, number, number, number, number]> = [];
      for (const pe of portalList)
        for (const [a, b] of pe.segs)
          bPortalEdges.push([nodeId(a), nodeId(b), dist(a, b), pe.i, pe.j]);
      // Walk the ring from one on-ring node to another in a fixed direction.
      const ringWalk = (from: BNode, to: BNode, forward: boolean): Pt[] => {
        const ring = borderRings[from.ring];
        const n = ring.length;
        if (from.e === to.e) {
          const shortFwd = to.s >= from.s;
          if (forward === shortFwd) return [from.p, to.p];
          const out: Pt[] = [from.p]; // full circuit the other way round
          if (forward) for (let k = 1; k <= n; k++) out.push(ring[(from.e + k) % n]);
          else for (let k = 0; k < n; k++) out.push(ring[(from.e - k + n) % n]);
          out.push(to.p);
          return out;
        }
        const out: Pt[] = [from.p];
        if (forward) {
          for (let k = (from.e + 1) % n; ; k = (k + 1) % n) {
            if ((k - 1 + n) % n === to.e) break;
            out.push(ring[k]);
            if (out.length > n + 2) break;
          }
        } else {
          for (let k = from.e; ; k = (k - 1 + n) % n) {
            out.push(ring[k]);
            if (k === (to.e + 1) % n) break;
            if (out.length > n + 2) break;
          }
        }
        out.push(to.p);
        return out;
      };
      borderGraphRoute = (a: Pt, b: Pt): Pt[] | null => {
        const na = nodeId(a),
          nb = nodeId(b);
        if (bNodes[na].ring < 0 || bNodes[nb].ring < 0) return null;
        const N = bNodes.length;
        // ring sequences by perimeter position (query nodes persist, so
        // rebuild per call — the graph is tiny)
        const seqs: number[][] = borderRings.map(() => []);
        for (let id = 0; id < N; id++)
          if (bNodes[id].ring >= 0) seqs[bNodes[id].ring].push(id);
        for (const seq of seqs) seq.sort((x, y) => bNodes[x].s - bNodes[y].s);
        const posInSeq = new Map<number, number>();
        for (const seq of seqs) seq.forEach((id, i) => posInSeq.set(id, i));
        // Dense Dijkstra
        const cost = new Array(N).fill(Infinity);
        const prev: Array<{ id: number; kind: 'fwd' | 'bwd' | 'portal' } | null> =
          new Array(N).fill(null);
        const done = new Array(N).fill(false);
        cost[na] = 0;
        for (;;) {
          let u = -1,
            du = Infinity;
          for (let i = 0; i < N; i++)
            if (!done[i] && cost[i] < du) {
              du = cost[i];
              u = i;
            }
          if (u < 0 || u === nb) break;
          done[u] = true;
          const bn = bNodes[u];
          if (bn.ring >= 0) {
            const seq = seqs[bn.ring];
            if (seq.length > 1) {
              const i = posInSeq.get(u)!;
              const total = ringTotal[bn.ring];
              const nxt = seq[(i + 1) % seq.length];
              const prv = seq[(i - 1 + seq.length) % seq.length];
              const dFwd = (bNodes[nxt].s - bn.s + total) % total;
              const dBwd = (bn.s - bNodes[prv].s + total) % total;
              if (cost[u] + dFwd < cost[nxt]) {
                cost[nxt] = cost[u] + dFwd;
                prev[nxt] = { id: u, kind: 'fwd' };
              }
              if (cost[u] + dBwd < cost[prv]) {
                cost[prv] = cost[u] + dBwd;
                prev[prv] = { id: u, kind: 'bwd' };
              }
            }
          }
          for (const [x, y, len, ci, cj] of bPortalEdges) {
            if (filled.has(ci) && filled.has(cj)) continue;
            const v = x === u ? y : y === u ? x : -1;
            if (v < 0 || done[v]) continue;
            const w = cost[u] + 2 * len; // interior cut: prefer the border
            if (w < cost[v]) {
              cost[v] = w;
              prev[v] = { id: u, kind: 'portal' };
            }
          }
        }
        if (cost[nb] === Infinity) return null;
        const hops: Pt[][] = [];
        let cur = nb;
        while (cur !== na) {
          const pr = prev[cur]!;
          const from = bNodes[pr.id],
            to = bNodes[cur];
          hops.push(
            pr.kind === 'portal' ? [from.p, to.p] : ringWalk(from, to, pr.kind === 'fwd'),
          );
          cur = pr.id;
        }
        hops.reverse();
        const out: Pt[] = [a];
        for (const h of hops) for (let i = 1; i < h.length; i++) out.push(h[i]);
        return out;
      };
    }
    // Evaluate every legal way to fill-and-leave `c`: one candidate per
    // unfilled neighbour (the exit portal need not be the tree parent — any
    // unfilled neighbour leads into open region, and each candidate exit
    // moves the march's LAST lane to that exit's extreme, so a cell boxed in
    // at one extreme can leave through the other), times both serpentine
    // phases. Ranked by the explicit criterion first
    // (ending NOT beside filled territory), then by weighted cost: entry
    // from `from`, the exit hop at 3x (it is stitched ON the finished fill
    // and stays visible, while entry/onward legs cross bare ground that
    // later fills bury — AutoFill's outline weight), plus the leg to the
    // nearest of `targets`. Exit choice never changes lane stitch direction,
    // so it is texture-safe in 'global' mode as well.
    type ExitChoice = {
      nb: number;
      flip: boolean;
      bad: number;
      cost: number;
      exitAt: Pt;
      entry: Pt | null;
    };
    const evalExits = (
      c: number,
      filledSet: Set<number>,
      from: Pt,
      targets: Pt[],
    ): ExitChoice | null => {
      let best: ExitChoice | null = null;
      for (const nb of adjacency[c]) {
        // In border mode there is no exit hop, so a FILLED neighbour is a
        // legal march orientation too — the exit only orients the lanes.
        if (this.underpath && filledSet.has(nb)) continue;
        const exitPt = portalMid(c, nb);
        const base = cornersFor(c, exitPt);
        const phases: Array<[Pt[], boolean]> =
          base.length >= 2
            ? [
                [base, false],
                [flipPhase(base), true],
              ]
            : [[base, false]];
        for (const [cs, flip] of phases) {
          let bad = 0,
            cost: number,
            exitAt = exitPt;
          if (cs.length) {
            const last = cs[cs.length - 1];
            if (this.underpath) {
              exitAt = portalClosest(c, nb, last);
              bad = nearSealedFor(last, filledSet) ? 1 : 0;
              cost = dist(from, cs[0]) + 3 * dist(last, exitAt);
            } else {
              // Border mode: no exit hop — the walk stays at the fill end
              // and travels along the border, so legs are priced by border
              // distance and an ending beside sealed work costs nothing
              // (the border passes it safely).
              exitAt = last;
              cost = borderDist(from, cs[0]);
            }
          } else {
            cost = dist(from, exitPt); // laneless cell: just walk through
          }
          let toNext = Infinity;
          for (const t of targets)
            toNext = Math.min(
              toNext,
              this.underpath ? dist(exitAt, t) : borderDist(exitAt, t),
            );
          if (toNext < Infinity) cost += toNext;
          if (!best || bad < best.bad || (bad === best.bad && cost < best.cost)) {
            best = { nb, flip, bad, cost, exitAt, entry: cs.length ? cs[0] : null };
          }
        }
      }
      return best;
    };
    // Fill `c`, hop out lane-safely through the chosen exit portal, seal —
    // the shared execution step for both tour schedulers.
    const fillAndSeal = (c: number, exitNb: number, flip: boolean) => {
      const corners = fill(c, portalMid(c, exitNb), flip);
      if (this.underpath) {
        const from = corners.length ? corners[corners.length - 1] : pos;
        const exit = portalClosest(c, exitNb, from);
        const hop = exitHop(c, corners, exit);
        if (hop) pushTravel(hop, true);
        else route(exit, segsOf(corners));
      }
      // Border mode: no exit hop — the fill ends ON the border and the next
      // leg travels along it, so the walk never needs to stand outside the
      // cell before it is sealed.
      seal(c);
    };
    // The end cell finishes the tour: its exit is the end point itself; only
    // the serpentine phase is free.
    const finishEndCell = () => {
      let flip = false;
      {
        const base = cornersFor(endCell, end);
        if (base.length >= 2) {
          const flipped = flipPhase(base);
          const score = (cs: Pt[]) => dist(pos, cs[0]) + 3 * dist(cs[cs.length - 1], end);
          const baseBad = nearSealedFor(base[base.length - 1], filled);
          const flipBad = nearSealedFor(flipped[flipped.length - 1], filled);
          if (baseBad !== flipBad) flip = baseBad;
          else flip = score(flipped) < score(base);
        }
      }
      const corners = fill(endCell, end, flip);
      if (dist(pos, end) >= 1e-12) {
        const hop = exitHop(endCell, corners, end);
        if (hop) pushTravel(hop, true);
        else route(end, segsOf(corners));
      }
    };

    try {
      if (tour === 'peel') {
        // Peeling scheduler. The legal next fills at any moment are exactly
        // the NON-CUT cells of the remaining adjacency graph (excluding the
        // end cell): removing a non-cut cell keeps the complement connected,
        // which keeps every future travel leg routable AND guarantees the
        // cell still has an unfilled neighbour to hop out through — the two
        // wet-paint requirements. This is a strict superset of the DFS's
        // post-orders: the walk may interleave between branches and fill a
        // cramped cell early while its surroundings are still open. A
        // connected graph always has a non-cut vertex besides any designated
        // one (a leaf of any spanning tree rooted at it), so the peel can
        // never strand itself.
        const nCells = faces.length;
        const nonCut = (rem: Set<number>): number[] => {
          // Tarjan articulation points on the subgraph induced by `rem`.
          const disc = new Map<number, number>();
          const low = new Map<number, number>();
          const cut = new Set<number>();
          let timer = 0;
          const dfs = (u: number, parentCell: number): void => {
            timer++;
            disc.set(u, timer);
            low.set(u, timer);
            let children = 0;
            for (const v of adjacency[u]) {
              if (!rem.has(v)) continue;
              if (!disc.has(v)) {
                children++;
                dfs(v, u);
                low.set(u, Math.min(low.get(u)!, low.get(v)!));
                if (parentCell >= 0 && low.get(v)! >= disc.get(u)!) cut.add(u);
              } else if (v !== parentCell) {
                low.set(u, Math.min(low.get(u)!, disc.get(v)!));
              }
            }
            if (parentCell < 0 && children > 1) cut.add(u);
          };
          const first = rem.values().next();
          if (first.done) return [];
          dfs(first.value, -1);
          return [...rem].filter((c2) => disc.has(c2) && !cut.has(c2));
        };
        // Beam search over full orders with cheap geometric proxies: a state
        // is (filled set, walk position, accumulated cost). Fill endpoints
        // are order-independent (shared lattice + parity) and cached, so the
        // only state-dependent term is sealed-wall proximity; a forced ending
        // pays a flat penalty so orders that avoid boxing cells in win.
        // Expansion is capped to the nearest few candidates to bound work on
        // large decompositions; only the winning ORDER is executed with the
        // real machinery below.
        const FORCED_PENALTY = 10 * nominal;
        const BEAM_WIDTH = 8;
        const EXPAND = 6;
        // The straight-line entry proxy underestimates legs that must route
        // AROUND sealed territory — without a correction the beam favours
        // non-local jumps whose real routed cost is far higher (the DFS's
        // tree structure enforces locality implicitly; the free peel must
        // price it). Each sealed wall the straight leg crosses forces a
        // detour of roughly a cell, charged here as a fraction of the shape.
        const DETOUR = 0.06 * diag;
        const detourPenalty = (a: Pt, b: Pt, filledSet: Set<number>): number => {
          let crossings = 0;
          for (const pe of portalList) {
            if (!filledSet.has(pe.i) && !filledSet.has(pe.j)) continue;
            for (const [u, v] of pe.segs)
              if (properCross(a, b, u, v, grazeTol)) {
                crossings++;
                break;
              }
          }
          return crossings * DETOUR;
        };
        type PeelState = {
          filled: Set<number>;
          at: Pt;
          cost: number;
          order: number[];
        };
        let beam: PeelState[] = [{ filled: new Set(), at: start, cost: 0, order: [] }];
        for (let step = 0; step + 1 < nCells; step++) {
          const expanded = new Map<string, PeelState>();
          for (const st of beam) {
            const rem = new Set<number>();
            for (let c2 = 0; c2 < nCells; c2++) if (!st.filled.has(c2)) rem.add(c2);
            const cand = nonCut(rem).filter((c2) => c2 !== endCell);
            cand.sort((a2, b2) => dist(st.at, centers[a2]) - dist(st.at, centers[b2]));
            for (const c2 of cand.slice(0, EXPAND)) {
              const opt = evalExits(c2, st.filled, st.at, []);
              const filled2 = new Set(st.filled);
              filled2.add(c2);
              const key = [...filled2].sort((x, y) => x - y).join(',');
              const cost2 =
                st.cost +
                (opt
                  ? opt.cost +
                    opt.bad * FORCED_PENALTY +
                    (opt.entry ? detourPenalty(st.at, opt.entry, st.filled) : 0)
                  : 0);
              const prev = expanded.get(key);
              if (!prev || cost2 < prev.cost) {
                expanded.set(key, {
                  filled: filled2,
                  at: opt ? opt.exitAt : st.at,
                  cost: cost2,
                  order: [...st.order, c2],
                });
              }
            }
          }
          if (expanded.size) {
            beam = [...expanded.values()]
              .sort((a2, b2) => a2.cost - b2.cost)
              .slice(0, BEAM_WIDTH);
          }
        }
        // Choose the finalist including the cost of finishing at the end cell.
        let order: number[] = beam[0].order;
        let bestFinal = Infinity;
        for (const st of beam) {
          if (st.order.length !== nCells - 1) continue;
          const cs = cornersFor(endCell, end);
          const t = cs.length
            ? dist(st.at, cs[0]) + dist(cs[cs.length - 1], end)
            : dist(st.at, end);
          if (st.cost + t < bestFinal) {
            bestFinal = st.cost + t;
            order = st.order;
          }
        }
        // Insurance: complete the order greedily if the beam fell short.
        if (order.length !== nCells - 1) {
          const filledSim = new Set(order);
          while (order.length < nCells - 1) {
            const rem = new Set<number>();
            for (let c2 = 0; c2 < nCells; c2++) if (!filledSim.has(c2)) rem.add(c2);
            const cand = nonCut(rem).filter((c2) => c2 !== endCell);
            if (!cand.length) break;
            order.push(cand[0]);
            filledSim.add(cand[0]);
          }
        }
        // Execute the order with the real machinery (routed travel, lane-safe
        // exit hops, sealing); exit and phase are re-decided per fill against
        // the walk's true position, with the next order entry as the target.
        {
          for (let oi = 0; oi < order.length; oi++) {
            const c2 = order[oi];
            const targets: Pt[] = [];
            if (oi + 1 < order.length) {
              targets.push(centers[order[oi + 1]]);
            } else {
              const cs = cornersFor(endCell, end);
              targets.push(cs.length ? cs[0] : end);
            }
            const choice = evalExits(c2, filled, pos, targets);
            if (choice) {
              fillAndSeal(c2, choice.nb, choice.flip);
            } else {
              const fallback = adjacency[c2].find((nb) => !filled.has(nb));
              if (fallback !== undefined) fillAndSeal(c2, fallback, false);
              else {
                fill(c2, end, false); // unreachable for a legal order
                seal(c2);
              }
            }
          }
          finishEndCell();
        }
      } else {
        // DFS with post-order filling. Iterative with an explicit stack so deep
        // decompositions can't overflow the call stack.
        //
        // Descending the tree generates NO travel of its own: the walk's only
        // mandatory waypoint is each cell's exit portal (the walk must stand
        // outside a cell before it is sealed). Everything else routes directly —
        // the fill() entry leg goes from wherever the walk is straight to the
        // next fill's first lane end, along the medial axis of the open region.
        // The tree is rooted at the EXIT cell: post-order filling fills the root
        // last, so the tour finishes in the exit's cell and the final hop lands
        // exactly on it. The walk still STARTS at the entry point — descent
        // generates no travel, so the first leg simply routes from the entry to
        // the first (deepest) fill.
        const visited = new Array(faces.length).fill(false);
        visited[endCell] = true;

        // Child ordering with lookahead. Because fill endpoints are
        // deterministic, three positions are known before descending:
        //   entryOf(nb): where the travel into nb's subtree lands — exact (the
        //     first lane end of nb's own fill) when nb is a leaf of the remaining
        //     graph, the shared portal's midpoint as a proxy when a subtree
        //     hangs below it;
        //   exitOf(nb): where the walk stands after nb is filled and left —
        //     always exact, since nb's own fill is the LAST thing before
        //     backtracking and it marches toward the shared portal regardless of
        //     what its subtree did;
        //   ownStart(cell): where cell's own fill begins after all children.
        // Choosing children nearest-portal-first (the old rule) is destination-
        // blind: with two children it can finish on the child whose exit lands
        // far from cell's own fill entry, dragging a full extra traverse. Instead
        // score every order of the remaining children by the travel chain
        //   pos -> entry(o1), exit(o1) -> entry(o2), ..., exit(ok) -> ownStart
        // and descend into the best order's first child. Re-evaluated on every
        // return with the walk's real position (receding horizon), so proxy error
        // in non-leaf entries self-corrects as subtrees complete.
        const ownStart = (cell: number, parent: number): Pt => {
          const exitPt = parent >= 0 ? portalMid(cell, parent) : end;
          const cs = cornersFor(cell, exitPt);
          return cs.length ? cs[0] : exitPt;
        };
        const exitOf = (nb: number, cell: number): Pt => {
          const cs = cornersFor(nb, portalMid(nb, cell));
          return cs.length
            ? portalClosest(nb, cell, cs[cs.length - 1])
            : portalMid(nb, cell);
        };
        const entryOf = (nb: number, cell: number): Pt => {
          const isLeaf = adjacency[nb].every((x) => visited[x] || x === cell);
          if (!isLeaf) return portalMid(cell, nb);
          const cs = cornersFor(nb, portalMid(nb, cell));
          return cs.length ? cs[0] : portalMid(cell, nb);
        };
        const permute = (arr: number[]): number[][] =>
          arr.length <= 1
            ? [arr]
            : arr.flatMap((v, i) =>
                permute([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [v, ...p]),
              );
        const pickNextChild = (cell: number, parent: number, kids: number[]): number => {
          if (kids.length === 1) return kids[0];
          let best = kids[0],
            bestCost = Infinity;
          if (kids.length <= 5) {
            const target = ownStart(cell, parent);
            const entries = new Map<number, Pt>(),
              exits = new Map<number, Pt>();
            for (const nb of kids) {
              entries.set(nb, entryOf(nb, cell));
              exits.set(nb, exitOf(nb, cell));
            }
            for (const order of permute(kids)) {
              let cost = dist(pos, entries.get(order[0])!);
              for (let i = 0; i + 1 < order.length; i++)
                cost += dist(exits.get(order[i])!, entries.get(order[i + 1])!);
              cost += dist(exits.get(order[order.length - 1])!, target);
              if (cost < bestCost) {
                bestCost = cost;
                best = order[0];
              }
            }
          } else {
            // Unusually many children: fall back to nearest-portal-first.
            for (const nb of kids) {
              const d = dist(pos, portalMid(cell, nb));
              if (d < bestCost) {
                bestCost = d;
                best = nb;
              }
            }
          }
          return best;
        };

        const stack: Array<{ cell: number; parent: number }> = [
          { cell: endCell, parent: -1 },
        ];
        {
          while (stack.length) {
            const { cell, parent } = stack[stack.length - 1];
            const kids = adjacency[cell].filter((nb) => !visited[nb]);
            if (kids.length) {
              const next = pickNextChild(cell, parent, kids);
              visited[next] = true;
              stack.push({ cell: next, parent: cell });
              continue;
            }
            // No unvisited neighbours: this is the walk's LAST visit — fill, hop
            // out through the parent portal while the cell is still open, then
            // seal it. The portal midpoint only orients the lane march; the
            // actual exit is the closest portal point to wherever the fill ended.
            stack.pop();
            if (parent >= 0) {
              // Exit and phase via the shared evaluator; the travel targets are
              // the parent's remaining children (their fill entries) or, when
              // none remain, the parent's own fill start.
              const pframe = stack[stack.length - 1]; // parent's frame (cell popped)
              const kids2 = adjacency[parent].filter((nb) => !visited[nb]);
              const targets = kids2.length
                ? kids2.map((nb) => entryOf(nb, parent))
                : [ownStart(parent, pframe ? pframe.parent : -1)];
              const choice = evalExits(cell, filled, pos, targets);
              if (choice) fillAndSeal(cell, choice.nb, choice.flip);
              else fillAndSeal(cell, parent, false);
            } else {
              finishEndCell();
            }
          }
        }
      }
    } finally {
      if (finder) finder.dispose();
    }

    const plan: BCDFillPlan = {
      steps,
      faces,
      fillSequence,
      startCell,
      endCell,
      start,
      end,
      travelLength,
      fillLength,
      unroutable,
    };
    return plan;
  }

  getStitches(pixelsPerMm: number): Stitch[] {
    const plan = this.getPlan(pixelsPerMm);
    const rot = this.rot;
    const laneXs = this.globalLaneXs(pixelsPerMm);
    const centerS = rot.toSweep(this.fillPatternCenterPosition);

    // Absolute sweep-y stitch positions per pattern row, covering the shape's
    // extent along the lanes (as AutoFill does over its bounding radius).
    let minSY = Infinity,
      maxSY = -Infinity;
    for (const ring of this.rings)
      for (const p of ring) {
        const sy = rot.toSweep(p).y;
        minSY = Math.min(minSY, sy);
        maxSY = Math.max(maxSY, sy);
      }
    const patternRows = this.fillPattern.map((row) => {
      const patt = row.rowPatternMm.map((v) => Math.max(v * pixelsPerMm, 0.01));
      const positions: number[] = [];
      const y0 = centerS.y + row.rowOffsetMm * pixelsPerMm;
      let y = y0,
        j = 0;
      while (y <= maxSY) {
        positions.push(y);
        y += patt[j];
        j = (j + 1) % patt.length;
      }
      y = y0;
      j = patt.length - 1;
      while (y >= minSY) {
        y -= patt[j];
        positions.unshift(y);
        j = (j - 1 + patt.length) % patt.length;
      }
      return positions; // ascending
    });
    const np = patternRows.length;

    const stitches: Stitch[] = [];
    const push = (p: Pt, type: StitchType) => {
      const v = new Vector(p.x, p.y);
      const last = stitches[stitches.length - 1];
      if (last && last.position.distance(v) < 1e-9) return;
      stitches.push(new Stitch(v, type));
    };
    push(plan.start, StitchType.START);

    for (const step of plan.steps) {
      if (step.type === 'seal') continue;
      if (step.type === 'travel') {
        if (step.path.length < 2) continue;
        const line = geometryFactory.createLineString(
          step.path.map((p) => new Coordinate(p.x, p.y)),
        );
        const simplified = VWSimplifier.simplify(
          line,
          this.travelStitchToleranceMm * pixelsPerMm,
        );
        const resampled = resample(
          simplified,
          this.travelStitchLengthMm * pixelsPerMm,
          pixelsPerMm,
        );
        for (let i = 0, n = resampled.getNumPoints(); i < n; i++) {
          const c = resampled.getCoordinateN(i);
          push({ x: c.x, y: c.y }, StitchType.TRAVEL);
        }
        continue;
      }
      // Fill: corners pair up into lanes (even segments); the odd segments
      // are the short hops between neighbouring lane ends. Lanes get the
      // pattern's intermediate penetrations, selected by the lane's row index
      // so the pattern staggers across lanes exactly as in AutoFill.
      const c = step.path;
      for (let i = 0; i + 1 < c.length; i += 2) {
        const a = c[i],
          b = c[i + 1];
        push(a, StitchType.NORMAL);
        let interior = 0;
        if (np > 0) {
          const aS = rot.toSweep(a),
            bS = rot.toSweep(b);
          // The lane's ordinal in the shape-wide lattice picks the pattern
          // row, so the stagger cycles continuously across cell boundaries.
          // Nearest match, not exact: the corner round-tripped through the
          // rotation (~1e-13 off), and a sliver cell's fallback mid-lane
          // sits off-lattice entirely.
          let rowIndex = 0,
            ri = laneXs.length;
          while (rowIndex < ri) {
            const m = (rowIndex + ri) >> 1;
            if (laneXs[m] < aS.x) rowIndex = m + 1;
            else ri = m;
          }
          if (
            rowIndex > 0 &&
            (rowIndex === laneXs.length ||
              laneXs[rowIndex] - aS.x > aS.x - laneXs[rowIndex - 1])
          ) {
            rowIndex--;
          }
          const positions = patternRows[((rowIndex % np) + np) % np];
          const eps = 1e-9 * this.diag;
          const lo = Math.min(aS.y, bS.y) + eps,
            hi = Math.max(aS.y, bS.y) - eps;
          // Binary search for the first position above lo; positions are
          // ascending, so the lane's window is one contiguous slice.
          let sliceLo = 0,
            sliceHi = positions.length;
          while (sliceLo < sliceHi) {
            const m = (sliceLo + sliceHi) >> 1;
            if (positions[m] <= lo) sliceLo = m + 1;
            else sliceHi = m;
          }
          let sliceEnd = sliceLo;
          while (sliceEnd < positions.length && positions[sliceEnd] < hi) sliceEnd++;
          const within = positions.slice(sliceLo, sliceEnd);
          if (aS.y > bS.y) within.reverse();
          for (const y of within) {
            const w = (y - aS.y) / (bS.y - aS.y);
            push(
              { x: a.x + w * (b.x - a.x), y: a.y + w * (b.y - a.y) },
              StitchType.NORMAL,
            );
          }
          interior = within.length;
        }
        // skipLast drops the row-end penetration (it sits right beside the
        // next row's first stitch) — unless the row has no interior stitches,
        // where dropping it would collapse the row to a single point.
        if (!this.skipLast || interior === 0) push(b, StitchType.NORMAL);
      }
    }
    return stitches;
  }
}
