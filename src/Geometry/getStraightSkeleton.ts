import { LinearRing, Polygon } from 'jsts/org/locationtech/jts/geom';
import Orientation from 'jsts/org/locationtech/jts/algorithm/Orientation';
import { SkeletonBuilder } from 'straight-skeleton';
import { isInitialized } from '../index';

function polygonToNumberArray(polygon: Polygon): number[][][] {
  const ringToArray = (ring: LinearRing, orientation: string): number[][] => {
    const coords = ring.getCoordinates();
    const isCCW = Orientation.isCCW(coords);
    if ((orientation === 'CCW' && !isCCW) || (orientation === 'CW' && isCCW)) {
      coords.reverse();
    }
    const out: number[][] = new Array(coords.length);
    for (let i = 0; i < coords.length; i++) {
      out[i] = [coords[i].x, coords[i].y];
    }
    return out;
  };
  const result: number[][][] = [];
  result.push(ringToArray(polygon.getExteriorRing(), 'CCW'));
  for (let i = 0; i < polygon.getNumInteriorRing(); i++) {
    result.push(ringToArray(polygon.getInteriorRingN(i), 'CW'));
  }
  return result;
}

export function getStraightSkeleton(polygon: Polygon) {
  if (!isInitialized)
    throw new Error(
      "StraightSkeleton has not been initialized. Call 'await Stitch.init()' first.",
    );
  return SkeletonBuilder.buildFromPolygon(polygonToNumberArray(polygon));
}
