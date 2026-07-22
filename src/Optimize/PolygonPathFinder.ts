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

// Building the medial-axis path finder (GVD + spine graph) is expensive, and the
// same polygon is frequently re-wrapped many times within a single stitch plan
// (run boundary, free space, travel corridor, revisited nodes, and across the
// underlay AutoRoute). The underlying MATPolygonPathFinder is immutable after
// construction, so cache and share instances keyed by the normalized geometry.
const MAT_CACHE = new Map<string, IPolygonPathFinder>();
const MAT_CACHE_MAX = 64;

function geometryKey(geometry: Polygon): string {
  const normalized = geometry.copy();
  normalized.normalize();
  return normalized.toText();
}

export default class PolygonPathFinder {
  pathFinder: IPolygonPathFinder;
  constructor(polygon: Polygon) {
    const prepPoly = TopologyPreservingSimplifier.simplify(polygon, 1) as Polygon;
    const key = geometryKey(prepPoly);
    const cached = MAT_CACHE.get(key);
    if (cached !== undefined) {
      // refresh recency for the simple LRU below
      MAT_CACHE.delete(key);
      MAT_CACHE.set(key, cached);
      this.pathFinder = cached;
      return;
    }
    this.pathFinder = new MATPolygonPathFinder(prepPoly);
    MAT_CACHE.set(key, this.pathFinder);
    if (MAT_CACHE.size > MAT_CACHE_MAX) {
      const oldest = MAT_CACHE.keys().next().value;
      if (oldest !== undefined) MAT_CACHE.delete(oldest);
    }
    // const prepPoly = GeometryPrecisionReducer.reduce(TopologyPreservingSimplifier.simplify(polygon, 0.1), new PrecisionModel(10));
    // const skeletonPathFinder = SkeletonPolygonPathFinder.fromPolygon(prepPoly);
    // if (skeletonPathFinder !== undefined) this.pathFinder = skeletonPathFinder;
    // else {
    //   console.log('skeleton failed, falling back to MAT');
    //   console.log(prepPoly);
    //   const writer = new GeoJSONWriter();
    //   console.log(JSON.stringify(writer.write(prepPoly)));
    //   const matPathFinder = new MATPolygonPathFinder(prepPoly);
    //   if (matPathFinder instanceof MATPolygonPathFinder) this.pathFinder = matPathFinder;
    //   else {
    //     console.log('MAT failed, falling back to NavMesh');
    //     this.pathFinder = new NavMeshPolygonPathFinder(prepPoly, matPathFinder);
    //   }
    // }
  }
  findPath(start: PathFinderGeometry, end: PathFinderGeometry): LineString {
    return this.pathFinder.findPath(start, end);
  }
}
