import {
  Coordinate,
  Point,
  MultiPoint,
  LineSegment,
  LineString,
  MultiLineString,
  Polygon,
} from 'jsts/org/locationtech/jts/geom';
import { DistanceOp } from 'jsts/org/locationtech/jts/operation/distance';
import { STRtree } from 'jsts/org/locationtech/jts/index/strtree';
import ItemBoundable from 'jsts/org/locationtech/jts/index/strtree/ItemBoundable';
import ItemDistance from 'jsts/org/locationtech/jts/index/strtree/ItemDistance';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp';
import RelateOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp';
import LineMerger from 'jsts/org/locationtech/jts/operation/linemerge/LineMerger';
import PointExtracter from 'jsts/org/locationtech/jts/geom/util/PointExtracter';
import * as graphlib from '@dagrejs/graphlib';
import { geometryFactory } from '../util/jsts';
import { findPath } from './findPath';
import { Skeleton } from 'straight-skeleton';
import { IPolygonPathFinder, PathFinderGeometry } from './PolygonPathFinder';
import { getStraightSkeleton } from '../Geometry/getStraightSkeleton';
import NavMeshPolygonPathFinder from './NavMeshPolygonPathFinder';

class SkeletonTreeItemDistance {
  distance(item1: ItemBoundable, item2: ItemBoundable) {
    if (item1 === item2) return Number.MAX_VALUE;
    const g2 = item1.getItem().geometry;
    const g1 = item2.getItem().geometry;
    return g1.distance(g2);
  }
  get interfaces_() {
    return [ItemDistance];
  }
}

export class SkeletonPolygonPathFinder implements IPolygonPathFinder {
  polygon: Polygon;
  travelGraph: graphlib.Graph<null, Point, number>;
  skeletonTree: STRtree;
  skeletonTreeItemDistance: SkeletonTreeItemDistance;
  centerLine: MultiLineString;
  constructor(polygon: Polygon, skeleton: Skeleton) {
    this.polygon = polygon;
    this.travelGraph = new graphlib.Graph<null, Point, number>({ directed: false });
    this.skeletonTree = new STRtree();
    this.skeletonTreeItemDistance = new SkeletonTreeItemDistance();
    const centerLineMerger = new LineMerger();
    if (!skeleton) throw new Error('Failed to create straight skeleton...');
    for (const polygon of skeleton.polygons) {
      let prevIndex = polygon[0];
      let prevNode = prevIndex.toString();
      let prevVertex = skeleton.vertices[prevIndex];
      let prevCoordinate = new Coordinate(prevVertex[0], prevVertex[1]);
      let prevPoint = geometryFactory.createPoint(prevCoordinate);
      const polygonCoordinates = [prevCoordinate];
      const polygonEdges = [];
      for (let i = 1; i <= polygon.length; i++) {
        const currIndex = polygon[i % polygon.length];
        const currNode = currIndex.toString();
        const currVertex = skeleton.vertices[currIndex];
        const currCoordinate = new Coordinate(currVertex[0], currVertex[1]);
        const currPoint = geometryFactory.createPoint(currCoordinate);
        polygonCoordinates.push(currCoordinate);
        if (prevVertex[2] > 0 && currVertex[2] > 0) {
          this.travelGraph.setNode(prevNode, prevPoint);
          this.travelGraph.setNode(currNode, currPoint);
          polygonEdges.push({
            v: prevNode,
            w: currNode,
            lineSegment: new LineSegment(prevCoordinate, currCoordinate),
          });
          if (!this.travelGraph.hasEdge(prevNode, currNode)) {
            this.travelGraph.setEdge(prevNode, currNode, prevPoint.distance(currPoint));
          }
          centerLineMerger.add(
            geometryFactory.createLineString([prevCoordinate, currCoordinate]),
          );
        }
        prevIndex = currIndex;
        prevNode = currNode;
        prevVertex = currVertex;
        prevCoordinate = currCoordinate;
        prevPoint = currPoint;
      }
      polygonCoordinates.push(polygonCoordinates[0]);
      if (polygonEdges.length > 0) {
        const skeletonPolygon = geometryFactory.createPolygon(polygonCoordinates);
        this.skeletonTree.insert(skeletonPolygon.getEnvelopeInternal(), {
          edges: polygonEdges,
          geometry: skeletonPolygon,
        });
      }
    }
    this.skeletonTree.build();
    this.centerLine = geometryFactory.createMultiLineString(
      centerLineMerger.getMergedLineStrings().toArray(),
    );
  }

  static fromPolygon(polygon: Polygon): SkeletonPolygonPathFinder | undefined {
    try {
      let skeleton = getStraightSkeleton(polygon);
      if (skeleton) return new SkeletonPolygonPathFinder(polygon, skeleton);
      return undefined;
    } catch (e) {
      return undefined;
    }
  }

  getAccessPoints(input: PathFinderGeometry): Point[] {
    if (input instanceof Point) return [input];
    if (input instanceof MultiPoint) return PointExtracter.getPoints(input).toArray();
    if (input instanceof Coordinate) {
      return [geometryFactory.createPoint(input)];
    }
    if (!RelateOp.intersects(this.polygon, input)) {
      const nearest = DistanceOp.nearestPoints(input, this.polygon)[0];
      return [geometryFactory.createPoint(nearest)];
    }
    if (!this.centerLine.isEmpty() && !RelateOp.intersects(this.centerLine, input)) {
      const nearest = DistanceOp.nearestPoints(input, this.centerLine)[0];
      return [geometryFactory.createPoint(nearest)];
    }
    let boundary = input;
    if (input instanceof Polygon) boundary = input.getBoundary();
    const intersections = OverlayOp.intersection(this.centerLine, boundary);
    return PointExtracter.getPoints(intersections).toArray();
  }

  findPath(start: PathFinderGeometry, end: PathFinderGeometry): LineString {
    const startPoints = this.getAccessPoints(start);
    const endPoints = this.getAccessPoints(end);
    // if (
    //   (start instanceof LineString || start instanceof Polygon) &&
    //   (end instanceof LineString || end instanceof Polygon)
    // ) {
    //   const nearest = DistanceOp.nearestPoints(start, end);
    //   startPoints.push(geometryFactory.createPoint(nearest[0]));
    //   endPoints.push(geometryFactory.createPoint(nearest[1]));
    // }
    if (startPoints.length === 0 || endPoints.length === 0) {
      return geometryFactory.createLineString();
    }
    if (startPoints.length === 1 && endPoints.length === 1) {
      return this.findPathFromPoints(startPoints[0], endPoints[0]);
    }
    let minPath = geometryFactory.createLineString();
    let minPathLength = Infinity;
    for (const startPoint of startPoints) {
      for (const endPoint of endPoints) {
        const path = this.findPathFromPoints(startPoint, endPoint);
        const pathLength = path.getLength();
        if (pathLength < minPathLength) {
          minPath = path;
          minPathLength = pathLength;
        }
      }
    }
    return minPath;
  }

  findPathFromPoints(start: Point, end: Point): LineString {
    if (start === end) return geometryFactory.createLineString([start]);
    const startResult = [start.getCoordinate()];
    let startPoint = start;
    if (!RelateOp.covers(this.polygon, start)) {
      const startNear = DistanceOp.nearestPoints(this.polygon, start)[0];
      startResult.push(startNear);
      startPoint = geometryFactory.createPoint(startNear);
    }
    if (this.centerLine.isEmpty()) {
      return geometryFactory.createLineString([
        startPoint.getCoordinate(),
        end.getCoordinate(),
      ]);
    }
    const startPolygon = this.skeletonTree.nearestNeighbour(
      startPoint.getEnvelopeInternal(),
      { geometry: startPoint },
      this.skeletonTreeItemDistance,
    );
    let startEdge = startPolygon.edges[0];
    const startCoordinate = startPoint.getCoordinate();
    let minStartEdgeDistance =
      startPolygon.edges[0].lineSegment.distance(startCoordinate);
    for (let i = 1; i < startPolygon.edges.length; i++) {
      const currStartEdgeDistance =
        startPolygon.edges[i].lineSegment.distance(startCoordinate);
      if (currStartEdgeDistance < minStartEdgeDistance) {
        startEdge = startPolygon.edges[i];
        minStartEdgeDistance = currStartEdgeDistance;
      }
    }
    const startEdgeProjection = startEdge.lineSegment.closestPoint(startCoordinate);
    startResult.push(startEdgeProjection);

    const endResult = [end.getCoordinate()];
    let endPoint = end;
    if (!RelateOp.covers(this.polygon, endPoint)) {
      const endNear = DistanceOp.nearestPoints(this.polygon, endPoint)[0];
      endResult.unshift(endNear);
      endPoint = geometryFactory.createPoint(endNear);
    }
    const endPolygon = this.skeletonTree.nearestNeighbour(
      endPoint.getEnvelopeInternal(),
      { geometry: endPoint },
      this.skeletonTreeItemDistance,
    );
    let endEdge = endPolygon.edges[0];
    const endCoordinate = endPoint.getCoordinate();
    let minEndEdgeDistance = endPolygon.edges[0].lineSegment.distance(endCoordinate);
    for (let i = 1; i < endPolygon.edges.length; i++) {
      const currEndEdgeDistance = endPolygon.edges[i].lineSegment.distance(endCoordinate);
      if (currEndEdgeDistance < minEndEdgeDistance) {
        endEdge = endPolygon.edges[i];
        minEndEdgeDistance = currEndEdgeDistance;
      }
    }
    const endEdgeProjection = endEdge.lineSegment.closestPoint(endCoordinate);
    endResult.unshift(endEdgeProjection);

    const path = findPath(
      this.travelGraph,
      startEdge.v,
      endEdge.v,
      (n: Point) => n,
      (e: number) => e,
    );

    const result = [...startResult];
    if (path) {
      if (path[0] === startEdge.v && path[1] === startEdge.w) path.shift();
      if (path[path.length - 1] === endEdge.v && path[path.length - 2] === endEdge.w)
        path.pop();
      for (const p of path) {
        result.push(this.travelGraph.node(p).getCoordinate());
      }
    }
    result.push(...endResult);

    return geometryFactory.createLineString(result);
  }
}
