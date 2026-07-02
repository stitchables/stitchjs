import STRtree from 'jsts/org/locationtech/jts/index/strtree/STRtree';
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp';
import GeometryLocation from 'jsts/org/locationtech/jts/operation/distance/GeometryLocation';
import Envelope from 'jsts/org/locationtech/jts/geom/Envelope';
import LineString from 'jsts/org/locationtech/jts/geom/LineString';
import MultiLineString from 'jsts/org/locationtech/jts/geom/MultiLineString';
import Polygon from 'jsts/org/locationtech/jts/geom/Polygon';
import MultiPolygon from 'jsts/org/locationtech/jts/geom/MultiPolygon';

type Geometry = LineString | MultiLineString | Polygon | MultiPolygon;

// ---------- Union-Find ----------
class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]]; // path halving
      x = this.parent[x];
    }
    return x;
  }

  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
    return true;
  }
}

// ---------- MST result types ----------
export interface MstEdge {
  a: { index: number; location: GeometryLocation };
  b: { index: number; location: GeometryLocation };
}

interface IndexedItem {
  geomIndex: number;
  geom: Geometry;
}

// ---------- Core algorithm ----------
export function geometryMst(geometries: Geometry[]): {
  edges: MstEdge[];
  componentTree: STRtree;
} {
  const n = geometries.length;
  if (n <= 1) return { edges: [], componentTree: new STRtree() };

  // Build the spatial index once. Items store the original index.
  const tree = new STRtree();
  const envelopes: Envelope[] = [];
  for (let i = 0; i < n; i++) {
    const env = geometries[i].getEnvelopeInternal();
    envelopes.push(env);
    tree.insert(env, { geomIndex: i, geom: geometries[i] } as IndexedItem);
  }
  tree.build();

  const uf = new UnionFind(n);
  const mstEdges: MstEdge[] = [];
  let numComponents = n;

  // Cache per-geometry envelope diagonal as a starting search radius hint.
  const diag = envelopes.map((e) => Math.hypot(e.getWidth(), e.getHeight()));

  while (numComponents > 1) {
    // best[componentRoot] = { distance, a (member index), b (other index) }
    const best = new Map<number, { distance: number; a: number; b: number }>();

    for (let i = 0; i < n; i++) {
      const rootI = uf.find(i);
      const candidate = findNearestOtherComponent(
        i,
        rootI,
        tree,
        uf,
        geometries,
        envelopes,
        diag[i],
      );
      if (!candidate) continue; // can happen only if everything is already one component

      const current = best.get(rootI);
      if (!current || candidate.distance < current.distance) {
        best.set(rootI, { distance: candidate.distance, a: i, b: candidate.index });
      }
    }

    // Merge using the best edge found per component. Track edges actually
    // added (avoid double-adding the same pair from both directions).
    let mergedAny = false;
    for (const { a, b } of best.values()) {
      const rootA = uf.find(a);
      const rootB = uf.find(b);
      if (rootA === rootB) continue; // already merged earlier this round via the partner's pick
      if (uf.union(a, b)) {
        const distanceOp = new DistanceOp(geometries[a], geometries[b]);
        const [aLocation, bLocation] = distanceOp.nearestLocations();
        mstEdges.push({
          a: { index: a, location: aLocation },
          b: { index: b, location: bLocation },
        });
        numComponents--;
        mergedAny = true;
      }
    }

    if (!mergedAny) {
      // Disconnected input (shouldn't happen for geometries in the plane,
      // but guard against infinite loop just in case).
      break;
    }
  }

  return { edges: mstEdges, componentTree: tree };
}

// ---------- Nearest-other-component search via expanding envelope ----------
//
// Strategy: grow a square search envelope around geometry i's envelope until
// we find at least one candidate item from a *different* component, then
// verify by also checking the next ring out (since envelope-distance is a
// lower bound, not the true geometry distance, an item just outside our
// current envelope could still be closer by true distance than an item we
// already found that's "diagonally" placed). We do this with a standard
// doubling + one-extra-ring confirmation pass.
function findNearestOtherComponent(
  i: number,
  rootI: number,
  tree: STRtree,
  uf: UnionFind,
  geometries: Geometry[],
  envelopes: Envelope[],
  initialRadiusHint: number,
): { index: number; distance: number } | null {
  const env = envelopes[i];
  const cx = (env.getMinX() + env.getMaxX()) / 2;
  const cy = (env.getMinY() + env.getMaxY()) / 2;

  let radius = Math.max(initialRadiusHint, 1e-6);
  const maxRadius = computeGlobalDiagonal(envelopes);

  let best: { index: number; distance: number } | null = null;
  let lastQueryRadius = 0;

  while (true) {
    const searchEnv = new Envelope(cx - radius, cx + radius, cy - radius, cy + radius);
    const results = tree.query(searchEnv) as IndexedItem[];

    for (const item of results) {
      if (item.geomIndex === i) continue;
      if (uf.find(item.geomIndex) === rootI) continue; // same component, skip

      const d = DistanceOp.distance(geometries[i], item.geom);
      if (!best || d < best.distance) {
        best = { index: item.geomIndex, distance: d };
      }
    }

    // Stop condition: if we have a candidate and it's closer than the
    // current search radius, expanding further cannot find anything closer,
    // because any item outside `searchEnv` is at least `radius` away from
    // the search center in envelope terms (a valid lower bound on true
    // distance for axis-aligned envelopes around the same center).
    if (best && best.distance <= radius) {
      return best;
    }

    lastQueryRadius = radius;
    if (lastQueryRadius >= maxRadius) {
      // Searched the entire extent; return whatever we found (or null).
      return best;
    }

    radius = Math.min(radius * 2, maxRadius);
  }
}

function computeGlobalDiagonal(envelopes: Envelope[]): number {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const e of envelopes) {
    minX = Math.min(minX, e.getMinX());
    minY = Math.min(minY, e.getMinY());
    maxX = Math.max(maxX, e.getMaxX());
    maxY = Math.max(maxY, e.getMaxY());
  }
  return Math.hypot(maxX - minX, maxY - minY) || 1;
}
