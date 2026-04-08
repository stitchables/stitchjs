import {
  Coordinate,
  Point,
  LineSegment,
  Envelope,
  Polygon,
} from 'jsts/org/locationtech/jts/geom';
import { DistanceOp } from 'jsts/org/locationtech/jts/operation/distance';
import { STRtree } from 'jsts/org/locationtech/jts/index/strtree';
import ItemBoundable from 'jsts/org/locationtech/jts/index/strtree/ItemBoundable';
import ItemDistance from 'jsts/org/locationtech/jts/index/strtree/ItemDistance';
import * as graphlib from '@dagrejs/graphlib';
import { getStraightSkeleton } from '../Geometry/getStraightSkeleton';
import { Vector } from '../Math/Vector';
import { geometryFactory } from '../util/jsts';
import { findPath } from './findPath';

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

export default class PolygonPathFinder {
  polygon: Polygon;
  travelGraph: graphlib.Graph<string, Coordinate, number>;
  skeletonTree: STRtree;
  skeletonTreeItemDistance: SkeletonTreeItemDistance;
  constructor(polygon: Polygon) {
    this.polygon = polygon;
    this.travelGraph = new graphlib.Graph<string, Coordinate, number>({
      directed: false,
    });
    this.skeletonTree = new STRtree();
    this.skeletonTreeItemDistance = new SkeletonTreeItemDistance();
    const skeleton = getStraightSkeleton(this.polygon);
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
  }

  findPath(start: Vector, end: Vector): Vector[] {
    const startResult = [start];
    let startCoordinate = new Coordinate(start.x, start.y);
    let startPoint = geometryFactory.createPoint(startCoordinate);
    if (!this.polygon.covers(startPoint)) {
      const startNear = DistanceOp.nearestPoints(this.polygon, startPoint)[0];
      startResult.push(new Vector(startNear.x, startNear.y));
      startCoordinate = startNear;
      startPoint = geometryFactory.createPoint(startCoordinate);
    }
    const startPolygon = this.skeletonTree.nearestNeighbour(
      new Envelope(startCoordinate),
      { geometry: startPoint },
      this.skeletonTreeItemDistance,
    );
    let startEdge = startPolygon.edges[0];
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
    startResult.push(new Vector(startEdgeProjection.x, startEdgeProjection.y));

    const endResult = [end];
    let endCoordinate = new Coordinate(end.x, end.y);
    let endPoint = geometryFactory.createPoint(endCoordinate);
    if (!this.polygon.covers(endPoint)) {
      const endNear = DistanceOp.nearestPoints(this.polygon, endPoint)[0];
      endResult.unshift(new Vector(endNear.x, endNear.y));
      endCoordinate = endNear;
      endPoint = geometryFactory.createPoint(endCoordinate);
    }
    const endPolygon = this.skeletonTree.nearestNeighbour(
      new Envelope(endCoordinate),
      { geometry: endPoint },
      this.skeletonTreeItemDistance,
    );
    let endEdge = endPolygon.edges[0];
    let minEndEdgeDistance = endPolygon.edges[0].lineSegment.distance(endCoordinate);
    for (let i = 1; i < endPolygon.edges.length; i++) {
      const currEndEdgeDistance = endPolygon.edges[i].lineSegment.distance(endCoordinate);
      if (currEndEdgeDistance < minEndEdgeDistance) {
        endEdge = endPolygon.edges[i];
        minEndEdgeDistance = currEndEdgeDistance;
      }
    }
    const endEdgeProjection = endEdge.lineSegment.closestPoint(endCoordinate);
    endResult.unshift(new Vector(endEdgeProjection.x, endEdgeProjection.y));

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
        const point = this.travelGraph.node(p);
        result.push(new Vector(point.getX(), point.getY()));
      }
    }
    result.push(...endResult);

    return result;
  }
}
