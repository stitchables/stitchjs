import {
  PrecisionModel,
  Point,
  MultiPoint,
  LineString,
  LinearRing,
  MultiLineString,
  Polygon,
  MultiPolygon,
  GeometryCollection,
} from 'jsts/org/locationtech/jts/geom';
import TopologyPreservingSimplifier from 'jsts/org/locationtech/jts/simplify/TopologyPreservingSimplifier';
import GeometryPrecisionReducer from 'jsts/org/locationtech/jts/precision/GeometryPrecisionReducer';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter';
import NavMeshPolygonPathFinder from './NavMeshPolygonPathFinder';
import { SkeletonPolygonPathFinder } from './SkeletonPolygonPathFinder';
import MATPolygonPathFinder from './MATPolygonPathFinder';
import { geometryFactory } from '../util/jsts';

export type PathFinderGeometry =
  | Point
  | LineString
  | LinearRing
  | Polygon
  | GeometryCollection
  | MultiPoint
  | MultiLineString
  | MultiPolygon;
export interface IPolygonPathFinder {
  findPath(start: PathFinderGeometry, end: PathFinderGeometry): LineString;
}

export default class PolygonPathFinder {
  pathFinder: IPolygonPathFinder;
  constructor(polygon: Polygon) {
    const prepPoly = TopologyPreservingSimplifier.simplify(polygon, 1);
    // const prepPoly = GeometryPrecisionReducer.reduce(TopologyPreservingSimplifier.simplify(polygon, 0.1), new PrecisionModel(10));
    const skeletonPathFinder = SkeletonPolygonPathFinder.fromPolygon(prepPoly);
    if (skeletonPathFinder !== undefined) this.pathFinder = skeletonPathFinder;
    else {
      console.log('skeleton failed, falling back to MAT');
      console.log(prepPoly);
      const writer = new GeoJSONWriter();
      console.log(JSON.stringify(writer.write(prepPoly)));
      const matPathFinder = MATPolygonPathFinder.fromPolygon(prepPoly);
      if (matPathFinder instanceof MATPolygonPathFinder) this.pathFinder = matPathFinder;
      else {
        console.log('MAT failed, falling back to NavMesh');
        this.pathFinder = new NavMeshPolygonPathFinder(prepPoly, matPathFinder);
      }
    }
  }
  findPath(start: PathFinderGeometry, end: PathFinderGeometry): LineString {
    return this.pathFinder.findPath(start, end);
  }
}
