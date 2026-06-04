import {
  Coordinate,
  LineString,
  LinearRing,
  Polygon,
} from 'jsts/org/locationtech/jts/geom';
import { Stitch } from '../Stitch';
import { IRun } from '../IRun';
import PolygonPathFinder from '../../Optimize/PolygonPathFinder';

export interface IRoutedRun extends IRun {
  getShape: () => Polygon;
  getUnderlayRuns: (pixelsPerMm: number) => IRoutedRun[];
  getUnderlayStitches: (
    pixelsPerMm: number,
    access?: { entry?: Coordinate; exit?: Coordinate },
  ) => Stitch[];
  getStitches: (
    pixelsPerMm: number,
    access?: { entry?: Coordinate; exit?: Coordinate },
  ) => Stitch[];
}
