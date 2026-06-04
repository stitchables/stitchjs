import { Coordinate, Point, MultiPoint, Polygon } from 'jsts/org/locationtech/jts/geom';
import AffineTransformation from 'jsts/org/locationtech/jts/geom/util/AffineTransformation';
import DouglasPeuckerSimplifier from 'jsts/org/locationtech/jts/simplify/DouglasPeuckerSimplifier';
import { Area, Orientation } from 'jsts/org/locationtech/jts/algorithm';
import * as graphlib from '@dagrejs/graphlib';
import { geometryFactory } from '../util/jsts';

const EPS = 1e-9;
function almostEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS;
}
function pointsEqual(a: Coordinate, b: Coordinate): boolean {
  return almostEqual(a.x, b.x) && almostEqual(a.y, b.y);
}
function equalX(a: Coordinate, b: Coordinate): boolean {
  return almostEqual(a.x, b.x);
}
function lessX(a: Coordinate, b: Coordinate): boolean {
  return !almostEqual(a.x, b.x) ? a.x < b.x : a.y < b.y;
}
function lessY(a: Coordinate, b: Coordinate): boolean {
  return !almostEqual(a.y, b.y) ? a.y < b.y : a.x < b.x;
}

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// ~~~~~~~~~~~~~~~~~ Vertex ~~~~~~~~~~~~~~~~~ //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
interface Vertex {
  ring: 'outer' | 'hole';
  holeIndex?: number;
  index: number; // index into ring *excluding* closing duplicate
}
function prevVertex(polygon: Polygon, v: Vertex): Vertex {
  const n =
    v.ring === 'outer'
      ? polygon.getExteriorRing().getNumPoints() - 1
      : polygon.getInteriorRingN(v.holeIndex).getNumPoints() - 1;
  const idx = (v.index - 1 + n) % n;
  return { ...v, index: idx };
}
function nextVertex(polygon: Polygon, v: Vertex): Vertex {
  const n =
    v.ring === 'outer'
      ? polygon.getExteriorRing().getNumPoints() - 1
      : polygon.getInteriorRingN(v.holeIndex).getNumPoints() - 1;
  const idx = (v.index + 1) % n;
  return { ...v, index: idx };
}
function verticesEqual(a: Vertex, b: Vertex): boolean {
  return (
    a.ring === b.ring &&
    a.index === b.index &&
    (a.ring === 'outer' || a.holeIndex === b.holeIndex)
  );
}

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
// ~~~~~~~~~~~~~~~~~ Segment ~~~~~~~~~~~~~~~~~ //
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
interface Segment {
  source: Coordinate;
  target: Coordinate;
}
function segmentFromCoords(a: Coordinate, b: Coordinate): Segment {
  return { source: new Coordinate(a.x, a.y), target: new Coordinate(b.x, b.y) };
}
function segmentsEqual(a: Segment, b: Segment): boolean {
  return pointsEqual(a.source, b.source) && pointsEqual(a.target, b.target);
}
function segmentsEqualIgnoringOrientation(a: Segment, b: Segment): boolean {
  return (
    segmentsEqual(a, b) ||
    (pointsEqual(a.source, b.target) && pointsEqual(a.target, b.source))
  );
}
function segmentHasOnPositiveSide(seg: Segment, p: Coordinate): boolean {
  const dirX = seg.target.x - seg.source.x;
  const dirY = seg.target.y - seg.source.y;
  const vx = p.x - seg.source.x;
  const vy = p.y - seg.source.y;
  const cross = dirX * vy - dirY * vx;
  return cross > 0;
}

interface ProcessState {
  sortedVertices: Vertex[];
  L: Segment[];
  openPolygons: Coordinate[][];
  closedPolygons: Coordinate[][];
  processedVertices: Coordinate[];
}

export function getBCD(
  polygon: Polygon,
  angle: number,
): {
  polygons: Polygon[];
  graph: graphlib.Graph<null, Polygon, Coordinate[]>;
} {
  // prepare polygon: simplify, sort, and rotate
  const centroid = polygon.getCentroid();
  const preparedPolygon = preparePolygon(polygon, angle, centroid);

  const processState: ProcessState = {
    sortedVertices: getXSortedVertices(preparedPolygon),
    L: [],
    openPolygons: [],
    closedPolygons: [],
    processedVertices: [],
  };

  for (const v of processState.sortedVertices) {
    const p = getPoint(preparedPolygon, v);
    if (processState.processedVertices.some((q) => pointsEqual(q, p))) continue;
    processEvent(preparedPolygon, v, processState);
  }

  const polygons = [];
  const graph = new graphlib.Graph<null, Polygon, Coordinate[]>();
  const rotation = AffineTransformation.rotationInstance(
    -angle,
    centroid.getX(),
    centroid.getY(),
  );
  for (let polygon of processState.closedPolygons) {
    const rotated = rotation.transform(
      geometryFactory.createPolygon([...polygon, polygon[0]]),
    );
    polygons.push(
      rotation.transform(geometryFactory.createPolygon([...polygon, polygon[0]])),
    );
  }
  return { polygons, graph };
}

function preparePolygon(polygon: Polygon, angle: number, centroid: Point): Polygon {
  // simplify: remove collinear points
  let result = DouglasPeuckerSimplifier.simplify(polygon, 0);
  // sort: ensure the exterior ring is CCW and all interior rings are CW
  const exterior = result.getExteriorRing();
  const shell = Orientation.isCCW(exterior) ? exterior : exterior.reverse();
  const holes = [];
  for (let i = 0; i < result.getNumInteriorRing(); i++) {
    const interior = result.getInteriorRingN(i);
    holes.push(Orientation.isCCW(interior) ? interior.reverse() : interior);
  }
  result = geometryFactory.createPolygon(shell, holes);
  // rotate
  const rotation = AffineTransformation.rotationInstance(
    angle,
    centroid.getX(),
    centroid.getY(),
  );
  return rotation.transform(result);
}

function getPoint(polygon: Polygon, vertex: Vertex): Coordinate {
  if (vertex.ring === 'outer') {
    return polygon.getExteriorRing().getCoordinateN(vertex.index);
  } else {
    return polygon.getInteriorRingN(vertex.holeIndex).getCoordinateN(vertex.index);
  }
}

function cleanupPolygonCoordinates(polygonCoordinates: Coordinate[]): boolean {
  if (polygonCoordinates.length === 0) return false;
  // remove duplicate consecutive vertices
  let eraseOne = true;
  while (eraseOne && polygonCoordinates.length > 1) {
    eraseOne = false;
    const n = polygonCoordinates.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (pointsEqual(polygonCoordinates[i], polygonCoordinates[j])) {
        polygonCoordinates.splice(j, 1);
        eraseOne = true;
        break;
      }
    }
  }
  // ensure a non-zero area
  if (almostEqual(Area.ofRingSigned(polygonCoordinates), 0)) return false;
  // ensure result is simple
  return geometryFactory
    .createLinearRing([...polygonCoordinates, polygonCoordinates[0]])
    .isSimple();
}

// Sorting vertices by x, y
function getXSortedVertices(polygon: Polygon): Vertex[] {
  const sorted: Vertex[] = [];
  // add the exterior ring *excluding* the closing duplicate
  const exterior = polygon.getExteriorRing();
  for (let i = 0; i < exterior.getNumPoints() - 1; i++) {
    sorted.push({ ring: 'outer', index: i });
  }
  // add the interior rings *excluding* the closing duplicate
  for (let i = 0; i < polygon.getNumInteriorRing(); i++) {
    const interior = polygon.getInteriorRingN(i);
    for (let j = 0; j < interior.getNumPoints() - 1; j++) {
      sorted.push({ ring: 'hole', holeIndex: i, index: j });
    }
  }
  // sort the vertices
  sorted.sort((a, b) => {
    const pa = getPoint(polygon, a);
    const pb = getPoint(polygon, b);
    if (!almostEqual(pa.x, pb.x)) return pa.x - pb.x;
    return pa.y - pb.y;
  });
  return sorted;
}

function getIntersections(L: Segment[], x0: number): Coordinate[] {
  const intersections: Coordinate[] = [];
  for (const seg of L) {
    const res = intersectSegmentWithVerticalLine(seg, x0);
    if (!res) {
      console.warn('No intersection found for segment with vertical line');
      intersections.push(new Coordinate(seg.target.x, seg.target.y));
    } else {
      intersections.push(res);
    }
  }
  return intersections;
}

function intersectSegmentWithVerticalLine(seg: Segment, x0: number): Coordinate | null {
  const a = seg.source;
  const b = seg.target;

  if (almostEqual(a.x, b.x) && almostEqual(a.x, x0)) return new Coordinate(b.x, b.y);
  if (almostEqual(a.x, b.x)) return null;

  const minX = Math.min(a.x, b.x) - EPS;
  const maxX = Math.max(a.x, b.x) + EPS;
  if (x0 < minX || x0 > maxX) return null;

  const t = (x0 - a.x) / (b.x - a.x);
  if (t < -EPS || t > 1 + EPS) return null;

  const y = a.y + t * (b.y - a.y);
  return new Coordinate(x0, y);
}

interface EventData {
  vPoint: Coordinate;
  e_lower: Segment;
  e_upper: Segment;
  intersections: Coordinate[];
}
function processEvent(polygon: Polygon, v: Vertex, processState: ProcessState) {
  const vPoint = getPoint(polygon, v);
  const intersections = getIntersections(processState.L, vPoint.x);

  // e_prev/e_next from v to neighbors on ring
  let vPrev = prevVertex(polygon, v);
  let vNext = nextVertex(polygon, v);
  let e_prev = segmentFromCoords(vPoint, getPoint(polygon, vPrev));
  let e_next = segmentFromCoords(vPoint, getPoint(polygon, vNext));

  // Correct vertical edges
  if (equalX(e_prev.source, e_prev.target)) {
    const vPrev2 = prevVertex(polygon, vPrev);
    e_prev = segmentFromCoords(getPoint(polygon, vPrev), getPoint(polygon, vPrev2));
  } else if (equalX(e_next.source, e_next.target)) {
    const vNext2 = nextVertex(polygon, vNext);
    e_next = segmentFromCoords(getPoint(polygon, vNext), getPoint(polygon, vNext2));
  }

  let e_lower = { ...e_prev };
  let e_upper = { ...e_next };

  const eventData = { vPoint, e_lower, e_upper, intersections };
  if (lessX(e_prev.target, e_prev.source) && lessX(e_next.target, e_next.source)) {
    processOutEvent(polygon, v, processState, eventData);
  } else if (
    !lessX(e_lower.target, e_lower.source) &&
    !lessX(e_upper.target, e_upper.source)
  ) {
    processInEvent(polygon, v, processState, eventData);
  } else {
    processMiddleEvent(polygon, v, processState, eventData);
  }
}

function processOutEvent(
  polygon: Polygon,
  v: Vertex,
  processState: ProcessState,
  eventData: EventData,
) {
  const p_on_upper = pointsEqual(eventData.e_lower.source, eventData.e_upper.source)
    ? eventData.e_upper.target
    : eventData.e_upper.source;
  if (segmentHasOnPositiveSide(eventData.e_lower, p_on_upper)) {
    const tmp = eventData.e_lower;
    eventData.e_lower = eventData.e_upper;
    eventData.e_upper = tmp;
  }

  const epsPoint = new Coordinate(eventData.vPoint.x + 1e-6, eventData.vPoint.y);
  const close_one = !polygon.covers(geometryFactory.createPoint(epsPoint));

  let e_lower_id = -1;
  for (let i = 0; i < processState.L.length; i++) {
    if (segmentsEqualIgnoringOrientation(processState.L[i], eventData.e_lower)) {
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
    const cell = processState.openPolygons[cellIndex];
    cell.push(eventData.e_lower.source);
    if (!pointsEqual(eventData.e_lower.source, eventData.e_upper.source)) {
      cell.push(eventData.e_upper.source);
    }

    processState.closedPolygons.push(cell);

    processState.L.splice(e_upper_id, 1);
    processState.L.splice(e_lower_id, 1);
    processState.openPolygons.splice(cellIndex, 1);
  } else {
    if (eventData.intersections.length <= e_upper_id + 1) {
      throw new Error('Not enough intersections for close_two branch');
    }

    const lower_cell = processState.openPolygons[lower_cell_id];
    const upper_cell = processState.openPolygons[upper_cell_id];

    lower_cell.push(eventData.intersections[e_lower_id - 1]);
    lower_cell.push(eventData.intersections[e_lower_id]);
    processState.closedPolygons.push(lower_cell);

    upper_cell.push(eventData.intersections[e_upper_id]);
    upper_cell.push(eventData.intersections[e_upper_id + 1]);
    processState.closedPolygons.push(upper_cell);

    processState.L.splice(e_upper_id, 1);
    processState.L.splice(e_lower_id, 1);

    const newPolygon: Coordinate[] = [];
    newPolygon.push(eventData.intersections[e_upper_id + 1]);
    // newPolygon.push(eventData.intersections[e_upper_id]);
    // if (!pointsEqual(eventData.intersections[e_upper_id], eventData.intersections[e_lower_id])) {
    //   newPolygon.push(eventData.intersections[e_lower_id]);
    // }
    newPolygon.push(eventData.intersections[e_lower_id - 1]);
    processState.openPolygons.splice(lower_cell_id, 0, newPolygon);

    const removeIndices = [lower_cell_id + 1, upper_cell_id + 1].sort((a, b) => b - a);
    for (const idx of removeIndices) {
      processState.openPolygons.splice(idx, 1);
    }
  }

  processState.processedVertices.push(eventData.e_lower.source);
  if (!pointsEqual(eventData.e_lower.source, eventData.e_upper.source)) {
    processState.processedVertices.push(eventData.e_upper.source);
  }
}

function processInEvent(
  polygon: Polygon,
  v: Vertex,
  processState: ProcessState,
  eventData: EventData,
) {
  const p_on_lower = pointsEqual(eventData.e_lower.source, eventData.e_upper.source)
    ? eventData.e_lower.target
    : eventData.e_lower.source;
  if (segmentHasOnPositiveSide(eventData.e_upper, p_on_lower)) {
    const tmp = eventData.e_lower;
    eventData.e_lower = eventData.e_upper;
    eventData.e_upper = tmp;
  }

  const epsPoint = new Coordinate(eventData.vPoint.x - 1e-6, eventData.vPoint.y);
  const open_one = !polygon.covers(geometryFactory.createPoint(epsPoint));

  let e_LOWER_id = 0;
  let found_e_lower_id = false;
  if (eventData.intersections.length >= 2) {
    for (let i = 0; i < eventData.intersections.length - 1; i += 2) {
      if (open_one) {
        if (
          lessY(eventData.intersections[i], eventData.e_lower.source) &&
          lessY(eventData.intersections[i + 1], eventData.e_upper.source)
        ) {
          e_LOWER_id = i;
          found_e_lower_id = true;
        }
      } else {
        if (
          lessY(eventData.intersections[i], eventData.e_lower.source) &&
          lessY(eventData.e_upper.source, eventData.intersections[i + 1])
        ) {
          e_LOWER_id = i;
        }
      }
    }
  }

  if (open_one) {
    let openCellIndex = 0;
    if (processState.L.length > 0 && found_e_lower_id) {
      openCellIndex = Math.floor(e_LOWER_id / 2) + 1;
    }

    if (processState.L.length === 0) {
      processState.L.push({ ...eventData.e_lower }, { ...eventData.e_upper });
    } else if (processState.L.length > 0 && !found_e_lower_id) {
      processState.L.unshift({ ...eventData.e_upper });
      processState.L.unshift({ ...eventData.e_lower });
    } else {
      const inserterIndex = e_LOWER_id + 1;
      processState.L.splice(
        inserterIndex + 1,
        0,
        { ...eventData.e_lower },
        { ...eventData.e_upper },
      );
    }

    const openPolygon: Coordinate[] = [];
    openPolygon.push(eventData.e_upper.source);
    if (!pointsEqual(eventData.e_lower.source, eventData.e_upper.source)) {
      openPolygon.push(eventData.e_lower.source);
    }
    processState.openPolygons.splice(openCellIndex, 0, openPolygon);
  } else {
    const e_LOWER = processState.L[e_LOWER_id];
    if (!e_LOWER) throw new Error('e_LOWER not found in L');
    const cellIndex = Math.floor(e_LOWER_id / 2);
    const cell = processState.openPolygons[cellIndex];
    if (!cell) throw new Error('Cell not found in openPolygons');

    processState.L.splice(
      e_LOWER_id + 1,
      0,
      { ...eventData.e_lower },
      { ...eventData.e_upper },
    );

    cell.push(eventData.intersections[e_LOWER_id]);
    // cell.push(eventData.e_lower.source);
    // if (!pointsEqual(eventData.e_lower.source, eventData.e_upper.source)) {
    //   cell.push(eventData.e_upper.source);
    // }
    cell.push(eventData.intersections[e_LOWER_id + 1]);

    processState.closedPolygons.push(cell);

    const newPolygonLower: Coordinate[] = [];
    newPolygonLower.push(eventData.e_lower.source);
    newPolygonLower.push(eventData.intersections[e_LOWER_id]);

    const newPolygonUpper: Coordinate[] = [];
    newPolygonUpper.push(eventData.intersections[e_LOWER_id + 1]);
    newPolygonUpper.push(eventData.e_upper.source);

    processState.openPolygons.splice(cellIndex, 1, newPolygonUpper);
    processState.openPolygons.splice(cellIndex, 0, newPolygonLower);
  }

  processState.processedVertices.push(eventData.e_lower.source);
  if (!pointsEqual(eventData.e_lower.source, eventData.e_upper.source)) {
    processState.processedVertices.push(eventData.e_upper.source);
  }
}

function processMiddleEvent(
  polygon: Polygon,
  v: Vertex,
  processState: ProcessState,
  eventData: EventData,
) {
  let v_middle: Vertex = { ...v };
  let foundEdgeIndex = -1;

  while (foundEdgeIndex === -1) {
    for (let i = 0; i < processState.L.length; i++) {
      const seg = processState.L[i];
      if (
        pointsEqual(getPoint(polygon, v_middle), seg.source) ||
        pointsEqual(getPoint(polygon, v_middle), seg.target)
      ) {
        foundEdgeIndex = i;

        if (!pointsEqual(getPoint(polygon, v_middle), eventData.vPoint)) {
          let i_v = -1;
          let i_v_middle = -1;
          for (let k = 0; k < processState.sortedVertices.length; k++) {
            if (verticesEqual(processState.sortedVertices[k], v)) i_v = k;
            if (verticesEqual(processState.sortedVertices[k], v_middle)) i_v_middle = k;
          }
          if (i_v === -1 || i_v_middle === -1) {
            throw new Error('Vertices not found in sortedVertices');
          }
          const tmp = processState.sortedVertices[i_v];
          processState.sortedVertices[i_v] = processState.sortedVertices[i_v_middle];
          processState.sortedVertices[i_v_middle] = tmp;
        }
        break;
      }
    }

    if (foundEdgeIndex === -1) {
      const v_prev_m = prevVertex(polygon, v_middle);
      const v_next_m = nextVertex(polygon, v_middle);
      const p_prev = getPoint(polygon, v_prev_m);
      const p_next = getPoint(polygon, v_next_m);
      const p_mid = getPoint(polygon, v_middle);

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

  const p_middle = getPoint(polygon, v_middle);
  const p_prev_m = getPoint(polygon, prevVertex(polygon, v_middle));
  const p_next_m = getPoint(polygon, nextVertex(polygon, v_middle));

  const e_prev_m = segmentFromCoords(p_middle, p_prev_m);
  const e_next_m = segmentFromCoords(p_middle, p_next_m);

  let edge_id = -1;
  let new_edge: Segment | null = null;
  for (let i = 0; i < processState.L.length; i++) {
    const seg = processState.L[i];
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
  const cell = processState.openPolygons[cell_id];
  if (!cell) throw new Error('Cell not found in degenerate branch');

  if (edge_id % 2 === 0) {
    cell.push(new_edge.source);
  } else {
    cell.unshift(new_edge.source);
  }

  processState.L.splice(edge_id, 1, { ...new_edge });

  processState.processedVertices.push(p_middle);
}
