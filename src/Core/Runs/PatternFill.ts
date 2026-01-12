import { Vector } from '../../Math/Vector';
import { Stitch } from '../Stitch';
import {
  GeometryFactory,
  Coordinate,
  Polygon,
  Envelope,
  LineString,
  LinearRing,
} from 'jsts/org/locationtech/jts/geom';
import { AffineTransformation } from 'jsts/org/locationtech/jts/geom/util';
import Orientation from 'jsts/org/locationtech/jts/algorithm/Orientation';
import { TopologyPreservingSimplifier } from 'jsts/org/locationtech/jts/simplify';
import {
  LocationIndexedLine,
  LengthIndexedLine,
  LengthLocationMap,
  LinearLocation,
} from 'jsts/org/locationtech/jts/linearref';
import { Centroid } from 'jsts/org/locationtech/jts/algorithm';
import { IRun } from '../IRun';
import { geometryFactory } from '../../util/jsts';

interface BoundaryProjection {
  shapeIndex: number;
  locationIndex: LinearLocation;
  coordinate: Coordinate;
}

interface Hatch {
  rowIndex: number;
  hatchIndex: number;
  geom: LineString;
  startProj: BoundaryProjection;
  endProj: BoundaryProjection;
  cellIndex: number | undefined;
}

const eps = 1e-7;

export class PatternFill implements IRun {
  polygon: Polygon;
  boundaryData: {
    ring: LinearRing;
    lengthIndex: LengthIndexedLine;
    locationIndex: LocationIndexedLine;
    lengthLocationMap: LengthLocationMap;
  }[];
  centroid: Coordinate;
  angle: number;
  startPosition: Coordinate;
  endPosition: Coordinate;
  rowSpacingMm: number;
  travelSpacingMm: number;
  stitchPattern: { rowOffsetMm: number; rowPatternMm: number[] }[];
  patternCenter: Coordinate;
  envelope: Envelope;

  constructor(
    shape: Vector[][],
    options?: {
      angle?: number;
      startPosition?: Vector;
      endPosition?: Vector;
      rowSpacingMm?: number;
      travelSpacingMm?: number;
      stitchPattern?: {
        rowOffsetMm: number;
        rowPatternMm: number[];
      }[];
      patternCenter?: Vector;
    },
  ) {
    this.polygon = this.createPolygon(shape);
    // this.centroid = this.polygon.getCentroid().getCoordinate();
    this.centroid = Centroid.getCentroid(this.polygon);
    this.angle = (options?.angle ?? 0) % Math.PI;
    // this.polygon = this.translate(this.polygon, -this.centroid.x, -this.centroid.y);
    // this.polygon = this.rotate(this.polygon, this.angle);
    this.boundaryData = this.getBoundaryData();
    [this.startPosition, this.endPosition] = this.getStartAndEndPositions(
      options?.startPosition,
      options?.endPosition,
    );
    this.rowSpacingMm = options?.rowSpacingMm ?? 0.25;
    this.travelSpacingMm = options?.travelSpacingMm ?? 3;
    this.stitchPattern = options?.stitchPattern ?? [
      { rowOffsetMm: 0, rowPatternMm: [2] },
      { rowOffsetMm: 0.33 * 2, rowPatternMm: [2] },
      { rowOffsetMm: 0.66 * 2, rowPatternMm: [2] },
    ];
    this.patternCenter = options?.patternCenter
      ? new Coordinate(options.patternCenter.x, options.patternCenter.y)
      : this.centroid;
    this.envelope = this.polygon.getEnvelopeInternal();
  }

  getBCD() {
    return computeBCD_JSTS(
      this.polygon,
      {
        dx: Math.cos(this.angle + 0.5 * Math.PI),
        dy: Math.sin(this.angle + 0.5 * Math.PI),
      },
      geometryFactory,
    );
  }

  getTrapezoids(polygon: Polygon) {
    return trapezoidalDecompositionMonotoneAngle(polygon.getCoordinates(), this.angle);
    // const centroid = polygon.getCentroid().getCoordinate();
    // const trapezoids = trapezoidalDecompositionMonotone(this.rotate(polygon, -this.angle, centroid).getCoordinates());
  }

  translate(g: Polygon | Coordinate, tx: number, ty: number) {
    return AffineTransformation.translationInstance(tx, ty).transform(g);
  }

  rotate(
    g: Polygon | Point,
    angle: number,
    center: Coordinate = new Coordinate(0, 0),
  ) {
    return AffineTransformation.rotationInstance(angle, center.x, center.y).transform(g);
  }

  getStartAndEndPositions(
    startPosition: Vector | undefined,
    endPosition: Vector | undefined,
  ): Coordinate[] {
    const start = startPosition
      ? this.rotate(
          this.translate(
            new Coordinate(startPosition.x, startPosition.y),
            -this.centroid.x,
            -this.centroid.y,
          ),
          this.angle,
        )
      : undefined;
    const end = endPosition
      ? this.rotate(
          this.translate(
            new Coordinate(endPosition.x, endPosition.y),
            -this.centroid.x,
            -this.centroid.y,
          ),
          this.angle,
        )
      : undefined;
    if (start && end) return [start, end];
    if (start) return [start, start];
    if (end) return [end, end];
    const p = this.polygon.getExteriorRing().getCoordinateN(0);
    return [p, p];
  }

  createPolygon(rings: Vector[][]): Polygon {
    if (!rings || rings?.length < 1) {
      console.log('PatternFill: Expected at least one ring...');
      return geometryFactory.createPolygon();
    }
    // helper functions
    function toCoords(arr: Vector[]) {
      return arr.map((p) => new Coordinate(p.x, p.y));
    }
    function coordsEqual(a: Coordinate, b: Coordinate) {
      return a.x === b.x && a.y === b.y;
    }
    function closeRing(coords: Coordinate[]) {
      if (coords.length === 0) return coords;
      const [first, last] = [coords[0], coords[coords.length - 1]];
      if (!coordsEqual(first, last)) coords.push(new Coordinate(first.x, first.y));
      return coords;
    }
    function dedupeConsecutive(coords: Coordinate[]) {
      if (coords.length === 0) return coords;
      const out = [coords[0]];
      for (let i = 1; i < coords.length; i++) {
        if (!coordsEqual(coords[i], out[out.length - 1])) out.push(coords[i]);
      }
      return out;
    }
    function ensureMinRing(coords: Coordinate[]) {
      const closed = closeRing(dedupeConsecutive(coords));
      if (closed.length < 4)
        throw new Error('Ring has fewer than 4 coordinates after cleaning.');
      return closed;
    }
    function ringToLinearRingEnsureOrientation(xyArray: Vector[], wantCCW: boolean) {
      let coords = ensureMinRing(toCoords(xyArray));
      const isCCW = Orientation.isCCW(coords);
      if (wantCCW !== isCCW) coords = coords.slice().reverse();
      return geometryFactory.createLinearRing(coords);
    }
    const shell = ringToLinearRingEnsureOrientation(rings[0], true);
    const holes = [];
    for (let i = 1; i < rings.length; i++) {
      const ring = rings[i];
      if (!ring || ring.length === 0) continue;
      holes.push(ringToLinearRingEnsureOrientation(ring, false));
    }
    const polygon = geometryFactory.createPolygon(shell, holes ?? null);
    return TopologyPreservingSimplifier.simplify(polygon, 0.01);
  }

  getBoundaryData(): {
    ring: LinearRing;
    lengthIndex: LengthIndexedLine;
    locationIndex: LocationIndexedLine;
    lengthLocationMap: LengthLocationMap;
  }[] {
    let ring = this.polygon.getExteriorRing();
    const boundaryData = [
      {
        ring,
        lengthIndex: new LengthIndexedLine(ring),
        locationIndex: new LocationIndexedLine(ring),
        lengthLocationMap: new LengthLocationMap(ring),
      },
    ];
    for (let i = 0; i < this.polygon.getNumInteriorRing(); i++) {
      ring = this.polygon.getInteriorRingN(i);
      boundaryData.push({
        ring,
        lengthIndex: new LengthIndexedLine(ring),
        locationIndex: new LocationIndexedLine(ring),
        lengthLocationMap: new LengthLocationMap(ring),
      });
    }
    return boundaryData;
  }

  getStitches(pixelsPerMm: number): Stitch[] {
    const stitches: Stitch[] = [];
    // const extremes = this.getExtremes();
    // const nodedBoundaries = this.getNodedBoundaries(extremes);
    // const { nodes, adjacency } = this.buildPSG(extremes, nodedBoundaries);
    // const faces: Polygon[] = this.getFacesFromGraph(nodes, adjacency);
    return stitches;
  }
}

// bcd_jsts.ts
//
// Brute-Cell Decomposition (BCD) for a Polygon with holes,
// adapted from polygon_coverage_planning::computeBCD (bcd.cc)
// to use JSTS geometries.
//
// Usage:
//   import { geom } from 'jsts';
//   const gf = new geom.GeometryFactory();
//   const cells = computeBCD_JSTS(polygon, { dx: 1, dy: 0 }, gf);
//
// Assumptions:
// - polygon is a valid jsts.geom.Polygon (outer + holes).
// - Rings are standard JTS/JSTS rings (first == last coordinate).
// - Direction2 is a simple vector specifying sweep direction.

import { geom } from 'jsts';

interface Direction2 {
  dx: number;
  dy: number;
}

// Internal representation of polygon-with-holes using JSTS coordinates
interface PolygonWithHoles {
  outer: Coordinate[];
  holes: Coordinate[][];
}

interface VertexRef {
  ring: 'outer' | 'hole';
  holeIndex?: number;
  index: number; // index into ring *excluding* closing duplicate
}

interface Segment2 {
  source: Coordinate;
  target: Coordinate;
}

const EPS = 1e-9;

function almostEqual(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps;
}

function pointsEqual(a: Coordinate, b: Coordinate, eps = EPS): boolean {
  return almostEqual(a.x, b.x, eps) && almostEqual(a.y, b.y, eps);
}

function equalX(a: Coordinate, b: Coordinate, eps = EPS): boolean {
  return almostEqual(a.x, b.x, eps);
}

function lessX(a: Coordinate, b: Coordinate): boolean {
  if (!almostEqual(a.x, b.x)) return a.x < b.x;
  return a.y < b.y;
}

function lessY(a: Coordinate, b: Coordinate): boolean {
  if (!almostEqual(a.y, b.y)) return a.y < b.y;
  return a.x < b.x;
}

function cloneCoord(p: Coordinate): Coordinate {
  return new Coordinate(p.x, p.y);
}

function clonePolygonCoords(poly: Coordinate[]): Coordinate[] {
  return poly.map(cloneCoord);
}

// Signed area
function polygonSignedArea(poly: Coordinate[]): number {
  let sum = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    sum += p.x * q.y - q.x * p.y;
  }
  return 0.5 * sum;
}

function isClockwise(poly: Coordinate[]): boolean {
  return polygonSignedArea(poly) < 0;
}

// Basic segment intersection for simplicity checks
function segmentsIntersectProper(a: Segment2, b: Segment2): boolean {
  const p1 = a.source;
  const p2 = a.target;
  const p3 = b.source;
  const p4 = b.target;

  function orient(o: Coordinate, p: Coordinate, q: Coordinate): number {
    return (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  }

  function onSegment(o: Coordinate, p: Coordinate, q: Coordinate): boolean {
    return (
      Math.min(o.x, q.x) - EPS <= p.x &&
      p.x <= Math.max(o.x, q.x) + EPS &&
      Math.min(o.y, q.y) - EPS <= p.y &&
      p.y <= Math.max(o.y, q.y) + EPS &&
      almostEqual(orient(o, p, q), 0)
    );
  }

  const o1 = orient(p1, p2, p3);
  const o2 = orient(p1, p2, p4);
  const o3 = orient(p3, p4, p1);
  const o4 = orient(p3, p4, p2);

  if (o1 * o2 < 0 && o3 * o4 < 0) return true;

  if (almostEqual(o1, 0) && onSegment(p1, p3, p2)) return true;
  if (almostEqual(o2, 0) && onSegment(p1, p4, p2)) return true;
  if (almostEqual(o3, 0) && onSegment(p3, p1, p4)) return true;
  if (almostEqual(o4, 0) && onSegment(p3, p2, p4)) return true;

  return false;
}

function polygonIsSimple(poly: Coordinate[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  const edges: Segment2[] = [];
  for (let i = 0; i < n; i++) {
    edges.push({ source: poly[i], target: poly[(i + 1) % n] });
  }
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (j === i + 1 || (i === 0 && j === edges.length - 1)) continue;
      if (segmentsIntersectProper(edges[i], edges[j])) return false;
    }
  }
  return true;
}

// Ray casting
function pointInPolygon(poly: Coordinate[], p: Coordinate): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = poly[i];
    const pj = poly[j];

    const intersect =
      pi.y > p.y !== pj.y > p.y &&
      p.x <
        ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y + (pj.y === pi.y ? EPS : 0)) + pi.x;

    if (intersect) inside = !inside;
  }
  return inside;
}

function segmentHasOnPositiveSide(seg: Segment2, p: Coordinate): boolean {
  const dirX = seg.target.x - seg.source.x;
  const dirY = seg.target.y - seg.source.y;
  const vx = p.x - seg.source.x;
  const vy = p.y - seg.source.y;
  const cross = dirX * vy - dirY * vx;
  return cross > 0;
}

// Rotation: align direction to +x, and invert later
function rotateCoordByDir(p: Coordinate, dir: Direction2, invert = false): Coordinate {
  const len = Math.hypot(dir.dx, dir.dy);
  if (len < EPS) return cloneCoord(p);
  const cosTheta = dir.dx / len;
  const sinTheta = dir.dy / len;

  if (!invert) {
    // rotate by -theta
    return new Coordinate(
      p.x * cosTheta + p.y * sinTheta,
      -p.x * sinTheta + p.y * cosTheta,
    );
  } else {
    // rotate by +theta
    return new Coordinate(
      p.x * cosTheta - p.y * sinTheta,
      p.x * sinTheta + p.y * cosTheta,
    );
  }
}

function rotatePolygonWithHoles(
  pwh: PolygonWithHoles,
  dir: Direction2,
  invert = false,
): PolygonWithHoles {
  return {
    outer: pwh.outer.map((p) => rotateCoordByDir(p, dir, invert)),
    holes: pwh.holes.map((hole) => hole.map((p) => rotateCoordByDir(p, dir, invert))),
  };
}

function rotatePolygonBack(poly: Coordinate[], dir: Direction2): Coordinate[] {
  return poly.map((p) => rotateCoordByDir(p, dir, true));
}

// Segment helpers
function segmentFromCoords(a: Coordinate, b: Coordinate): Segment2 {
  return { source: cloneCoord(a), target: cloneCoord(b) };
}

function segmentsEqual(a: Segment2, b: Segment2, eps = EPS): boolean {
  return pointsEqual(a.source, b.source, eps) && pointsEqual(a.target, b.target, eps);
}

function segmentsEqualIgnoringOrientation(a: Segment2, b: Segment2, eps = EPS): boolean {
  return (
    segmentsEqual(a, b, eps) ||
    (pointsEqual(a.source, b.target, eps) && pointsEqual(a.target, b.source, eps))
  );
}

// Convert JSTS Polygon -> PolygonWithHoles (without duplicated closing coord)
function jstsPolygonToPwh(poly: Polygon): PolygonWithHoles {
  const outerRing = poly.getExteriorRing();
  const outer: Coordinate[] = [];
  const outerCount = outerRing.getNumPoints() - 1; // skip duplicate last
  for (let i = 0; i < outerCount; i++) {
    const c = outerRing.getCoordinateN(i);
    outer.push(new Coordinate(c.x, c.y));
  }

  const holes: Coordinate[][] = [];
  const numHoles = poly.getNumInteriorRing();
  for (let h = 0; h < numHoles; h++) {
    const ring = poly.getInteriorRingN(h);
    const ringCoords: Coordinate[] = [];
    const cnt = ring.getNumPoints() - 1;
    for (let i = 0; i < cnt; i++) {
      const c = ring.getCoordinateN(i);
      ringCoords.push(new Coordinate(c.x, c.y));
    }
    holes.push(ringCoords);
  }

  return { outer, holes };
}

// Convert Coordinate[] (open ring) -> JSTS Polygon (closed ring)
function coordsToJstsPolygon(coords: Coordinate[], gf: GeometryFactory): Polygon | null {
  if (coords.length < 3) return null;
  const closed: Coordinate[] = coords.map(cloneCoord);
  const first = closed[0];
  const last = closed[closed.length - 1];
  if (!pointsEqual(first, last)) {
    closed.push(cloneCoord(first));
  }
  const shell = gf.createLinearRing(closed);
  return gf.createPolygon(shell);
}

// PWH utilities with VertexRef

function getPoint(pwh: PolygonWithHoles, v: VertexRef): Coordinate {
  if (v.ring === 'outer') {
    return pwh.outer[v.index];
  } else {
    if (v.holeIndex == null) throw new Error('holeIndex missing for hole vertex');
    return pwh.holes[v.holeIndex][v.index];
  }
}

function numVerticesInRing(pwh: PolygonWithHoles, v: VertexRef): number {
  return v.ring === 'outer' ? pwh.outer.length : pwh.holes[v.holeIndex!].length;
}

function prevVertexRef(pwh: PolygonWithHoles, v: VertexRef): VertexRef {
  const n = numVerticesInRing(pwh, v);
  const idx = (v.index - 1 + n) % n;
  return { ...v, index: idx };
}

function nextVertexRef(pwh: PolygonWithHoles, v: VertexRef): VertexRef {
  const n = numVerticesInRing(pwh, v);
  const idx = (v.index + 1) % n;
  return { ...v, index: idx };
}

function verticesEqualRef(a: VertexRef, b: VertexRef): boolean {
  return (
    a.ring === b.ring &&
    a.index === b.index &&
    (a.ring === 'outer' || a.holeIndex === b.holeIndex)
  );
}

// sortPolygon: outer CCW, holes CW
function sortPolygon(pwh: PolygonWithHoles): void {
  if (isClockwise(pwh.outer)) {
    pwh.outer.reverse();
  }
  for (const hole of pwh.holes) {
    if (!isClockwise(hole)) {
      hole.reverse();
    }
  }
}

// cleanupPolygon: drop duplicate consecutive vertices, then simple + non-zero area
function cleanupPolygon(poly: Coordinate[]): boolean {
  if (poly.length === 0) return false;

  let eraseOne = true;
  while (eraseOne && poly.length > 1) {
    eraseOne = false;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (pointsEqual(poly[i], poly[j])) {
        poly.splice(j, 1);
        eraseOne = true;
        break;
      }
    }
  }

  const area = polygonSignedArea(poly);
  if (almostEqual(area, 0)) return false;
  if (!polygonIsSimple(poly)) return false;
  return true;
}

// outOfPWH: outside outer OR inside a hole
function outOfPWH(pwh: PolygonWithHoles, p: Coordinate): boolean {
  if (!pointInPolygon(pwh.outer, p)) return true;
  for (const hole of pwh.holes) {
    if (pointInPolygon(hole, p)) return true;
  }
  return false;
}

// Placeholder for simplification.
function simplifyPolygon(_pwh: PolygonWithHoles): void {
  // no-op; hook for your own simplification
}

// Sorting vertices by x,y
function getXSortedVertices(p: PolygonWithHoles): VertexRef[] {
  const sorted: VertexRef[] = [];

  for (let i = 0; i < p.outer.length; i++) {
    sorted.push({ ring: 'outer', index: i });
  }

  for (let h = 0; h < p.holes.length; h++) {
    const hole = p.holes[h];
    for (let i = 0; i < hole.length; i++) {
      sorted.push({ ring: 'hole', holeIndex: h, index: i });
    }
  }

  sorted.sort((a, b) => {
    const pa = getPoint(p, a);
    const pb = getPoint(p, b);
    if (!almostEqual(pa.x, pb.x)) return pa.x - pb.x;
    return pa.y - pb.y;
  });

  return sorted;
}

// Intersections between vertical line x = x0 and segments in L
function intersectSegmentWithVerticalLine(seg: Segment2, x0: number): Coordinate | null {
  const a = seg.source;
  const b = seg.target;

  if (almostEqual(a.x, b.x) && almostEqual(a.x, x0)) {
    return cloneCoord(b);
  }

  if (almostEqual(a.x, b.x)) {
    return null;
  }

  const minX = Math.min(a.x, b.x) - EPS;
  const maxX = Math.max(a.x, b.x) + EPS;
  if (x0 < minX || x0 > maxX) return null;

  const t = (x0 - a.x) / (b.x - a.x);
  if (t < -EPS || t > 1 + EPS) return null;

  const y = a.y + t * (b.y - a.y);
  return new Coordinate(x0, y);
}

function getIntersections(L: Segment2[], x0: number): Coordinate[] {
  const intersections: Coordinate[] = [];
  for (const seg of L) {
    const res = intersectSegmentWithVerticalLine(seg, x0);
    if (!res) {
      console.warn('No intersection found for segment with vertical line');
      intersections.push(cloneCoord(seg.target));
    } else {
      intersections.push(res);
    }
  }
  return intersections;
}

// === processEvent ===
// This is a mostly 1:1 port of the previous TS version, with Coordinates/JSTS types.

function processEvent(
  pwh: PolygonWithHoles,
  v: VertexRef,
  sortedVertices: VertexRef[],
  processedVertices: Coordinate[],
  L: Segment2[],
  openPolygons: Coordinate[][],
  closedPolygons: Coordinate[][],
): void {
  const vPoint = getPoint(pwh, v);
  const intersections = getIntersections(L, vPoint.x);

  // e_prev/e_next from v to neighbors on ring
  let vPrev = prevVertexRef(pwh, v);
  let vNext = nextVertexRef(pwh, v);
  let e_prev: Segment2 = segmentFromCoords(vPoint, getPoint(pwh, vPrev));
  let e_next: Segment2 = segmentFromCoords(vPoint, getPoint(pwh, vNext));

  // Correct vertical edges
  if (equalX(e_prev.source, e_prev.target)) {
    const vPrev2 = prevVertexRef(pwh, vPrev);
    e_prev = segmentFromCoords(getPoint(pwh, vPrev), getPoint(pwh, vPrev2));
  } else if (equalX(e_next.source, e_next.target)) {
    const vNext2 = nextVertexRef(pwh, vNext);
    e_next = segmentFromCoords(getPoint(pwh, vNext), getPoint(pwh, vNext2));
  }

  let e_lower: Segment2 = { ...e_prev };
  let e_upper: Segment2 = { ...e_next };

  // OUT event
  if (lessX(e_prev.target, e_prev.source) && lessX(e_next.target, e_next.source)) {
    const p_on_upper = pointsEqual(e_lower.source, e_upper.source)
      ? e_upper.target
      : e_upper.source;
    if (segmentHasOnPositiveSide(e_lower, p_on_upper)) {
      const tmp = e_lower;
      e_lower = e_upper;
      e_upper = tmp;
    }

    const epsPoint = new Coordinate(vPoint.x + 1e-6, vPoint.y);
    const close_one = outOfPWH(pwh, epsPoint);

    let e_lower_id = -1;
    for (let i = 0; i < L.length; i++) {
      if (segmentsEqualIgnoringOrientation(L[i], e_lower)) {
        e_lower_id = i;
        break;
      }
    }
    if (e_lower_id < 0) throw new Error('e_lower not found in L');
    const e_upper_id = e_lower_id + 1;
    const lower_cell_id = Math.floor(e_lower_id / 2);
    const upper_cell_id = Math.floor(e_upper_id / 2);

    if (close_one) {
      const cellIndex = lower_cell_id;
      const cell = openPolygons[cellIndex];
      cell.push(cloneCoord(e_lower.source));
      if (!pointsEqual(e_lower.source, e_upper.source)) {
        cell.push(cloneCoord(e_upper.source));
      }

      if (cleanupPolygon(cell)) {
        closedPolygons.push(clonePolygonCoords(cell));
      }

      L.splice(e_upper_id, 1);
      L.splice(e_lower_id, 1);
      openPolygons.splice(cellIndex, 1);
    } else {
      if (intersections.length <= e_upper_id + 1) {
        throw new Error('Not enough intersections for close_two branch');
      }

      const lower_cell = openPolygons[lower_cell_id];
      const upper_cell = openPolygons[upper_cell_id];

      lower_cell.push(cloneCoord(intersections[e_lower_id - 1]));
      lower_cell.push(cloneCoord(intersections[e_lower_id]));
      if (cleanupPolygon(lower_cell)) {
        closedPolygons.push(clonePolygonCoords(lower_cell));
      }

      upper_cell.push(cloneCoord(intersections[e_upper_id]));
      upper_cell.push(cloneCoord(intersections[e_upper_id + 1]));
      if (cleanupPolygon(upper_cell)) {
        closedPolygons.push(clonePolygonCoords(upper_cell));
      }

      L.splice(e_upper_id, 1);
      L.splice(e_lower_id, 1);

      const newPolygon: Coordinate[] = [];
      newPolygon.push(cloneCoord(intersections[e_upper_id + 1]));
      newPolygon.push(cloneCoord(intersections[e_lower_id - 1]));
      openPolygons.splice(lower_cell_id, 0, newPolygon);

      const removeIndices = [lower_cell_id + 1, upper_cell_id + 1].sort((a, b) => b - a);
      for (const idx of removeIndices) {
        openPolygons.splice(idx, 1);
      }
    }

    processedVertices.push(cloneCoord(e_lower.source));
    if (!pointsEqual(e_lower.source, e_upper.source)) {
      processedVertices.push(cloneCoord(e_upper.source));
    }
  }

  // IN event
  else if (
    !lessX(e_lower.target, e_lower.source) &&
    !lessX(e_upper.target, e_upper.source)
  ) {
    const p_on_lower = pointsEqual(e_lower.source, e_upper.source)
      ? e_lower.target
      : e_lower.source;
    if (segmentHasOnPositiveSide(e_upper, p_on_lower)) {
      const tmp = e_lower;
      e_lower = e_upper;
      e_upper = tmp;
    }

    const epsPoint = new Coordinate(vPoint.x - 1e-6, vPoint.y);
    const open_one = outOfPWH(pwh, epsPoint);

    let e_LOWER_id = 0;
    let found_e_lower_id = false;
    if (intersections.length >= 2) {
      for (let i = 0; i < intersections.length - 1; i += 2) {
        if (open_one) {
          if (
            lessY(intersections[i], e_lower.source) &&
            lessY(intersections[i + 1], e_upper.source)
          ) {
            e_LOWER_id = i;
            found_e_lower_id = true;
          }
        } else {
          if (
            lessY(intersections[i], e_lower.source) &&
            lessY(e_upper.source, intersections[i + 1])
          ) {
            e_LOWER_id = i;
          }
        }
      }
    }

    if (open_one) {
      let openCellIndex = 0;
      if (L.length > 0 && found_e_lower_id) {
        openCellIndex = Math.floor(e_LOWER_id / 2) + 1;
      }

      if (L.length === 0) {
        L.push({ ...e_lower }, { ...e_upper });
      } else if (L.length > 0 && !found_e_lower_id) {
        L.unshift({ ...e_upper });
        L.unshift({ ...e_lower });
      } else {
        const inserterIndex = e_LOWER_id + 1;
        L.splice(inserterIndex + 1, 0, { ...e_lower }, { ...e_upper });
      }

      const openPolygon: Coordinate[] = [];
      openPolygon.push(cloneCoord(e_upper.source));
      if (!pointsEqual(e_lower.source, e_upper.source)) {
        openPolygon.push(cloneCoord(e_lower.source));
      }
      openPolygons.splice(openCellIndex, 0, openPolygon);
    } else {
      const e_LOWER = L[e_LOWER_id];
      if (!e_LOWER) throw new Error('e_LOWER not found in L');
      const cellIndex = Math.floor(e_LOWER_id / 2);
      const cell = openPolygons[cellIndex];
      if (!cell) throw new Error('Cell not found in openPolygons');

      L.splice(e_LOWER_id + 1, 0, { ...e_lower }, { ...e_upper });

      cell.push(cloneCoord(intersections[e_LOWER_id]));
      cell.push(cloneCoord(intersections[e_LOWER_id + 1]));
      if (cleanupPolygon(cell)) {
        closedPolygons.push(clonePolygonCoords(cell));
      }

      const newPolygonLower: Coordinate[] = [];
      newPolygonLower.push(cloneCoord(e_lower.source));
      newPolygonLower.push(cloneCoord(intersections[e_LOWER_id]));

      const newPolygonUpper: Coordinate[] = [];
      newPolygonUpper.push(cloneCoord(intersections[e_LOWER_id + 1]));
      newPolygonUpper.push(cloneCoord(e_upper.source));

      openPolygons.splice(cellIndex, 1, newPolygonUpper);
      openPolygons.splice(cellIndex, 0, newPolygonLower);
    }

    processedVertices.push(cloneCoord(e_lower.source));
    if (!pointsEqual(e_lower.source, e_upper.source)) {
      processedVertices.push(cloneCoord(e_upper.source));
    }
  }

  // Degenerate / vertical / special cases
  else {
    let v_middle: VertexRef = { ...v };
    let foundEdgeIndex = -1;

    while (foundEdgeIndex === -1) {
      for (let i = 0; i < L.length; i++) {
        const seg = L[i];
        if (
          pointsEqual(getPoint(pwh, v_middle), seg.source) ||
          pointsEqual(getPoint(pwh, v_middle), seg.target)
        ) {
          foundEdgeIndex = i;

          if (!pointsEqual(getPoint(pwh, v_middle), vPoint)) {
            let i_v = -1;
            let i_v_middle = -1;
            for (let k = 0; k < sortedVertices.length; k++) {
              if (verticesEqualRef(sortedVertices[k], v)) i_v = k;
              if (verticesEqualRef(sortedVertices[k], v_middle)) i_v_middle = k;
            }
            if (i_v === -1 || i_v_middle === -1) {
              throw new Error('Vertices not found in sortedVertices');
            }
            const tmp = sortedVertices[i_v];
            sortedVertices[i_v] = sortedVertices[i_v_middle];
            sortedVertices[i_v_middle] = tmp;
          }
          break;
        }
      }

      if (foundEdgeIndex === -1) {
        const v_prev_m = prevVertexRef(pwh, v_middle);
        const v_next_m = nextVertexRef(pwh, v_middle);
        const p_prev = getPoint(pwh, v_prev_m);
        const p_next = getPoint(pwh, v_next_m);
        const p_mid = getPoint(pwh, v_middle);

        if (!almostEqual(p_prev.x, p_mid.x) && !almostEqual(p_next.x, p_mid.x)) {
          throw new Error('Unexpected configuration for v_middle chain');
        }
        if (almostEqual(p_prev.x, p_mid.x)) {
          v_middle = v_prev_m;
        } else {
          v_middle = v_next_m;
        }
      }
    }

    const p_middle = getPoint(pwh, v_middle);
    const p_prev_m = getPoint(pwh, prevVertexRef(pwh, v_middle));
    const p_next_m = getPoint(pwh, nextVertexRef(pwh, v_middle));

    const e_prev_m = segmentFromCoords(p_middle, p_prev_m);
    const e_next_m = segmentFromCoords(p_middle, p_next_m);

    let edge_id = -1;
    let new_edge: Segment2 | null = null;
    for (let i = 0; i < L.length; i++) {
      const seg = L[i];
      if (segmentsEqualIgnoringOrientation(seg, e_next_m)) {
        new_edge = e_prev_m;
        edge_id = i;
        break;
      } else if (segmentsEqualIgnoringOrientation(seg, e_prev_m)) {
        new_edge = e_next_m;
        edge_id = i;
        break;
      }
    }

    if (edge_id === -1 || !new_edge) {
      throw new Error('Old edge not found in L during degenerate branch');
    }

    const cell_id = Math.floor(edge_id / 2);
    const cell = openPolygons[cell_id];
    if (!cell) throw new Error('Cell not found in degenerate branch');

    if (edge_id % 2 === 0) {
      cell.push(cloneCoord(new_edge.source));
    } else {
      cell.unshift(cloneCoord(new_edge.source));
    }

    L.splice(edge_id, 1, { ...new_edge });

    processedVertices.push(cloneCoord(p_middle));
  }
}

// === Top-level JSTS API ===

export function computeBCD_JSTS(
  polygon_in: Polygon,
  dir: Direction2,
  geometryFactory: GeometryFactory,
): Polygon[] {
  let pwh = jstsPolygonToPwh(polygon_in);

  // Rotate, sort, simplify
  pwh = rotatePolygonWithHoles(pwh, dir, false);
  sortPolygon(pwh);
  simplifyPolygon(pwh);

  const sorted_vertices = getXSortedVertices(pwh);
  const L: Segment2[] = [];
  const open_polygons: Coordinate[][] = [];
  const closed_polygons: Coordinate[][] = [];
  const processed_vertices: Coordinate[] = [];

  for (const v of sorted_vertices) {
    const p = getPoint(pwh, v);
    if (processed_vertices.some((q) => pointsEqual(q, p))) continue;

    processEvent(
      pwh,
      v,
      sorted_vertices,
      processed_vertices,
      L,
      open_polygons,
      closed_polygons,
    );
  }

  // Rotate back and convert to JSTS polygons
  const result: Polygon[] = [];
  for (const polyCoords of closed_polygons) {
    const rotated = rotatePolygonBack(polyCoords, dir);
    if (cleanupPolygon(rotated)) {
      const jstsPoly = coordsToJstsPolygon(rotated, geometryFactory);
      if (jstsPoly) result.push(jstsPoly);
    }
  }

  return result;
}




type Point = { x: number; y: number };

type Trapezoid = {
  top: [Point, Point];     // left → right
  bottom: [Point, Point];  // left → right
};

function rotatePoint(p: Point, angle: number): Point {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: c * p.x - s * p.y,
    y: s * p.x + c * p.y
  };
}

function rotatePolygon(poly: Point[], angle: number): Point[] {
  return poly.map(p => rotatePoint(p, angle));
}

function intersectSegmentWithY(
  a: Point,
  b: Point,
  y: number
): number | null {
  if ((y < a.y && y < b.y) || (y > a.y && y > b.y)) return null;
  if (Math.abs(a.y - b.y) < 1e-9) return null;

  const t = (y - a.y) / (b.y - a.y);
  return a.x + t * (b.x - a.x);
}

function intersectPolygonWithY(
  polygon: Point[],
  y: number
): number[] {
  const xs: number[] = [];
  const n = polygon.length;

  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const x = intersectSegmentWithY(a, b, y);
    if (x !== null) xs.push(x);
  }

  xs.sort((a, b) => a - b);
  return xs;
}

export function trapezoidalDecompositionMonotoneAngle(
  polygon: Point[],
  angle: number
): Trapezoid[] {

  // 1. Rotate polygon so sweep direction becomes vertical
  const rotated = rotatePolygon(polygon, -angle);

  // 2. Collect unique y-levels
  const ys = Array.from(
    new Set(rotated.map(p => p.y))
  ).sort((a, b) => b - a);

  const trapezoids: Trapezoid[] = [];

  for (let i = 0; i < ys.length - 1; i++) {
    const yTop = ys[i];
    const yBot = ys[i + 1];
    if (Math.abs(yTop - yBot) < 1e-9) continue;

    const yMidTop = yTop - 1e-6;
    const yMidBot = yBot + 1e-6;

    const xsTop = intersectPolygonWithY(rotated, yMidTop);
    const xsBot = intersectPolygonWithY(rotated, yMidBot);

    if (xsTop.length !== 2 || xsBot.length !== 2) {
      throw new Error("Polygon is not monotone in given direction");
    }

    const trapRotated: Trapezoid = {
      top: [
        { x: xsTop[0], y: yTop },
        { x: xsTop[1], y: yTop }
      ],
      bottom: [
        { x: xsBot[0], y: yBot },
        { x: xsBot[1], y: yBot }
      ]
    };

    // 3. Rotate trapezoid back
    trapezoids.push({
      top: trapRotated.top.map(p => rotatePoint(p, angle)) as [Point, Point],
      bottom: trapRotated.bottom.map(p => rotatePoint(p, angle)) as [Point, Point]
    });
  }

  return trapezoids;
}
