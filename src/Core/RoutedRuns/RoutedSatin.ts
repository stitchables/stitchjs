import { IRoutedRun } from './IRoutedRun';
import { Vector } from '../../Math/Vector';
import { Stitch } from '../Stitch';
import { Coordinate, Polygon } from 'jsts/org/locationtech/jts/geom';
import CascadedPolygonUnion from 'jsts/org/locationtech/jts/operation/union/CascadedPolygonUnion';
import Arrays from 'jsts/java/util/Arrays';
import { geometryFactory } from '../../util/jsts';
import { ClassicSatin, SatinSplitOptions } from '../Runs/ClassicSatin';

interface UnderlayOptions {
  stitchLengthMm?: number;
  stitchToleranceMm?: number;
  travelLengthMm?: number;
  travelToleranceMm?: number;
  densityMm?: number;
  capInsetMm?: number;
  sideInsetMm?: number;
}

export class RoutedSatin implements IRoutedRun {
  quadStripVertices: Vector[];
  densityMm: number;
  travelLengthMm: number;
  travelToleranceMm: number;
  split: SatinSplitOptions | undefined;
  underlays: {
    type: string;
    options?: UnderlayOptions;
  }[];
  shape: Polygon | undefined;
  routeAsHole: boolean;
  constructor(
    quadStripVertices: Vector[],
    options?: {
      densityMm?: number;
      travelLengthMm?: number;
      travelToleranceMm?: number;
      split?: SatinSplitOptions;
      underlays?: {
        type: string;
        options?: UnderlayOptions;
      }[];
      routeAsHole?: boolean;
    },
  ) {
    this.quadStripVertices = quadStripVertices;
    this.densityMm = options?.densityMm ?? 0.2;
    this.travelLengthMm = options?.travelLengthMm ?? 3;
    this.travelToleranceMm = options?.travelToleranceMm ?? 0.1;
    this.split = options?.split;
    this.underlays = options?.underlays ?? [];
    this.routeAsHole = options?.routeAsHole ?? true;
  }

  getShape(): Polygon {
    function makeTriangle(a: Vector, b: Vector, c: Vector, epsArea = 1e-9) {
      // reject degenerate/zero-area triangles (collinear or duplicate points)
      const area2 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(area2) < epsArea) return null;
      const ring = geometryFactory.createLinearRing([
        new Coordinate(a.x, a.y),
        new Coordinate(b.x, b.y),
        new Coordinate(c.x, c.y),
        new Coordinate(a.x, a.y),
      ]);
      return geometryFactory.createPolygon(ring, []);
    }
    const triangles: Polygon[] = [];
    for (let i = 0; i + 3 < this.quadStripVertices.length; i += 2) {
      const l0 = this.quadStripVertices[i];
      const r0 = this.quadStripVertices[i + 1];
      const l1 = this.quadStripVertices[i + 2];
      const r1 = this.quadStripVertices[i + 3];
      // one consistent diagonal (L0-R1) — never needs bowtie detection,
      // both halves are triangles and thus always simple
      const t1 = makeTriangle(l0, r0, r1);
      const t2 = makeTriangle(l0, r1, l1);
      if (t1) triangles.push(t1);
      if (t2) triangles.push(t2);
    }
    if (triangles.length === 0) return geometryFactory.createPolygon();
    return CascadedPolygonUnion.union(Arrays.asList(triangles));
  }

  getUnderlayRuns(pixelsPerMm: number): IRoutedRun[] {
    return [];
  }

  getUnderlayStitches(
    pixelsPerMm: number,
    access?: { entry?: Coordinate; exit?: Coordinate },
  ): Stitch[] {
    return [];
  }

  getStitches(
    pixelsPerMm: number,
    access?: { entry?: Coordinate; exit?: Coordinate },
  ): Stitch[] {
    const options = {
      startPosition: access?.entry ? Vector.fromObject(access.entry) : undefined,
      endPosition: access?.exit ? Vector.fromObject(access.exit) : undefined,
      densityMm: this.densityMm,
      travelLengthMm: this.travelLengthMm,
      travelToleranceMm: this.travelToleranceMm,
      split: this.split,
    };
    const classicSatin = new ClassicSatin(this.quadStripVertices, options);
    return classicSatin.getStitches(pixelsPerMm);
  }
}
