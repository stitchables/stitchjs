import { IRun } from '../IRun';
import { Vector } from '../../Math/Vector';
import { Coordinate, Geometry } from 'jsts/org/locationtech/jts/geom';
import { OverlayOp } from 'jsts/org/locationtech/jts/operation/overlay';
import { geometryFactory } from '../../util/jsts';
import { Stitch } from '../Stitch';
import { StitchType } from '../EStitchType';
import MinPriorityQueue from '../../Optimize/MinPriorityQueue';

/**
 * Cross stitch fill
 *
 * Crosses are laid out on a pixel grid. Each "cross pixel" is covered by a small closed
 * cycle of stitches that always lays its diagonals down in the same order, so no cross
 * ends up flipped. The cycles are chained together through corners they share:
 *  - a "good" point is one where two cycles can be joined without flipping a cross, so the
 *    join costs nothing
 *  - a "bad" point join needs an extra travel stitch through the cross center, and is only
 *    used when there is no good point left to grow from
 *
 * Because every cross is stitched as a cycle, a fill starts and ends at the same position.
 *
 *  - `type: 'cross'`   -> simple cross (two diagonals)
 *  - `type: 'upright'` -> upright cross (horizontal + vertical)
 *  - `type: 'double'`  -> simple cross + upright cross, diagonals on top
 *  - `type: 'smyrna'`  -> simple cross + upright cross, upright on top
 *  - `type: 'half'`    -> a single diagonal per cross
 *  - `flipped: true`   -> swaps the order the two diagonals are sewn in
 *  - `dense: true`     -> adds a second grid of crosses offset by half a box
 *
 * Differences from the python implementation (all of them either speedups or fixes):
 *  - crosses are grouped into connected components with a union-find over the corners they
 *    share instead of building a node/edge graph and scanning it per cross (that scan is
 *    quadratic in the number of crosses)
 *  - every grid point lands on a half-box lattice, so points are identified by integer
 *    lattice indices rather than by floating point coordinate equality
 *  - the shape is classified per grid row with a scanline: boxes that no outline edge can
 *    reach are decided with a single crossing-number test, and the (comparatively few)
 *    boxes straddling the outline are the only ones that pay for a polygon intersection
 *  - growing a cycle no longer rescans the whole path after each bad point join. The good
 *    point pass only walks the freshly inserted section (nothing else can have gained a
 *    cross) and the bad point scan keeps a cursor, which makes the routing linear in the
 *    number of stitches instead of super-linear
 *  - `_cycles_to_stitches` emits the segment start point again for every segment, which
 *    doubles up a stitch at every grid point. Those duplicates are dropped here
 *  - disconnected components are ordered nearest-first, each one starting at the corner
 *    closest to where the needle already is, to keep the jumps between them short. Half
 *    crosses are traveled along the grid instead of around the pixelated outline
 *  - a thread count of 1 is treated as 2 (as the python docstring describes) rather than
 *    collapsing to an empty cross
 */
export type CrossStitchType = 'cross' | 'upright' | 'double' | 'smyrna' | 'half';

export interface CrossStitchFillOptions {
  type?: CrossStitchType;
  flipped?: boolean;
  dense?: boolean;
  sizeMm?: number | { x: number; y: number };
  threadCount?: number;
  coveragePct?: number;
  stitchLengthMm?: number;
  offsetMm?: { x: number; y: number };
  gridOrigin?: Vector;
  rotation?: number;
  rotationCenter?: Vector;
  startPosition?: Vector;
  endPosition?: Vector;
}

interface ICross {
  id: number;
  center: number;
  tl: number;
  tr: number;
  br: number;
  bl: number;
  ml: number;
  mt: number;
  mr: number;
  mb: number;
  good: number[];
  bad: number[];
  connections: number[];
  visited: number[];
}

const EPS = 1e-9;

export class CrossStitchFill implements IRun {
  shell: Vector[];
  holes: Vector[][];
  type: CrossStitchType;
  flipped: boolean;
  dense: boolean;
  sizeMm: { x: number; y: number };
  threadCount: number;
  coveragePct: number;
  stitchLengthMm: number;
  offsetMm: { x: number; y: number };
  gridOrigin: Vector | undefined;
  rotation: number;
  rotationCenter: Vector | undefined;
  startPosition: Vector | undefined;
  endPosition: Vector | undefined;
  constructor(shell: Vector[], holes: Vector[][] = [], options?: CrossStitchFillOptions) {
    this.shell = shell;
    this.holes = holes;
    this.type = options?.type ?? 'cross';
    this.flipped = options?.flipped ?? false;
    this.dense = options?.dense ?? false;
    const size = options?.sizeMm ?? 2;
    this.sizeMm = typeof size === 'number' ? { x: size, y: size } : size;
    this.threadCount = options?.threadCount ?? 2;
    this.coveragePct = options?.coveragePct ?? 50;
    this.stitchLengthMm = options?.stitchLengthMm ?? 3;
    this.offsetMm = options?.offsetMm ?? { x: 0, y: 0 };
    this.gridOrigin = options?.gridOrigin;
    this.rotation = options?.rotation ?? 0;
    this.rotationCenter = options?.rotationCenter;
    this.startPosition = options?.startPosition;
    this.endPosition = options?.endPosition;
  }
  getStitches(pixelsPerMm: number): Stitch[] {
    return new CrossStitchBuilder(this, pixelsPerMm).build();
  }
}

/**
 * Holds all of the derived, pixel space state for a single `getStitches` call.
 */
class CrossStitchBuilder {
  private type: CrossStitchType;
  private dense: boolean;
  private boxX: number;
  private boxY: number;
  private maxLength: number;
  private coverage: number;
  private repeats: number;
  private startPosition: Vector | undefined;
  private endPosition: Vector | undefined;

  // grid space geometry (the shape after the flip / rotation transform)
  private rings: number[][] = [];
  private shape: Geometry;
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;
  private gridMinX = 0;
  private gridMinY = 0;

  // half box lattice used to identify grid points
  private latticeX = 0;
  private latticeY = 0;
  private stepX = 1;
  private stepY = 1;
  private stride = 1;
  private pointIds = new Map<number, number>();
  private pointX: number[] = [];
  private pointY: number[] = [];
  private pointI: number[] = [];
  private pointJ: number[] = [];

  private crosses: ICross[] = [];
  private halfFlipped: boolean;
  private byGoodPoint = new Map<number, ICross[]>();
  private byBadPoint = new Map<number, ICross[]>();
  private byConnectionPoint = new Map<number, ICross[]>();

  // transform back into the caller's coordinate system
  private rotation: number;
  private rotationCenter: Vector;
  private flipCoordinates: boolean;

  constructor(run: CrossStitchFill, pixelsPerMm: number) {
    this.type = run.type;
    this.dense = run.dense;
    this.boxX = Math.max(run.sizeMm.x * pixelsPerMm, EPS);
    this.boxY = Math.max(run.sizeMm.y * pixelsPerMm, EPS);
    this.maxLength = Math.max(run.stitchLengthMm * pixelsPerMm, EPS);
    this.coverage = run.coveragePct;

    // half crosses count threads in bean stitch repeats and always come out odd, the other
    // methods stitch each diagonal `repeats` times in each direction
    const threadCount = Math.abs(Math.round(run.threadCount));
    this.repeats =
      this.type === 'half'
        ? Math.floor(threadCount / 2)
        : Math.max(1, Math.floor(threadCount / 2));

    // the grid is rotated rather than the crosses, so that rotating a shape does not move
    // the crosses around inside it
    this.rotation = run.rotation;
    const bounds = boundsOf(run.shell);
    this.rotationCenter =
      run.rotationCenter ?? run.gridOrigin ?? new Vector(bounds.minX, bounds.minY);
    // flipping swaps the order the diagonals are sewn in, which is the same as rotating the
    // shape by 90 degrees, stitching as usual and rotating the stitches back. A half cross
    // has nothing to reorder, so there it just picks the other diagonal
    this.flipCoordinates = run.flipped && this.type !== 'half';
    this.halfFlipped = run.flipped && this.type === 'half';

    for (const [index, ring] of [run.shell, ...run.holes].entries()) {
      const flat: number[] = [];
      for (const vertex of ring) {
        const p = this.toGridSpace(vertex);
        flat.push(p.x, p.y);
      }
      // the scanline and the polygon builder both want closed rings
      if (flat[0] !== flat[flat.length - 2] || flat[1] !== flat[flat.length - 1]) {
        flat.push(flat[0], flat[1]);
      }
      if (flat.length < 8) {
        // a ring with fewer than three distinct vertices has no area. Without a shell there
        // is nothing to fill at all
        if (index === 0) break;
        continue;
      }
      for (let i = 0; i < flat.length; i += 2) {
        if (flat[i] < this.minX) this.minX = flat[i];
        if (flat[i] > this.maxX) this.maxX = flat[i];
        if (flat[i + 1] < this.minY) this.minY = flat[i + 1];
        if (flat[i + 1] > this.maxY) this.maxY = flat[i + 1];
      }
      this.rings.push(flat);
    }
    this.shape =
      this.rings.length > 0 ? this.buildShape() : geometryFactory.createPolygon();

    this.startPosition = run.startPosition && this.toGridSpace(run.startPosition);
    this.endPosition = run.endPosition && this.toGridSpace(run.endPosition);

    // anchor the grid on the shape bounds unless the caller pinned it to a canvas position
    const anchorX = (run.gridOrigin?.x ?? this.minX) + run.offsetMm.x * pixelsPerMm;
    const anchorY = (run.gridOrigin?.y ?? this.minY) + run.offsetMm.y * pixelsPerMm;
    this.gridMinX = gridLineAtOrBefore(anchorX, this.minX, this.boxX);
    this.gridMinY = gridLineAtOrBefore(anchorY, this.minY, this.boxY);

    // every point a cross can contribute (corners, edge midpoints and centers) sits on a
    // half box lattice, so points can be keyed by integer indices instead of coordinates
    this.stepX = 0.5 * this.boxX;
    this.stepY = 0.5 * this.boxY;
    this.latticeX = this.gridMinX - 2 * this.boxX;
    this.latticeY = this.gridMinY - 2 * this.boxY;
    this.stride = Math.ceil((this.maxX - this.latticeX) / this.stepX) + 8;
  }

  build(): Stitch[] {
    if (this.rings.length === 0 || this.minX > this.maxX) return [];
    this.collectCrosses();
    if (this.crosses.length === 0) return [];
    const emitter = new PathEmitter(this.maxLength);
    if (this.type === 'half') this.stitchHalfCrosses(emitter);
    else this.stitchCrosses(emitter);
    return emitter.stitches.map(
      (s) => new Stitch(this.fromGridSpace(s.position), s.stitchType),
    );
  }

  // --------------------------------------------------------------------------------------
  // coordinate transforms
  // --------------------------------------------------------------------------------------

  private toGridSpace(v: Vector): Vector {
    let p = v;
    if (this.rotation !== 0) {
      p = p.subtract(this.rotationCenter).rotate(-this.rotation).add(this.rotationCenter);
    }
    if (this.flipCoordinates) p = new Vector(-p.y, p.x);
    return p;
  }

  private fromGridSpace(v: Vector): Vector {
    let p = v;
    if (this.flipCoordinates) p = new Vector(p.y, -p.x);
    if (this.rotation !== 0) {
      p = p.subtract(this.rotationCenter).rotate(this.rotation).add(this.rotationCenter);
    }
    return p;
  }

  private buildShape(): Geometry {
    const toRing = (flat: number[]) => {
      const coordinates: Coordinate[] = [];
      for (let i = 0; i < flat.length; i += 2) {
        coordinates.push(new Coordinate(flat[i], flat[i + 1]));
      }
      return geometryFactory.createLinearRing(coordinates);
    };
    return geometryFactory.createPolygon(
      toRing(this.rings[0]),
      this.rings.slice(1).map(toRing),
    );
  }

  // --------------------------------------------------------------------------------------
  // grid points
  // --------------------------------------------------------------------------------------

  private point(x: number, y: number): number {
    const i = Math.round((x - this.latticeX) / this.stepX);
    const j = Math.round((y - this.latticeY) / this.stepY);
    const key = j * this.stride + i;
    let id = this.pointIds.get(key);
    if (id === undefined) {
      id = this.pointX.length;
      // rebuild the coordinate from the lattice so that a point always has one position
      this.pointX.push(this.latticeX + i * this.stepX);
      this.pointY.push(this.latticeY + j * this.stepY);
      this.pointI.push(i);
      this.pointJ.push(j);
      this.pointIds.set(key, id);
    }
    return id;
  }

  private vectorAt(point: number): Vector {
    return new Vector(this.pointX[point], this.pointY[point]);
  }

  private distanceBetween(a: number, b: number): number {
    const dx = this.pointX[a] - this.pointX[b];
    const dy = this.pointY[a] - this.pointY[b];
    return Math.sqrt(dx * dx + dy * dy);
  }

  // --------------------------------------------------------------------------------------
  // cross geometry
  // --------------------------------------------------------------------------------------

  private collectCrosses(): void {
    // a dense fill adds a second grid offset by half a box in both directions
    const passes: number[][] = this.dense
      ? [
          [0, 0],
          [0.5 * this.boxX, 0.5 * this.boxY],
        ]
      : [[0, 0]];
    for (const [dx, dy] of passes) {
      const originX = this.gridMinX - dx;
      const originY = this.gridMinY - dy;
      const columns = Math.max(Math.ceil((this.maxX - originX) / this.boxX), 0);
      const rows = Math.max(Math.ceil((this.maxY - originY) / this.boxY), 0);
      for (let row = 0; row < rows; row++) {
        const y = originY + row * this.boxY;
        if (y + this.boxY <= this.minY + EPS) continue;
        // one scanline per row: `straddles` flags the boxes an outline edge can reach and
        // `crossings` decides all of the others with a crossing number test
        const straddles = this.straddlingColumns(y, y + this.boxY, originX, columns);
        const crossings = this.rowCrossings(y + 0.5 * this.boxY);
        let crossed = 0;
        for (let column = 0; column < columns; column++) {
          const x = originX + column * this.boxX;
          if (x + this.boxX <= this.minX + EPS) continue;
          if (straddles[column] === 1) {
            if (this.boxCoveragePct(x, y) + 1e-4 >= this.coverage) this.addCross(x, y);
          } else {
            const centerX = x + 0.5 * this.boxX;
            while (crossed < crossings.length && crossings[crossed] < centerX) crossed++;
            if (crossed % 2 === 1) this.addCross(x, y);
          }
        }
      }
    }
    this.indexCrosses();
  }

  /**
   * Flags the columns of one grid row whose box could be cut by the outline. Marking a
   * column that turns out to be fully inside or outside only costs an exact area test, so
   * the range is padded by a column on either side to stay on the safe side of rounding.
   */
  private straddlingColumns(
    y0: number,
    y1: number,
    originX: number,
    columns: number,
  ): Uint8Array {
    const flags = new Uint8Array(columns);
    const low = y0 - EPS;
    const high = y1 + EPS;
    for (const ring of this.rings) {
      for (let i = 0; i + 3 < ring.length; i += 2) {
        const ax = ring[i];
        const ay = ring[i + 1];
        const bx = ring[i + 2];
        const by = ring[i + 3];
        if (Math.max(ay, by) < low || Math.min(ay, by) > high) continue;
        let xMin: number;
        let xMax: number;
        if (Math.abs(by - ay) < EPS) {
          xMin = Math.min(ax, bx);
          xMax = Math.max(ax, bx);
        } else {
          // clip the edge to the row band so that long edges only mark the columns they
          // actually pass through
          const clipLow = Math.max(low, Math.min(ay, by));
          const clipHigh = Math.min(high, Math.max(ay, by));
          const slope = (bx - ax) / (by - ay);
          const xLow = ax + (clipLow - ay) * slope;
          const xHigh = ax + (clipHigh - ay) * slope;
          xMin = Math.min(xLow, xHigh);
          xMax = Math.max(xLow, xHigh);
        }
        const from = Math.max(Math.floor((xMin - originX) / this.boxX) - 1, 0);
        const to = Math.min(Math.floor((xMax - originX) / this.boxX) + 1, columns - 1);
        for (let column = from; column <= to; column++) flags[column] = 1;
      }
    }
    return flags;
  }

  private rowCrossings(y: number): number[] {
    const crossings: number[] = [];
    for (const ring of this.rings) {
      for (let i = 0; i + 3 < ring.length; i += 2) {
        const ax = ring[i];
        const ay = ring[i + 1];
        const bx = ring[i + 2];
        const by = ring[i + 3];
        if (ay <= y !== by <= y) crossings.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
    }
    return crossings.sort((a, b) => a - b);
  }

  private boxCoveragePct(x: number, y: number): number {
    const box = geometryFactory.createPolygon(
      geometryFactory.createLinearRing([
        new Coordinate(x, y),
        new Coordinate(x + this.boxX, y),
        new Coordinate(x + this.boxX, y + this.boxY),
        new Coordinate(x, y + this.boxY),
        new Coordinate(x, y),
      ]),
    );
    try {
      const area = OverlayOp.intersection(box, this.shape).getArea();
      return (100 * area) / (this.boxX * this.boxY);
    } catch (e) {
      // an invalid outline can make the overlay fail - fall back on the box center
      return this.containsPoint(x + 0.5 * this.boxX, y + 0.5 * this.boxY) ? 100 : 0;
    }
  }

  private containsPoint(x: number, y: number): boolean {
    let inside = false;
    for (const ring of this.rings) {
      for (let i = 0; i + 3 < ring.length; i += 2) {
        const ay = ring[i + 1];
        const by = ring[i + 3];
        if (ay <= y === by <= y) continue;
        const ax = ring[i];
        const bx = ring[i + 2];
        if (ax + ((y - ay) * (bx - ax)) / (by - ay) < x) inside = !inside;
      }
    }
    return inside;
  }

  private addCross(x: number, y: number): void {
    const centerX = x + 0.5 * this.boxX;
    const centerY = y + 0.5 * this.boxY;
    const cross: ICross = {
      id: this.crosses.length,
      center: this.point(centerX, centerY),
      tl: this.point(x, y),
      tr: this.point(x + this.boxX, y),
      br: this.point(x + this.boxX, y + this.boxY),
      bl: this.point(x, y + this.boxY),
      ml: this.point(x, centerY),
      mt: this.point(centerX, y),
      mr: this.point(x + this.boxX, centerY),
      mb: this.point(centerX, y + this.boxY),
      good: [],
      bad: [],
      connections: [],
      visited: [],
    };
    const corners = [cross.tl, cross.tr, cross.br, cross.bl];
    const middles = [cross.ml, cross.mt, cross.mr, cross.mb];
    switch (this.type) {
      case 'upright':
        cross.good = [cross.mt, cross.mb];
        cross.bad = [cross.ml, cross.mr];
        cross.visited = [...middles, cross.center];
        break;
      case 'smyrna':
        // joining through the top or bottom middle point is the only way into a smyrna
        // cross that does not need a travel stitch through its center
        cross.good = [cross.mt, cross.mb];
        cross.bad = [cross.tl, cross.tr, cross.bl, cross.br];
        cross.visited = [...corners, ...middles, cross.center];
        break;
      case 'half':
        cross.good = [cross.tr, cross.bl];
        cross.bad = [cross.tl, cross.br];
        // a half cross has no cycle - it is traveled along the box outlines
        cross.visited = corners;
        break;
      case 'double':
        cross.good = [cross.tr, cross.bl];
        cross.bad = [cross.tl, cross.br];
        cross.visited = [...corners, ...middles, cross.center];
        break;
      default:
        cross.good = [cross.tr, cross.bl];
        cross.bad = [cross.tl, cross.br];
        cross.visited = [...corners, cross.center];
        break;
    }
    cross.connections = [...cross.good, ...cross.bad];
    this.crosses.push(cross);
  }

  private indexCrosses(): void {
    for (const cross of this.crosses) {
      for (const point of cross.good) push(this.byGoodPoint, point, cross);
      for (const point of cross.bad) push(this.byBadPoint, point, cross);
      for (const point of cross.connections) push(this.byConnectionPoint, point, cross);
    }
  }

  private removeCross(cross: ICross): void {
    for (const point of cross.good) remove(this.byGoodPoint, point, cross);
    for (const point of cross.bad) remove(this.byBadPoint, point, cross);
  }

  /**
   * The stitch order for a single cross, starting and ending at `point`. Each diagonal is
   * laid down `repeats` times in each direction, bean stitch fashion, and the diagonals are
   * always sewn in the same order so that no cross ends up flipped.
   */
  private cycleFromPoint(cross: ICross, point: number): number[] {
    const n = this.repeats;
    const out: number[] = [];
    const { center, tl, tr, br, bl, ml, mt, mr, mb } = cross;
    const pairs = (a: number, b: number, count: number) => {
      for (let i = 0; i < count; i++) out.push(a, b);
    };
    const upright = (first: number, second: number) => {
      pairs(ml, mr, n);
      out.push(center);
      pairs(first, second, n);
    };
    if (this.type === 'upright') {
      if (point === mt || point === mb) {
        out.push(center);
        pairs(ml, mr, n);
        out.push(center);
        pairs(point === mt ? mb : mt, point, n);
      } else {
        const other = point === ml ? mr : ml;
        pairs(other, point, n - 1);
        out.push(other, center);
        pairs(mt, mb, n);
        out.push(center, point); // this is bad travel
      }
      return out;
    }
    if (this.type === 'smyrna') {
      if (point === mt || point === mb) {
        out.push(center);
        pairs(tl, br, n);
        out.push(center);
        pairs(bl, tr, n);
        out.push(center);
        upright(point === mt ? mb : mt, point);
      } else if (point === tl || point === br) {
        const other = point === tl ? br : tl;
        pairs(other, point, n - 1);
        out.push(other, center);
        if (point === tl) pairs(bl, tr, n);
        else pairs(tr, bl, n);
        out.push(center);
        upright(point === tl ? mb : mt, point === tl ? mt : mb);
        out.push(center, point); // this is bad travel
      } else {
        // a top right / bottom left start has to reach the second diagonal through the
        // center to keep the layering, which costs one travel stitch. Ending this
        // leg on the far corner drops the second diagonal entirely when the thread
        // count is 2, so it is walked back to `corner` here instead
        const corner = point === tr ? tr : bl;
        const opposite = point === tr ? bl : tr;
        out.push(center);
        if (corner === tr) pairs(tl, br, n);
        else pairs(br, tl, n);
        out.push(center, opposite);
        pairs(corner, opposite, n - 1);
        out.push(corner, center);
        upright(mt, mb);
        out.push(center, point); // this is bad travel
      }
      return out;
    }
    const double = this.type === 'double';
    if (point === tr || point === bl) {
      const opposite = point === tr ? bl : tr;
      out.push(center);
      if (point === tr) pairs(tl, br, n);
      else pairs(br, tl, n);
      out.push(center);
      if (double) {
        pairs(ml, mr, n);
        out.push(center);
        pairs(mt, mb, n);
        out.push(center);
      }
      pairs(opposite, point, n);
    } else {
      const opposite = point === tl ? br : tl;
      pairs(opposite, point, n - 1);
      out.push(opposite, center);
      if (double) {
        pairs(ml, mr, n);
        out.push(center);
        pairs(mt, mb, n);
        out.push(center);
      }
      pairs(tr, bl, n);
      out.push(center, point); // this is bad travel
    }
    return out;
  }

  // --------------------------------------------------------------------------------------
  // routing
  // --------------------------------------------------------------------------------------

  /**
   * A cross can be grafted onto a growing path at any point the path already visits, which
   * covers its neighbours' corners and middle points but also their centers - a dense fill
   * offsets its second grid by half a box, putting those crosses' corners exactly on the
   * first grid's centers. So the components are the classes of a union-find that relates
   * every cross to the crosses able to attach at any point its own cycle walks over.
   */
  private connectedComponents(): ICross[][] {
    const parent = new Int32Array(this.crosses.length);
    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = (i: number): number => {
      let root = i;
      while (parent[root] !== root) root = parent[root];
      while (parent[i] !== root) {
        const next = parent[i];
        parent[i] = root;
        i = next;
      }
      return root;
    };
    for (const cross of this.crosses) {
      for (const point of cross.visited) {
        for (const other of this.byConnectionPoint.get(point) ?? []) {
          const [a, b] = [find(cross.id), find(other.id)];
          if (a !== b) parent[a] = b;
        }
      }
    }
    const byRoot = new Map<number, ICross[]>();
    for (let i = 0; i < this.crosses.length; i++) push(byRoot, find(i), this.crosses[i]);
    return [...byRoot.values()];
  }

  /** The connection point closest to `position`, snapping a caller's start / end onto the grid. */
  private nearestConnectionPoint(position: Vector): number {
    let best = -1;
    let bestDistance = Infinity;
    for (const point of this.byConnectionPoint.keys()) {
      const dx = this.pointX[point] - position.x;
      const dy = this.pointY[point] - position.y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = point;
      }
    }
    return best;
  }

  /**
   * A good point that only one cross touches, so a cycle does not start inside the shape.
   * When `near` is given the closest one wins, which keeps the jump onto a disconnected
   * patch of crosses as short as possible.
   */
  private outsideStartPoint(component: ICross[], near?: Vector): number {
    let best = -1;
    let bestDistance = Infinity;
    for (const cross of component) {
      for (const point of cross.good) {
        if ((this.byConnectionPoint.get(point) as ICross[]).length !== 1) continue;
        if (!near) return point;
        const distance = this.vectorAt(point).distance(near);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = point;
        }
      }
    }
    return best >= 0 ? best : component[0].good[0];
  }

  /** The corner of `component` closest to `position`. */
  private nearestCorner(component: ICross[], position: Vector): number {
    let best = component[0].tl;
    let bestDistance = Infinity;
    for (const cross of component) {
      for (const point of [cross.tl, cross.tr, cross.br, cross.bl]) {
        const dx = this.pointX[point] - position.x;
        const dy = this.pointY[point] - position.y;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = point;
        }
      }
    }
    return best;
  }

  private nearestComponent(components: ICross[][], position: Vector): number {
    let best = 0;
    let bestDistance = Infinity;
    for (const [i, component] of components.entries()) {
      const corner = this.nearestCorner(component, position);
      const distance = this.vectorAt(corner).distance(position);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  /**
   * The component holding the requested start goes first and the one holding the requested
   * end goes last. Everything in between is ordered nearest first, which keeps the jumps
   * between disconnected patches of crosses short.
   */
  private orderComponents(
    components: ICross[][],
    firstIndex: number,
    lastIndex: number,
    representative: (component: ICross[]) => Vector,
  ): number[] {
    const order: number[] = [];
    if (firstIndex >= 0) order.push(firstIndex);
    const remaining = components
      .map((_, i) => i)
      .filter((i) => i !== firstIndex && i !== lastIndex);
    let cursor =
      firstIndex >= 0
        ? representative(components[firstIndex])
        : (this.startPosition ?? null);
    while (remaining.length > 0) {
      let pick = 0;
      if (cursor !== null) {
        let bestDistance = Infinity;
        for (let k = 0; k < remaining.length; k++) {
          const distance = cursor.distance(representative(components[remaining[k]]));
          if (distance < bestDistance) {
            bestDistance = distance;
            pick = k;
          }
        }
      }
      const index = remaining.splice(pick, 1)[0];
      order.push(index);
      cursor = representative(components[index]);
    }
    if (lastIndex >= 0 && lastIndex !== firstIndex) order.push(lastIndex);
    return order;
  }

  private stitchCrosses(emitter: PathEmitter): void {
    const components = this.connectedComponents();
    const startPoint = this.startPosition
      ? this.nearestConnectionPoint(this.startPosition)
      : -1;
    const endPoint = this.endPosition
      ? this.nearestConnectionPoint(this.endPosition)
      : -1;
    const indexOf = (point: number) => {
      if (point < 0) return -1;
      const crosses = this.byConnectionPoint.get(point);
      if (!crosses) return -1;
      return components.findIndex((component) => component.indexOf(crosses[0]) >= 0);
    };
    const firstIndex = indexOf(startPoint);
    const lastIndex = indexOf(endPoint);

    const starts = new Map<ICross[], number>();
    const startOf = (component: ICross[]) => {
      let point = starts.get(component);
      if (point === undefined) {
        point = this.outsideStartPoint(component);
        starts.set(component, point);
      }
      return point;
    };
    const order = this.orderComponents(components, firstIndex, lastIndex, (component) =>
      this.vectorAt(startOf(component)),
    );

    let needle: Vector | undefined = undefined;
    for (const [i, index] of order.entries()) {
      const component = components[index];
      const isLast = i === order.length - 1;
      let cycleStart: number;
      if (index === firstIndex && index === lastIndex && isLast) {
        // both ends land in the same component: travel across to the requested end point
        // and run the cycle from there, so the fill finishes where it was asked to
        const travel = this.shortestPath(
          this.componentGraph(component),
          startPoint,
          endPoint,
        );
        if (travel) {
          for (const [j, point] of travel.entries()) {
            if (j === 0) emitter.moveTo(this.vectorAt(point), StitchType.TRAVEL);
            else emitter.lineTo(this.vectorAt(point), StitchType.TRAVEL);
          }
        }
        cycleStart = endPoint;
      } else if (index === firstIndex) cycleStart = startPoint;
      else if (index === lastIndex) cycleStart = endPoint;
      else {
        // start the last patch of crosses as close to the requested end as possible, and
        // any other patch as close as possible to where the needle already is
        cycleStart = this.outsideStartPoint(
          component,
          (isLast ? this.endPosition : undefined) ?? needle,
        );
      }

      const cycle = this.buildCycle(component, cycleStart);
      // a component whose crosses were all grafted onto an earlier cycle has nothing left
      if (cycle.length < 2) continue;
      for (const [j, point] of cycle.entries()) {
        const position = this.vectorAt(point);
        if (j > 0) emitter.lineTo(position, StitchType.NORMAL);
        else if (emitter.isEmpty()) emitter.moveTo(position, StitchType.NORMAL);
        else if (!emitter.isAt(position)) emitter.moveTo(position, StitchType.JUMP);
      }
      needle = this.vectorAt(cycle[cycle.length - 1]);
    }
  }

  /**
   * Grows one closed path covering every cross of a component, starting and ending at
   * `startPoint`. Cycles are grafted in at good points wherever possible, and a bad point
   * is only used when the path has run out of good ones.
   */
  private buildCycle(component: ICross[], startPoint: number): number[] {
    const remainingCrosses = new Set(component);
    // the path is a singly linked list so that a cross can be grafted in without shifting
    // everything behind it
    const value: number[] = [];
    const next: number[] = [];
    const node = (point: number) => {
      value.push(point);
      next.push(-1);
      return value.length - 1;
    };
    const insertAfter = (at: number, points: number[]) => {
      let cursor = at;
      for (const point of points) {
        const created = node(point);
        next[created] = next[cursor];
        next[cursor] = created;
        cursor = created;
      }
      return cursor;
    };
    const take = (cross: ICross, point: number) => {
      this.removeCross(cross);
      remainingCrosses.delete(cross);
      return this.cycleFromPoint(cross, point);
    };

    const atStart = [
      ...(this.byGoodPoint.get(startPoint) ?? []),
      ...(this.byBadPoint.get(startPoint) ?? []),
    ];
    const first = atStart[0];
    if (!first) return [startPoint];
    const opening = take(first, startPoint);
    const head = node(opening[0]);
    let regionEnd = insertAfter(head, opening.slice(1));
    let walkFrom = head;
    let badCursor = head;

    while (remainingCrosses.size > 0) {
      // good point pass - only the freshly inserted section can have gained a cross, every
      // point before it was already drained
      let current = walkFrom;
      while (current !== -1) {
        const point = value[current];
        const available = this.byGoodPoint.get(point);
        if (available && available.length > 0) {
          const attaching = available.slice();
          for (const cross of attaching) {
            const inserted = insertAfter(current, take(cross, point));
            if (current === regionEnd) regionEnd = inserted;
          }
        }
        if (current === regionEnd) break;
        current = next[current];
      }
      if (remainingCrosses.size === 0) break;

      // bad point pass - graft in a single cross at the first point that has one. Points
      // behind the cursor can only lose crosses, so the scan never needs to restart
      let found = -1;
      for (let n = badCursor; n !== -1; n = next[n]) {
        const available = this.byBadPoint.get(value[n]);
        if (available && available.length > 0) {
          found = n;
          break;
        }
      }
      if (found === -1) break;
      badCursor = found;
      const point = value[found];
      const cross = (this.byBadPoint.get(point) as ICross[])[0];
      const inserted = insertAfter(found, take(cross, point));
      walkFrom = found;
      regionEnd = inserted;
    }

    const path = [startPoint];
    for (let n = head; n !== -1; n = next[n]) path.push(value[n]);
    return path;
  }

  /** Center to corner edges of one component, used to travel from a start to an end point. */
  private componentGraph(component: ICross[]): Map<number, number[]> {
    const graph = new Map<number, number[]>();
    const link = (a: number, b: number) => {
      push(graph, a, b);
      push(graph, b, a);
    };
    for (const cross of component) {
      for (const point of cross.connections) link(cross.center, point);
    }
    return graph;
  }

  private shortestPath(
    graph: Map<number, number[]>,
    from: number,
    to: number,
  ): number[] | null {
    if (from === to) return [from];
    if (!graph.has(from) || !graph.has(to)) return null;
    const cost = new Map<number, number>([[from, 0]]);
    const cameFrom = new Map<number, number>();
    const queue = new MinPriorityQueue();
    queue.enqueue({ priority: this.distanceBetween(from, to), node: from });
    while (!queue.isEmpty()) {
      const { node } = queue.dequeue();
      if (node === to) {
        const path = [to];
        let cursor = to;
        while (cursor !== from) {
          cursor = cameFrom.get(cursor) as number;
          path.push(cursor);
        }
        return path.reverse();
      }
      const distance = cost.get(node) as number;
      for (const neighbor of graph.get(node) ?? []) {
        const candidate = distance + this.distanceBetween(node, neighbor);
        const known = cost.get(neighbor);
        if (known !== undefined && known <= candidate + EPS) continue;
        cost.set(neighbor, candidate);
        cameFrom.set(neighbor, node);
        queue.enqueue({
          priority: candidate + this.distanceBetween(neighbor, to),
          node: neighbor,
        });
      }
    }
    return null;
  }

  // --------------------------------------------------------------------------------------
  // half crosses
  // --------------------------------------------------------------------------------------

  /**
   * Half crosses only have one diagonal each, so there are no cycles to chain. Diagonals of
   * neighbouring crosses meet end to end and merge into long runs, which are then stitched
   * boustrophedon style, traveling along the grid between runs. Each connected group of
   * crosses is finished before moving on, so a split shape only costs one jump per group.
   */
  private stitchHalfCrosses(emitter: PathEmitter): void {
    const components = this.connectedComponents();
    const graph = this.gridGraph();
    const passes = 2 * this.repeats + 1;
    const firstIndex = this.startPosition
      ? this.nearestComponent(components, this.startPosition)
      : -1;
    const lastIndex = this.endPosition
      ? this.nearestComponent(components, this.endPosition)
      : -1;
    const order = this.orderComponents(components, firstIndex, lastIndex, (component) =>
      this.vectorAt(component[0].tl),
    );

    let previous = -1;
    if (this.startPosition) {
      // begin exactly where the caller asked, snapped onto the grid
      previous = this.nearestCorner(components[order[0]], this.startPosition);
      emitter.moveTo(this.vectorAt(previous), StitchType.TRAVEL);
    }
    for (const [i, index] of order.entries()) {
      const component = components[index];
      const startHint =
        i === 0 && this.startPosition
          ? this.startPosition
          : previous >= 0
            ? this.vectorAt(previous)
            : null;
      const endHint = index === lastIndex ? (this.endPosition ?? null) : null;
      const chains = this.orderChains(this.diagonalChains(component), startHint, endHint);
      for (const chain of chains) {
        if (previous === -1) emitter.moveTo(this.vectorAt(chain[0]), StitchType.NORMAL);
        else this.travelTo(emitter, graph, previous, chain[0]);
        // an odd number of passes leaves the needle at the far end of the run
        for (let pass = 0; pass < passes; pass++) {
          const points = pass % 2 === 0 ? chain.slice(1) : chain.slice(0, -1).reverse();
          for (const point of points) {
            emitter.lineTo(this.vectorAt(point), StitchType.NORMAL);
          }
        }
        previous = chain[chain.length - 1];
      }
    }
    if (this.endPosition && previous >= 0) {
      const last = components[order[order.length - 1]];
      this.travelTo(emitter, graph, previous, this.nearestCorner(last, this.endPosition));
    }
  }

  private travelTo(
    emitter: PathEmitter,
    graph: Map<number, number[]>,
    from: number,
    to: number,
  ): void {
    const travel = from === to ? null : this.shortestPath(graph, from, to);
    if (travel) {
      for (const point of travel.slice(1)) {
        emitter.lineTo(this.vectorAt(point), StitchType.TRAVEL);
      }
    } else if (from !== to) emitter.moveTo(this.vectorAt(to), StitchType.JUMP);
  }

  private diagonalChains(component: ICross[]): number[][] {
    const flipped = this.halfFlipped;
    const startOf = (cross: ICross) => (flipped ? cross.bl : cross.tl);
    const endOf = (cross: ICross) => (flipped ? cross.tr : cross.br);
    const byStart = new Map<number, ICross>();
    const ends = new Set<number>();
    for (const cross of component) {
      byStart.set(startOf(cross), cross);
      ends.add(endOf(cross));
    }
    const chains: number[][] = [];
    for (const cross of component) {
      if (ends.has(startOf(cross))) continue;
      const chain = [startOf(cross)];
      let current: ICross | undefined = cross;
      while (current) {
        chain.push(endOf(current));
        current = byStart.get(endOf(current));
      }
      chains.push(chain);
    }
    return chains;
  }

  /**
   * Sorts the diagonal runs onto their shared lines and walks those lines back and forth,
   * picking whichever of the four orderings starts and ends closest to where the fill is
   * coming from and where it has to finish.
   */
  private orderChains(
    chains: number[][],
    startHint: Vector | null,
    endHint: Vector | null,
  ): number[][] {
    const flipped = this.halfFlipped;
    const lineOf = (chain: number[]) =>
      flipped
        ? this.pointI[chain[0]] + this.pointJ[chain[0]]
        : this.pointI[chain[0]] - this.pointJ[chain[0]];
    const alongOf = (chain: number[]) =>
      flipped
        ? this.pointI[chain[0]] - this.pointJ[chain[0]]
        : this.pointI[chain[0]] + this.pointJ[chain[0]];
    const sorted = chains
      .slice()
      .sort((a, b) => lineOf(a) - lineOf(b) || alongOf(a) - alongOf(b));
    const lines: number[][][] = [];
    for (const chain of sorted) {
      const last = lines[lines.length - 1];
      if (last && lineOf(last[0]) === lineOf(chain)) last.push(chain);
      else lines.push([chain]);
    }

    const layout = (reverseLines: boolean, reverseFirst: boolean) => {
      const out: number[][] = [];
      const groups = reverseLines ? lines.slice().reverse() : lines;
      for (const [i, group] of groups.entries()) {
        const backwards = (i % 2 === 0) === reverseFirst;
        const walk = backwards ? group.slice().reverse() : group;
        for (const chain of walk) out.push(backwards ? chain.slice().reverse() : chain);
      }
      return out;
    };
    let best: number[][] | null = null;
    let bestCost = Infinity;
    for (const reverseLines of [false, true]) {
      for (const reverseFirst of [false, true]) {
        const candidate = layout(reverseLines, reverseFirst);
        if (!startHint && !endHint) return candidate;
        const last = candidate[candidate.length - 1];
        let cost = 0;
        if (startHint) cost += startHint.distance(this.vectorAt(candidate[0][0]));
        if (endHint) cost += endHint.distance(this.vectorAt(last[last.length - 1]));
        if (cost < bestCost) {
          bestCost = cost;
          best = candidate;
        }
      }
    }
    return best as number[][];
  }

  /** Box outlines of every cross, so half cross travel stays on the pixelated grid. */
  private gridGraph(): Map<number, number[]> {
    const graph = new Map<number, number[]>();
    const seen = new Set<number>();
    const points = this.pointX.length;
    const link = (a: number, b: number) => {
      const key = a < b ? a * points + b : b * points + a;
      if (seen.has(key)) return;
      seen.add(key);
      push(graph, a, b);
      push(graph, b, a);
    };
    for (const cross of this.crosses) {
      link(cross.tl, cross.tr);
      link(cross.tr, cross.br);
      link(cross.br, cross.bl);
      link(cross.bl, cross.tl);
    }
    return graph;
  }
}

/** Collects stitches, splitting anything longer than `maxLength` into equal steps. */
class PathEmitter {
  stitches: Stitch[] = [];
  private last: Vector | null = null;
  constructor(private maxLength: number) {}
  isEmpty(): boolean {
    return this.stitches.length === 0;
  }
  isAt(position: Vector): boolean {
    return this.last !== null && this.last.distance(position) < EPS;
  }
  moveTo(position: Vector, stitchType: StitchType): void {
    this.stitches.push(new Stitch(position, stitchType));
    this.last = position;
  }
  lineTo(position: Vector, stitchType: StitchType): void {
    if (this.last === null) {
      this.moveTo(position, stitchType);
      return;
    }
    const distance = this.last.distance(position);
    if (distance < EPS) return;
    const steps = Math.ceil(distance / this.maxLength - 1e-9);
    for (let i = 1; i < steps; i++) {
      this.stitches.push(new Stitch(this.last.lerp(position, i / steps), stitchType));
    }
    this.stitches.push(new Stitch(position, stitchType));
    this.last = position;
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function remove<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (!existing) return;
  const index = existing.indexOf(value);
  if (index >= 0) existing.splice(index, 1);
}

function boundsOf(vertices: Vector[]) {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const vertex of vertices) {
    if (vertex.x < minX) minX = vertex.x;
    if (vertex.x > maxX) maxX = vertex.x;
    if (vertex.y < minY) minY = vertex.y;
    if (vertex.y > maxY) maxY = vertex.y;
  }
  return { minX, minY, maxX, maxY };
}

/** The largest `anchor + k * size` that is not past `limit`. */
function gridLineAtOrBefore(anchor: number, limit: number, size: number): number {
  return anchor - Math.ceil((anchor - limit) / size - EPS) * size;
}
