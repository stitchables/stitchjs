import { Vector } from '../Math/Vector';
import { Location, Coordinate, Point, Polygon } from 'jsts/org/locationtech/jts/geom';
import { DistanceOp } from 'jsts/org/locationtech/jts/operation/distance';
import IndexedFacetDistance from 'jsts/org/locationtech/jts/operation/distance/IndexedFacetDistance';
import IndexedPointInAreaLocator from 'jsts/org/locationtech/jts/algorithm/locate/IndexedPointInAreaLocator';
import { createPolygon } from '../Geometry/createPolygon';
import { geometryFactory } from '../util/jsts';

interface LazyAStarOptions {
  angleStepDeg?: number; // angular increment for sampling
  samplesPerExpansion?: number; // max candidate headings per node
  minStep?: number;
  maxStep?: number;
  stepScale?: number; // step = clamp(clearance * stepScale, minStep, maxStep)
  goalTolerance?: number;
  lambdaClearance?: number; // weight for low-clearance penalty
  maxIterations?: number;
  stateQuantization?: number; // grid size for deduping search states
  headingBins?: number; // heading bucket count for deduping
}

interface SearchNode {
  id: number;
  p: Point;
  g: number;
  f: number;
  heading: number; // radians
  parent: SearchNode | null;
}

const DEFAULTS: Required<LazyAStarOptions> = {
  angleStepDeg: 45,
  samplesPerExpansion: 4,
  minStep: 4,
  maxStep: 40,
  stepScale: 0.75,
  goalTolerance: 6,
  lambdaClearance: 20,
  maxIterations: 10000,
  stateQuantization: 8,
  headingBins: 4,
};

export function findPolygonPath(
  geometry: {
    shell: Vector[];
    holes?: Vector[][];
  },
  start: Vector,
  end: Vector,
  options: LazyAStarOptions = {},
): Vector[] | null {
  const opt = { ...DEFAULTS, ...options };

  const polygon = createPolygon(geometry.shell, geometry.holes);
  const indexedDistance = new IndexedFacetDistance(polygon);
  const indexedLocator = new IndexedPointInAreaLocator(polygon);

  let startPoint = geometryFactory.createPoint(new Coordinate(start.x, start.y));
  if (indexedLocator.locate(startPoint.getCoordinate()) === Location.EXTERIOR) {
    startPoint = geometryFactory.createPoint(
      indexedDistance.nearestPoints(startPoint)[0],
    );
  }
  let endPoint = geometryFactory.createPoint(new Coordinate(end.x, end.y));
  if (indexedLocator.locate(endPoint.getCoordinate()) === Location.EXTERIOR) {
    endPoint = geometryFactory.createPoint(indexedDistance.nearestPoints(endPoint)[0]);
  }

  if (segmentInsidePolygon(polygon, startPoint, endPoint)) {
    return [start, end];
  }

  const open = new MinHeap<SearchNode>((a, b) => a.f - b.f);
  const bestG = new Map<string, number>();
  const visitedPathPoints: Point[] = [startPoint];

  let nextId = 1;
  const initialHeading = angleBetween(startPoint, endPoint);

  const startNode: SearchNode = {
    id: nextId++,
    p: startPoint,
    g: 0,
    f: DistanceOp.distance(startPoint, endPoint),
    heading: initialHeading,
    parent: null,
  };

  open.push(startNode);
  bestG.set(stateKey(startPoint, initialHeading, opt), 0);

  let bestNode: SearchNode = startNode;
  let iterations = 0;

  while (open.size() > 0 && iterations++ < opt.maxIterations) {
    const current = open.pop()!;
    const distToGoal = current.p.distance(endPoint);

    if (distToGoal < bestNode.p.distance(endPoint)) {
      bestNode = current;
    }

    // Try direct connection to goal first
    if (
      distToGoal <= opt.maxStep * 1.5 &&
      segmentInsidePolygon(polygon, current.p, endPoint)
    ) {
      const finalPath = reconstructPath(current);
      finalPath.push(endPoint);
      return finalPath.map((p) => new Vector(p.getX(), p.getY()));
    }

    if (distToGoal <= opt.goalTolerance) {
      const finalPath = reconstructPath(current);
      if (
        finalPath.length === 0 ||
        DistanceOp.distance(finalPath[finalPath.length - 1], end) > 1e-9
      ) {
        finalPath.push(endPoint);
      }
      return finalPath.map((p) => new Vector(p.getX(), p.getY()));
    }

    const clearance = indexedDistance.distance(current.p);
    let step = clamp(clearance * opt.stepScale, opt.minStep, opt.maxStep);

    // In tight spots, allow a smaller emergency step
    if (clearance < opt.minStep * 0.75) {
      step = Math.max(clearance * 0.6, opt.minStep * 0.35);
    }

    const candidateHeadings = generateCandidateHeadings(
      current.heading,
      angleBetween(current.p, endPoint),
      opt.angleStepDeg,
      opt.samplesPerExpansion,
    );

    for (const heading of candidateHeadings) {
      const q = geometryFactory.createPoint(
        new Coordinate(
          current.p.getX() + Math.cos(heading) * step,
          current.p.getY() + Math.sin(heading) * step,
        ),
      );

      if (indexedLocator.locate(q.getCoordinate()) === Location.EXTERIOR) continue;
      // if (!segmentInsidePolygon(polygon, current.p, q)) {
      //   console.log("test")
      //   continue;
      // }

      const edgeEval = evaluateEdge(current.p, q, indexedDistance, opt);

      if (!edgeEval.valid) continue;

      const g2 = current.g + edgeEval.cost;
      const h2 = DistanceOp.distance(q, endPoint);
      const f2 = g2 + h2;

      const key = stateKey(q, heading, opt);
      const prevBest = bestG.get(key);
      if (prevBest !== undefined && prevBest <= g2) continue;

      bestG.set(key, g2);

      const child: SearchNode = {
        id: nextId++,
        p: q,
        g: g2,
        f: f2,
        heading,
        parent: current,
      };

      open.push(child);
    }

    // Keep a coarse memory of explored path area to discourage loops.
    if (iterations % 8 === 0) {
      visitedPathPoints.push(current.p);
    }
  }

  // if (iterations === opt.maxIterations) console.log("max iterations reached");
  console.log('iterations: ', iterations);

  // Return best-so-far path if we got close enough to connect.
  if (bestNode && segmentInsidePolygon(polygon, bestNode.p, endPoint)) {
    const partial = reconstructPath(bestNode);
    partial.push(endPoint);
    return partial.map((p) => new Vector(p.getX(), p.getY()));
  }

  return null;
}

/* =========================
   Edge evaluation / scoring
   ========================= */

function evaluateEdge(
  a: Point,
  b: Point,
  indexedDistance: IndexedFacetDistance,
  opt: Required<LazyAStarOptions>,
): { valid: boolean; cost: number } {
  const len = DistanceOp.distance(a, b);

  let lineString = geometryFactory.createLineString([
    a.getCoordinate(),
    b.getCoordinate(),
  ]);
  let minClearance = indexedDistance.distance(lineString);
  let penalty = 1 / (1e-6 + minClearance * minClearance);

  const cost = len * (1 + opt.lambdaClearance * penalty);

  if (minClearance <= 1e-8) {
    return { valid: false, cost: Infinity };
  }

  return { valid: true, cost };
}

/* =========================
   Candidate heading sampling
   ========================= */

function generateCandidateHeadings(
  currentHeading: number,
  goalHeading: number,
  angleStepDeg: number,
  maxCount: number,
): number[] {
  const step = (angleStepDeg * Math.PI) / 180;
  const out: number[] = [];
  const used = new Set<number>();

  const push = (ang: number) => {
    const a = normalizeAngle(ang);
    const k = Math.round(a * 1e6);
    if (!used.has(k)) {
      used.add(k);
      out.push(a);
    }
  };

  // First prioritize directions around the goal heading.
  push(goalHeading);

  for (let i = 1; out.length < maxCount / 2; i++) {
    push(goalHeading + i * step);
    if (out.length >= maxCount / 2) break;
    push(goalHeading - i * step);
  }

  // Then directions around current heading for smoothness.
  push(currentHeading);
  for (let i = 1; out.length < maxCount; i++) {
    push(currentHeading + i * step);
    if (out.length >= maxCount) break;
    push(currentHeading - i * step);
  }

  return out.slice(0, maxCount);
}

/* =========================
   Geometry helpers
   ========================= */

function segmentInsidePolygon(polygon: Polygon, a: Point, b: Point): boolean {
  return polygon.covers(
    geometryFactory.createLineString([a.getCoordinate(), b.getCoordinate()]),
  );
}

/* =========================
   Path cleanup
   ========================= */

function reconstructPath(node: SearchNode): Point[] {
  const out: Point[] = [];
  let cur: SearchNode | null = node;
  while (cur) {
    out.push(cur.p);
    cur = cur.parent;
  }
  out.reverse();
  return out;
}

function stateKey(p: Point, heading: number, opt: Required<LazyAStarOptions>): string {
  const q = opt.stateQuantization;
  const x = Math.round(p.getX() / q);
  const y = Math.round(p.getY() / q);
  const hb =
    Math.round((normalizeAngle(heading) / (2 * Math.PI)) * opt.headingBins) %
    opt.headingBins;
  return `${x},${y},${hb}`;
}

function angleBetween(a: Point, b: Point): number {
  return Math.atan2(b.getY() - a.getY(), b.getX() - a.getX());
}

function normalizeAngle(a: number): number {
  while (a < 0) a += 2 * Math.PI;
  while (a >= 2 * Math.PI) a -= 2 * Math.PI;
  return a;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/* =========================
   Tiny binary min heap
   ========================= */

class MinHeap<T> {
  private data: T[] = [];
  constructor(private compare: (a: T, b: T) => number) {}

  size(): number {
    return this.data.length;
  }

  push(item: T): void {
    this.data.push(item);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): T | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.compare(this.data[i], this.data[p]) >= 0) break;
      [this.data[i], this.data[p]] = [this.data[p], this.data[i]];
      i = p;
    }
  }

  private bubbleDown(i: number): void {
    const n = this.data.length;
    while (true) {
      let m = i;
      const l = i * 2 + 1;
      const r = i * 2 + 2;
      if (l < n && this.compare(this.data[l], this.data[m]) < 0) m = l;
      if (r < n && this.compare(this.data[r], this.data[m]) < 0) m = r;
      if (m === i) break;
      [this.data[i], this.data[m]] = [this.data[m], this.data[i]];
      i = m;
    }
  }
}
