import { Polygon } from 'jsts/org/locationtech/jts/geom';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter';
import * as str8 from '@matthewjacobson/str8';
import { isInitialized } from '../index';

const writer = new GeoJSONWriter();
export function getStraightSkeleton(polygon: Polygon): (str8.Skeleton | null)[] {
  if (!isInitialized || !str8.isReady()) {
    throw new Error("str8 package is not ready... call 'await Stitch.init()' first.");
  }
  return str8.buildFromGeoJSON(writer.write(polygon));
}
