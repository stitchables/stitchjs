import { Vector } from '../Math/Vector';
import { Coordinate, Polygon } from 'jsts/org/locationtech/jts/geom';
import { geometryFactory } from '../util/jsts';

export function createPolygon(shell: Vector[], holes?: Vector[][]): Polygon {
  const shellCoords = shell.map((v) => new Coordinate(v.x, v.y));
  const shellRing = geometryFactory.createLinearRing(shellCoords);
  if (!holes) return geometryFactory.createPolygon(shellRing);
  const holeRings = holes.map((h) => {
    const holeCoords = h.map((v) => new Coordinate(v.x, v.y));
    return geometryFactory.createLinearRing(holeCoords);
  });
  return geometryFactory.createPolygon(shellRing, holeRings);
}
