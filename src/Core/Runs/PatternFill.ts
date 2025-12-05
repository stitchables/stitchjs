import { BoundingBox } from '../../Math/BoundingBox';
import { Graph } from '../../Math/Graph';
import { Polyline } from '../../Math/Polyline';
import { Utils } from '../../Math/Utils';
import { Vector } from '../../Math/Vector';
import { Stitch } from '../Stitch';
import { StitchType } from '../EStitchType';
import {
  Geometry,
  Coordinate,
  Point,
  Polygon,
  Envelope,
  LineString,
  LinearRing,
  LineSegment,
  MultiLineString,
  GeometryCollection,
  MultiPoint,
} from 'jsts/org/locationtech/jts/geom';
import {
  AffineTransformation,
  LineStringExtracter,
  PointExtracter,
} from 'jsts/org/locationtech/jts/geom/util';
import Orientation from 'jsts/org/locationtech/jts/algorithm/Orientation';
import { TopologyPreservingSimplifier } from 'jsts/org/locationtech/jts/simplify';
import { DistanceOp } from 'jsts/org/locationtech/jts/operation/distance';
import { OverlayOp } from 'jsts/org/locationtech/jts/operation/overlay';
import {
  LocationIndexedLine,
  LengthIndexedLine,
  LengthLocationMap,
  LinearLocation,
} from 'jsts/org/locationtech/jts/linearref';
import EdgeGraph from 'jsts/org/locationtech/jts/edgegraph/EdgeGraph';
import EdgeGraphBuilder from 'jsts/org/locationtech/jts/edgegraph/EdgeGraphBuilder';
import RobustLineIntersector from 'jsts/org/locationtech/jts/algorithm/RobustLineIntersector';
import IntersectionAdder from 'jsts/org/locationtech/jts/noding/IntersectionAdder';
import EdgeSetNoder from 'jsts/org/locationtech/jts/operation/overlay/EdgeSetNoder';
import SortedPackedIntervalRTree from 'jsts/org/locationtech/jts/index/intervalrtree/SortedPackedIntervalRTree';
import STRTree from 'jsts/org/locationtech/jts/index/strtree/STRtree';
import HalfEdge from 'jsts/org/locationtech/jts/edgegraph/HalfEdge';
import { Polygonizer } from 'jsts/org/locationtech/jts/operation/polygonize';
import { MCIndexNoder } from 'jsts/org/locationtech/jts/noding';
import SimpleNoder from 'jsts/org/locationtech/jts/noding/SimpleNoder';
import NodedSegmentString from 'jsts/org/locationtech/jts/noding/NodedSegmentString';
import SegmentStringUtil from 'jsts/org/locationtech/jts/noding/SegmentStringUtil';
import { GeometrySnapper } from 'jsts/org/locationtech/jts/operation/overlay/snap';
import PlanarGraph from 'jsts/org/locationtech/jts/geomgraph/PlanarGraph';
import Node from 'jsts/org/locationtech/jts/geomgraph/Node';
import Edge from 'jsts/org/locationtech/jts/geomgraph/Edge';
import DirectedEdge from 'jsts/org/locationtech/jts/geomgraph/DirectedEdge';
import PolygonBuilder from 'jsts/org/locationtech/jts/operation/overlay/PolygonBuilder';
import { IRun } from '../IRun';
import { geometryFactory } from '../../util/jsts';
import SimpleMCSweepLineIntersector from 'jsts/org/locationtech/jts/geomgraph/index/SimpleMCSweepLineIntersector';
import SegmentIntersector from 'jsts/org/locationtech/jts/geomgraph/index/SegmentIntersector';
import ArrayList from 'jsts/java/util/ArrayList';

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
    this.centroid = this.polygon.getCentroid().getCoordinate();
    this.angle = (options?.angle ?? 0) % Math.PI;
    this.polygon = this.translate(this.polygon, -this.centroid.x, -this.centroid.y);
    this.polygon = this.rotate(this.polygon, this.angle);
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
      : this.polygon.getCentroid().getCoordinate();
    this.envelope = this.polygon.getEnvelopeInternal();
  }

  translate(g: Polygon | Coordinate, tx: number, ty: number) {
    return AffineTransformation.translationInstance(tx, ty).transform(g);
  }

  rotate(
    g: Polygon | Coordinate,
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

  projectCoordinateToBoundary(
    c: Coordinate,
    eps = 0.000001,
  ): BoundaryProjection | undefined {
    for (let i = 0; i < this.boundaryData.length; i++) {
      if (
        DistanceOp.isWithinDistance(
          this.boundaryData[i].ring,
          geometryFactory.createPoint(c),
          eps,
        )
      ) {
        const projection = this.boundaryData[i].locationIndex.project(c);
        return {
          shapeIndex: i,
          locationIndex: this.boundaryData[i].locationIndex.project(c),
          coordinate: this.boundaryData[i].lengthIndex.extractPoint(projection),
        };
      }
    }
    return undefined;
  }

  getStitches(pixelsPerMm: number): Stitch[] {
    const stitches: Stitch[] = [];
    const extremes = this.getExtremes();
    const nodedBoundaries = this.getNodedBoundaries(extremes);
    const { nodes, adjacency } = this.buildPSG(extremes, nodedBoundaries);
    const faces: Polygon[] = this.getFacesFromGraph(nodes, adjacency);
    return stitches;
  }

  buildPSG(
    extremes: {
      shapeIndex: number;
      locationIndex: LinearLocation;
      direction: 'LEFT' | 'RIGHT' | 'BOTH';
    }[],
    nodedBoundaries: LineString[],
  ): { nodes: Coordinate[]; adjacency: Map<number, number[]> } {
    const strTree = new STRTree();
    const nodes: Coordinate[] = [];
    const adjacency: Map<number, number[]> = new Map();
    for (let i = 0, index = 0; i < nodedBoundaries.length; i++) {
      const startIndex = nodes.length;
      for (let j = 0, n = nodedBoundaries[i].getNumPoints() - 1; j < n; j++) {
        const prevIndex = j === 0 ? startIndex + n - 1 : startIndex + j - 1;
        const nextIndex = j === n - 1 ? startIndex : startIndex + j + 1;
        adjacency.set(nodes.length, [prevIndex, nextIndex]);
        const coord = nodedBoundaries[i].getCoordinateN(j);
        strTree.insert(new Envelope(coord), { coord, index });
        nodes.push(coord);
        index++;
      }
    }

    for (const extreme of extremes) {
      const p: Coordinate = this.boundaryData[
        extreme.shapeIndex
      ].locationIndex.extractPoint(extreme.locationIndex);
      const pEnv = new Envelope(p);
      pEnv.expandBy(eps);
      const pn: number = strTree.query(pEnv).array[0].index;
      if (extreme.direction === 'BOTH' || extreme.direction === 'LEFT') {
        const p1 = new Coordinate(p.x - eps, p.y + eps);
        const p2 = new Coordinate(this.envelope.getMinX(), p.y - eps);
        const env = new Envelope(p1, p2);
        const candidates: { coord: Coordinate; index: number }[] =
          strTree.query(env).array;
        let minDistance = Infinity;
        let minCandidate = undefined;
        for (let i = 0; i < candidates.length; i++) {
          const distance = candidates[i].coord.distance(p);
          if (distance < minDistance) {
            minDistance = distance;
            minCandidate = candidates[i];
          }
        }
        if (minCandidate !== undefined) {
          const e1 = adjacency.get(pn);
          const e2 = adjacency.get(minCandidate.index);
          if (e1 && e2) {
            e1.push(minCandidate.index);
            adjacency.set(pn, e1);
            e2.push(pn);
            adjacency.set(minCandidate.index, e2);
          }
        }
      }
      if (extreme.direction === 'BOTH' || extreme.direction === 'RIGHT') {
        const p1 = new Coordinate(p.x + eps, p.y + eps);
        const p2 = new Coordinate(this.envelope.getMaxX(), p.y - eps);
        const env = new Envelope(p1, p2);
        const candidates: { coord: Coordinate; index: number }[] =
          strTree.query(env).array;
        let minDistance = Infinity;
        let minCandidate = undefined;
        for (let i = 0; i < candidates.length; i++) {
          const distance = candidates[i].coord.distance(p);
          if (distance < minDistance) {
            minDistance = distance;
            minCandidate = candidates[i];
          }
        }
        if (minCandidate !== undefined) {
          const e1 = adjacency.get(pn);
          const e2 = adjacency.get(minCandidate.index);
          if (e1 && e2) {
            e1.push(minCandidate.index);
            adjacency.set(pn, e1);
            e2.push(pn);
            adjacency.set(minCandidate.index, e2);
          }
        }
      }
    }

    return { nodes, adjacency };
  }

  getExtremes(eps = 1e-7): {
    shapeIndex: number;
    locationIndex: LinearLocation;
    direction: 'LEFT' | 'RIGHT' | 'BOTH';
  }[] {
    const extremes: {
      shapeIndex: number;
      locationIndex: LinearLocation;
      direction: 'LEFT' | 'RIGHT' | 'BOTH';
    }[] = [];
    for (let i = 0; i < this.boundaryData.length; i++) {
      for (let j = 0, n = this.boundaryData[i].ring.getNumPoints() - 1; j < n; j++) {
        const prev = this.boundaryData[i].ring.getCoordinateN((j + 0) % n);
        const curr = this.boundaryData[i].ring.getCoordinateN((j + 1) % n);
        const next = this.boundaryData[i].ring.getCoordinateN((j + 2) % n);
        const n1 = new Coordinate(curr.x - prev.x, curr.y - prev.y);
        const n2 = new Coordinate(curr.x - next.x, curr.y - next.y);
        const cross = n1.x * n2.y - n1.y * n2.x;
        if (cross > 0) {
          const shapeIndex = i;
          const locationIndex = new LinearLocation((j + 1) % n, 0);
          if (Math.sign(curr.y - prev.y) === Math.sign(curr.y - next.y)) {
            extremes.push({ shapeIndex, locationIndex, direction: 'BOTH' });
          } else if (Math.abs(curr.y - prev.y) < eps && Math.abs(curr.y - next.y) > eps) {
            extremes.push({
              shapeIndex,
              locationIndex,
              direction: curr.x < prev.x ? 'LEFT' : 'RIGHT',
            });
          } else if (Math.abs(curr.y - next.y) < eps && Math.abs(curr.y - prev.y) > eps) {
            extremes.push({
              shapeIndex,
              locationIndex,
              direction: curr.x < next.x ? 'LEFT' : 'RIGHT',
            });
          }
        }
      }
    }
    return extremes;
  }

  getNodedBoundaries(
    extremes: {
      shapeIndex: number;
      locationIndex: LinearLocation;
      direction: 'LEFT' | 'RIGHT' | 'BOTH';
    }[],
    eps = 1e-7,
  ): LinearRing[] {
    const newNodeLengthIndices: number[][] = Array.from(
      { length: this.boundaryData.length },
      () => [],
    );
    for (const extreme of extremes) {
      const p: Coordinate = this.boundaryData[
        extreme.shapeIndex
      ].locationIndex.extractPoint(extreme.locationIndex);
      if (extreme.direction === 'BOTH' || extreme.direction === 'LEFT') {
        const p1 = new Coordinate(p.x - eps, p.y);
        const p2 = new Coordinate(this.envelope.getMinX(), p.y);
        const lineString = geometryFactory.createLineString([p1, p2]);
        let minDistance = Infinity;
        let minShapeIndex: number | undefined = undefined;
        let minLengthIndex: number | undefined = undefined;
        for (let i = 0; i < this.boundaryData.length; i++) {
          const intersection = OverlayOp.overlayOp(
            this.boundaryData[i].ring,
            lineString,
            OverlayOp.INTERSECTION,
          );
          const points: Point[] = PointExtracter.getPoints(intersection).array;
          const coords: Coordinate[] = points.map((v: Point) => v.getCoordinate());
          for (const coord of coords) {
            const distance = coord.distance(p);
            if (distance < minDistance) {
              minDistance = distance;
              minShapeIndex = i;
              minLengthIndex = this.boundaryData[i].lengthIndex.project(coord);
            }
          }
        }
        if (minShapeIndex !== undefined && minLengthIndex !== undefined) {
          newNodeLengthIndices[minShapeIndex].push(minLengthIndex);
        }
      }
      if (extreme.direction === 'BOTH' || extreme.direction === 'RIGHT') {
        const p1 = new Coordinate(p.x + eps, p.y);
        const p2 = new Coordinate(this.envelope.getMaxX(), p.y);
        const lineString = geometryFactory.createLineString([p1, p2]);
        let minDistance = Infinity;
        let minShapeIndex: number | undefined = undefined;
        let minLengthIndex: number | undefined = undefined;
        for (let i = 0; i < this.boundaryData.length; i++) {
          const intersection = OverlayOp.overlayOp(
            this.boundaryData[i].ring,
            lineString,
            OverlayOp.INTERSECTION,
          );
          const points: Point[] = PointExtracter.getPoints(intersection).array;
          const coords: Coordinate[] = points.map((v: Point) => v.getCoordinate());
          for (const coord of coords) {
            const distance = coord.distance(p);
            if (distance < minDistance) {
              minDistance = distance;
              minShapeIndex = i;
              minLengthIndex = this.boundaryData[i].lengthIndex.project(coord);
            }
          }
        }
        if (minShapeIndex !== undefined && minLengthIndex !== undefined) {
          newNodeLengthIndices[minShapeIndex].push(minLengthIndex);
        }
      }
    }

    const nodedBoundaries: LinearRing[] = [];
    for (let i = 0; i < this.boundaryData.length; i++) {
      if (newNodeLengthIndices[i].length > 0) {
        newNodeLengthIndices[i].sort((a, b) => a - b);
        const coords = this.boundaryData[i].ring.getCoordinates().slice();
        for (let j = newNodeLengthIndices[i].length - 1; j >= 0; j--) {
          const location: LinearLocation = this.boundaryData[
            i
          ].lengthLocationMap.getLocation(newNodeLengthIndices[i][j]);
          const fraction = location.getSegmentFraction();
          if (fraction > eps && fraction < 1 - eps) {
            const coord = this.boundaryData[i].lengthIndex.extractPoint(
              newNodeLengthIndices[i][j],
            );
            coords.splice(location.getSegmentIndex() + 1, 0, coord);
          }
        }
        nodedBoundaries.push(geometryFactory.createLinearRing(coords));
      } else {
        nodedBoundaries.push(this.boundaryData[i].ring);
      }
    }

    return nodedBoundaries;
  }

  getHatchLines(rowSpacingPx: number): LineString[] {
    const lineStrings: LineString[] = [];
    const [xMin, yMin] = [
      this.envelope.getMinX() - rowSpacingPx,
      this.envelope.getMinY() - rowSpacingPx,
    ];
    const [xMax, yMax] = [
      this.envelope.getMaxX() + rowSpacingPx,
      this.envelope.getMaxY() + rowSpacingPx,
    ];
    for (let i = 0, y = yMin; y <= yMax; y += rowSpacingPx) {
      lineStrings.push(
        geometryFactory.createLineString([
          new Coordinate(xMin, y),
          new Coordinate(xMax, y),
        ]),
      );
    }
    return lineStrings;
  }

  getCuts(eps = 1e-7): { origin: BoundaryProjection; cuts: BoundaryProjection[] }[] {
    const cuts: { origin: BoundaryProjection; cuts: BoundaryProjection[] }[] = [];
    for (let i = 0; i < this.boundaryData.length; i++) {
      for (let j = 0, n = this.boundaryData[i].ring.getNumPoints() - 1; j <= n; j++) {
        const prev = this.boundaryData[i].ring.getCoordinateN((j + 0) % n);
        const curr = this.boundaryData[i].ring.getCoordinateN((j + 1) % n);
        const next = this.boundaryData[i].ring.getCoordinateN((j + 2) % n);
        const n1 = new Coordinate(curr.x - prev.x, curr.y - prev.y);
        const n2 = new Coordinate(curr.x - next.x, curr.y - next.y);
        const cross = n1.x * n2.y - n1.y * n2.x;
        if (Math.sign(curr.y - prev.y) === Math.sign(curr.y - next.y)) {
          if (cross > 0) {
            const leftCutLine = geometryFactory.createLineString([
              new Coordinate(this.envelope.getMinX(), curr.y),
              new Coordinate(curr.x - eps, curr.y),
            ]);
            const rightCutLine = geometryFactory.createLineString([
              new Coordinate(curr.x + eps, curr.y),
              new Coordinate(this.envelope.getMaxX(), curr.y),
            ]);
            const leftIntersections: Coordinate[] = [];
            const rightIntersections: Coordinate[] = [];
            for (const boundary of this.boundaryData) {
              const leftOp = OverlayOp.overlayOp(
                boundary.ring,
                leftCutLine,
                OverlayOp.INTERSECTION,
              );
              const rightOp = OverlayOp.overlayOp(
                boundary.ring,
                rightCutLine,
                OverlayOp.INTERSECTION,
              );
              leftIntersections.push(
                ...PointExtracter.getPoints(leftOp).array.map((p: Point) =>
                  p.getCoordinate(),
                ),
              );
              rightIntersections.push(
                ...PointExtracter.getPoints(rightOp).array.map((p: Point) =>
                  p.getCoordinate(),
                ),
              );
            }
            leftIntersections.sort((a, b) => b.x - a.x);
            const leftProjection = this.projectCoordinateToBoundary(leftIntersections[0]);
            rightIntersections.sort((a, b) => a.x - b.x);
            const rightProjection = this.projectCoordinateToBoundary(
              rightIntersections[0],
            );
            if (leftProjection && rightProjection) {
              cuts.push({
                origin: {
                  shapeIndex: i,
                  locationIndex: new LinearLocation((j + 1) % n, 0),
                  coordinate: curr,
                },
                cuts: [leftProjection, rightProjection],
              });
            }
          }
        } else if (Math.abs(curr.y - prev.y) < eps && Math.abs(curr.y - next.y) > eps) {
          if (cross > 0) {
            const cutLine =
              curr.x < prev.x
                ? geometryFactory.createLineString([
                    new Coordinate(this.envelope.getMinX(), curr.y),
                    new Coordinate(curr.x - eps, curr.y),
                  ])
                : geometryFactory.createLineString([
                    new Coordinate(curr.x + eps, curr.y),
                    new Coordinate(this.envelope.getMaxX(), curr.y),
                  ]);
            const intersections: Coordinate[] = [];
            for (const boundary of this.boundaryData) {
              const op = OverlayOp.overlayOp(
                boundary.ring,
                cutLine,
                OverlayOp.INTERSECTION,
              );
              intersections.push(
                ...PointExtracter.getPoints(op).array.map((p: Point) =>
                  p.getCoordinate(),
                ),
              );
            }
            intersections.sort((a, b) => a.x - b.x);
            const projection = this.projectCoordinateToBoundary(intersections[0]);
            if (projection) {
              cuts.push({
                origin: {
                  shapeIndex: i,
                  locationIndex: new LinearLocation((j + 1) % n, 0),
                  coordinate: curr,
                },
                cuts: [projection],
              });
            }
          }
        } else if (Math.abs(curr.y - next.y) < eps && Math.abs(curr.y - prev.y) > eps) {
          if (cross > 0) {
            const cutLine =
              curr.x < next.x
                ? geometryFactory.createLineString([
                    new Coordinate(this.envelope.getMinX(), curr.y),
                    new Coordinate(curr.x - eps, curr.y),
                  ])
                : geometryFactory.createLineString([
                    new Coordinate(curr.x + eps, curr.y),
                    new Coordinate(this.envelope.getMaxX(), curr.y),
                  ]);
            const intersections: Coordinate[] = [];
            for (const boundary of this.boundaryData) {
              const op = OverlayOp.overlayOp(
                boundary.ring,
                cutLine,
                OverlayOp.INTERSECTION,
              );
              intersections.push(
                ...PointExtracter.getPoints(op).array.map((p: Point) =>
                  p.getCoordinate(),
                ),
              );
            }
            intersections.sort((a, b) => b.x - a.x);
            const projection = this.projectCoordinateToBoundary(intersections[0]);
            if (projection) {
              cuts.push({
                origin: {
                  shapeIndex: i,
                  locationIndex: new LinearLocation((j + 1) % n, 0),
                  coordinate: curr,
                },
                cuts: [projection],
              });
            }
          }
        }
      }
    }
    return cuts;
  }

  // // 0----------1
  // // |          |
  // // |     /----2
  // // 5----/     |
  // // |          |
  // // 4----------3
  // test(): Polygon[] {
  //   const [xMin, yMin, xMax, yMax] = [10, 10, 390, 390];
  //   const nodes = [
  //     new Coordinate(xMin, yMin),
  //     new Coordinate(xMax, yMin),
  //     new Coordinate(xMax, 0.4 * yMin + 0.6 * yMax),
  //     new Coordinate(xMax, yMax),
  //     new Coordinate(xMin, yMax),
  //     new Coordinate(xMin, 0.6 * yMin + 0.4 * yMax),
  //   ];
  //   const adjacency = new Map([
  //     [0, [1, 5]],
  //     [1, [0, 2]],
  //     [2, [1, 3, 5]],
  //     [3, [2, 4]],
  //     [4, [3, 5]],
  //     [5, [0, 2, 4]],
  //   ]);
  //   return getFacesFromGraph(nodes, adjacency);
  // }

  getFacesFromGraph(nodes: Coordinate[], adjacency: Map<number, number[]>): Polygon[] {
    const vertexMap = new Map<number, Coordinate>(nodes.map((c, i) => [i, c]));

    const edgeMap = new Map<string, string>();
    for (const [src, neighbors] of adjacency.entries()) {
      if (vertexMap.has(src)) {
        for (const dst of neighbors) {
          if (vertexMap.has(dst)) {
            if (src < dst) {
              edgeMap.set(`${src},${dst}`, '');
              edgeMap.set(`${dst},${src}`, '');
            }
          }
        }
      }
    }

    const angleABC = (a: Coordinate, b: Coordinate, c: Coordinate): number => {
      const [bax, bay] = [a.x - b.x, a.y - b.y];
      const [bcx, bcy] = [c.x - b.x, c.y - b.y];
      return Math.atan2(-(bax * bcy - bay * bcx), -(bax * bcx + bay * bcy)) + Math.PI;
    };

    for (const [src, neighbors] of adjacency.entries()) {
      const from = vertexMap.get(src);
      if (from) {
        for (const dst of neighbors) {
          const to = vertexMap.get(dst);
          if (to) {
            if (edgeMap.has(`${src},${dst}`)) {
              let minAngle: number | undefined = undefined;
              let minEdge: string | undefined = undefined;
              for (const nextNeighbor of adjacency.get(dst) ?? []) {
                const next = vertexMap.get(nextNeighbor);
                if (next && src !== nextNeighbor) {
                  const angle = angleABC(from, to, next);
                  if (minAngle === undefined || angle < minAngle) {
                    minAngle = angle;
                    minEdge = `${dst},${nextNeighbor}`;
                  }
                }
              }
              if (minEdge !== undefined) {
                edgeMap.set(`${src},${dst}`, minEdge);
              }
            }
          }
        }
      }
    }

    // collect the faces
    const faces: Polygon[] = [];
    const queue = new Set(edgeMap.keys());
    while (queue.size > 0) {
      let start = queue.values().next().value;
      if (start) {
        queue.delete(start);
        const coords = [vertexMap.get(parseInt(start.split(',')[0])) ?? new Coordinate()];
        let curr = edgeMap.get(start);
        while (curr) {
          if (queue.has(curr)) {
            queue.delete(curr);
          }
          coords.push(vertexMap.get(parseInt(curr.split(',')[0])) ?? new Coordinate());
          curr = edgeMap.get(curr);
          if (curr === start) {
            coords.push(coords[0]);
            faces.push(geometryFactory.createPolygon(coords));
            break;
          }
        }
      }
    }

    return faces;
  }
}
