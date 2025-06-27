import { Browser } from './Browser';
import { Core } from './Core';
import { CSG } from './CSG';
import { Graphics } from './Graphics';
import { IO } from './IO';
import { Math } from './Math';
import { Optimize } from './Optimize';

import { GeometryFactory, Geometry } from 'jsts/org/locationtech/jts/geom';
import { ConvexHull } from 'jsts/org/locationtech/jts/algorithm';
import { DistanceOp } from 'jsts/org/locationtech/jts/operation/distance';
import WKTWriter from 'jsts/org/locationtech/jts/io/WKTWriter';

export const geometryFactory = new GeometryFactory();

declare module 'jsts/org/locationtech/jts/geom' {
  export interface Geometry {
    distance(g: Geometry): number;
    convexHull(): ConvexHull;
    isWithinDistance(geom: Geometry, distance: number): boolean;
    toText(): string;
    toString(): string;
  }
}
Geometry.prototype.distance = function (g: Geometry): number {
  return DistanceOp.distance(this, g);
};
Geometry.prototype.convexHull = function (): ConvexHull {
  return new ConvexHull(this).getConvexHull();
};
Geometry.prototype.isWithinDistance = function (
  geom: Geometry,
  distance: number,
): boolean {
  const envDist = this.getEnvelopeInternal().distance(geom.getEnvelopeInternal());
  if (envDist > distance) return false;
  return DistanceOp.isWithinDistance(this, geom, distance);
};
Geometry.prototype.toText = function () {
  const writer = new WKTWriter(geometryFactory);
  return writer.write(this);
};
Geometry.prototype.toString = function () {
  return this.toText();
};

export { Browser, Core, CSG, Graphics, IO, Math, Optimize };
