import { IRoutedRun } from './IRoutedRun';
import { Vector } from '../../Math/Vector';
import { Stitch } from '../Stitch';
import { Coordinate, Polygon } from 'jsts/org/locationtech/jts/geom';
import { SatinSplitOptions, UnderlayOptions } from '../Runs/ClassicSatin';
import { RoutedSatin } from './RoutedSatin';

export class RoutedCalligraphySatin implements IRoutedRun {
  routedSatin: RoutedSatin;
  routeAsHole: boolean;
  constructor(
    centerLine: Vector[],
    options?: {
      angle?: number;
      widthPx?: number;
      densityMm?: number;
      travelLengthMm?: number;
      travelToleranceMm?: number;
      split?: SatinSplitOptions;
      underlays?: { type: string; options?: UnderlayOptions }[];
      routeAsHole?: boolean;
    },
  ) {
    const angle = options?.angle ?? 0;
    const widthPx = options?.widthPx ?? 18;
    const offset = Vector.fromAngle(angle).multiply(widthPx);
    const quadStripVertices = [];
    for (const v of centerLine) {
      quadStripVertices.push(v.add(offset));
      quadStripVertices.push(v.subtract(offset));
    }
    this.routedSatin = new RoutedSatin(quadStripVertices, {
      densityMm: options?.densityMm ?? 0.2,
      travelLengthMm: options?.travelLengthMm ?? 3,
      travelToleranceMm: options?.travelToleranceMm ?? 1,
      split: options?.split,
      underlays: options?.underlays ?? [],
    });
    this.routeAsHole = options?.routeAsHole ?? true;
  }

  getShape(): Polygon {
    return this.routedSatin.getShape();
  }

  getUnderlayRuns(pixelsPerMm: number): IRoutedRun[] {
    return this.routedSatin.getUnderlayRuns(pixelsPerMm);
  }

  getUnderlayStitches(
    pixelsPerMm: number,
    access?: { entry?: Coordinate; exit?: Coordinate },
  ): Stitch[] {
    return this.routedSatin.getUnderlayStitches(pixelsPerMm, access);
  }

  getStitches(
    pixelsPerMm: number,
    access?: { entry?: Coordinate; exit?: Coordinate },
  ): Stitch[] {
    return this.routedSatin.getStitches(pixelsPerMm, access);
  }
}
