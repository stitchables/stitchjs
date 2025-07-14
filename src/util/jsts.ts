import {
  GeometryFactory,
  Geometry,
  IntersectionMatrix,
  Point,
  Coordinate,
} from 'jsts/org/locationtech/jts/geom';
import { RelateOp } from 'jsts/org/locationtech/jts/operation/relate';
import UnionOp from 'jsts/org/locationtech/jts/operation/union/UnionOp';
import UnaryUnionOp from 'jsts/org/locationtech/jts/operation/union/UnaryUnionOp';
import { IsValidOp } from 'jsts/org/locationtech/jts/operation/valid';
import { OverlayOp } from 'jsts/org/locationtech/jts/operation/overlay';
import { BufferOp } from 'jsts/org/locationtech/jts/operation/buffer';
import {
  ConvexHull,
  Centroid,
  InteriorPointPoint,
  InteriorPointLine,
  InteriorPointArea,
} from 'jsts/org/locationtech/jts/algorithm';
import { DistanceOp } from 'jsts/org/locationtech/jts/operation/distance';
import IsSimpleOp from 'jsts/org/locationtech/jts/operation/IsSimpleOp';
import WKTWriter from 'jsts/org/locationtech/jts/io/WKTWriter';

export const geometryFactory = new GeometryFactory();

declare module 'jsts/org/locationtech/jts/geom' {
  export interface Geometry {
    equalsTopo(g: Geometry): boolean;
    equals(g: Geometry): boolean;
    union(g?: Geometry): Geometry;
    isValid(): boolean;
    intersection(other: Geometry): Geometry;
    covers(g: Geometry): boolean;
    coveredBy(g: Geometry): boolean;
    touches(g: Geometry): boolean;
    intersects(g: Geometry): boolean;
    within(g: Geometry): boolean;
    overlaps(g: Geometry): boolean;
    disjoint(g: Geometry): boolean;
    crosses(g: Geometry): boolean;
    buffer(distance: number, quadrantSegments?: number, endCapStyle?: string): Geometry;
    convexHull(): ConvexHull;
    relate(geometry: Geometry, intersectionPattern?: string): IntersectionMatrix;
    getCentroid(): Point;
    getInteriorPoint(): Point;
    symDifference(other: Geometry): Geometry;
    createPointFromInternalCoord(coord: Coordinate, exemplar: Geometry): Point;
    toText(): string;
    toString(): string;
    contains(g: Geometry): boolean;
    difference(other: Geometry): Geometry;
    isSimple(): boolean;
    isWithinDistance(geom: Geometry, distance: number): boolean;
    distance(g: Geometry): number;
  }
}

Geometry.prototype.equalsTopo = function (g: Geometry): boolean {
  return RelateOp.equalsTopo(this, g);
};
Geometry.prototype.equals = function (g: Geometry): boolean {
  if (g === null) return false;
  return RelateOp.equalsTopo(this, g);
};
Geometry.prototype.union = function (g?: Geometry): Geometry {
  return g ? UnionOp.union(this, g) : UnaryUnionOp.union(this);
};
Geometry.prototype.isValid = function (): boolean {
  return IsValidOp.isValid(this);
};
Geometry.prototype.intersection = function (other: Geometry): Geometry {
  return OverlayOp.intersection(this, other);
};
Geometry.prototype.covers = function (g: Geometry): boolean {
  return RelateOp.covers(this, g);
};
Geometry.prototype.coveredBy = function (g: Geometry): boolean {
  return RelateOp.covers(g, this);
};
Geometry.prototype.touches = function (g: Geometry): boolean {
  return RelateOp.touches(this, g);
};
Geometry.prototype.intersects = function (g: Geometry): boolean {
  return RelateOp.intersects(this, g);
};
Geometry.prototype.within = function (g: Geometry): boolean {
  return RelateOp.contains(g, this);
};
Geometry.prototype.overlaps = function (g: Geometry): boolean {
  return RelateOp.overlaps(this, g);
};
Geometry.prototype.disjoint = function (g: Geometry): boolean {
  return RelateOp.disjoint(this, g);
};
Geometry.prototype.crosses = function (g: Geometry): boolean {
  return RelateOp.crosses(this, g);
};
Geometry.prototype.buffer = function (
  distance: number,
  quadrantSegments?: number,
  endCapStyle?: string,
): Geometry {
  if (!quadrantSegments) return BufferOp.bufferOp(this, distance);
  else if (!endCapStyle) return BufferOp.bufferOp(this, distance, quadrantSegments);
  else return BufferOp.bufferOp(this, distance, quadrantSegments, endCapStyle);
};
Geometry.prototype.convexHull = function (): ConvexHull {
  return new ConvexHull(this).getConvexHull();
};
Geometry.prototype.relate = function (
  geometry: Geometry,
  intersectionPattern?: string,
): IntersectionMatrix {
  if (!intersectionPattern) return RelateOp.relate(this, geometry);
  else return RelateOp.relate(this, geometry).matches(intersectionPattern);
};
Geometry.prototype.getCentroid = function (): Point {
  // @ts-ignore
  if (this.isEmpty()) return geometryFactory.createPoint();
  const centPt = Centroid.getCentroid(this);
  return this.createPointFromInternalCoord(centPt, this);
};
Geometry.prototype.getInteriorPoint = function () {
  // @ts-ignore
  if (this.isEmpty()) return this.geometryFactory.createPoint();
  let intPt = null;
  // @ts-ignore
  const dim = this.getDimension();
  if (dim === 0) intPt = new InteriorPointPoint(this);
  else if (dim === 1) intPt = new InteriorPointLine(this);
  else intPt = new InteriorPointArea(this);

  const interiorPt = intPt.getInteriorPoint();
  return this.createPointFromInternalCoord(interiorPt, this);
};
Geometry.prototype.symDifference = function (other: Geometry): Geometry {
  return OverlayOp.symDifference(this, other);
};
Geometry.prototype.createPointFromInternalCoord = function (
  coord: Coordinate,
  exemplar: Geometry,
): Point {
  exemplar.getPrecisionModel().makePrecise(coord);
  return exemplar.getFactory().createPoint(coord);
};
Geometry.prototype.toText = function () {
  const writer = new WKTWriter(geometryFactory);
  return writer.write(this);
};
Geometry.prototype.toString = function () {
  return this.toText();
};
Geometry.prototype.contains = function (g: Geometry): boolean {
  return RelateOp.contains(this, g);
};
Geometry.prototype.difference = function (other: Geometry): Geometry {
  return OverlayOp.difference(this, other);
};
Geometry.prototype.isSimple = function (): boolean {
  const op = new IsSimpleOp(this);
  return op.isSimple();
};
Geometry.prototype.isWithinDistance = function (
  geom: Geometry,
  distance: number,
): boolean {
  const envDist = this.getEnvelopeInternal().distance(geom.getEnvelopeInternal());
  if (envDist > distance) return false;
  return DistanceOp.isWithinDistance(this, geom, distance);
};
Geometry.prototype.distance = function (g: Geometry): number {
  return DistanceOp.distance(this, g);
};
