import { IRoutedRun } from './IRoutedRun';
import { Vector } from '../../Math/Vector';
import { Coordinate, Point, Polygon } from 'jsts/org/locationtech/jts/geom';
import PolygonExtracter from 'jsts/org/locationtech/jts/geom/util/PolygonExtracter';
import { geometryFactory } from '../../util/jsts';
import { Stitch } from '../Stitch';
import { AutoRoute } from './AutoRoute';
import { createPolygon } from '../../Geometry/createPolygon';
import { BCDFill } from '../Runs/BCDFill';

interface UnderlayParams {
  insetMm?: number;
  angle?: number;
  rowSpacingMm?: number;
  stitchLengthMm?: number;
  travelLengthMm?: number;
  travelToleranceMm?: number;
}

type FillGradient = {
  endRowSpacingMm: number;
} & (
  | {
      mode: 'ramp';
      start: number;
      end: number;
    }
  | {
      mode: 'plateau';
      center: number;
      plateauWidth: number;
    }
);

export class RoutedFill implements IRoutedRun {
  shell: Vector[];
  holes?: Vector[][];
  polygon: Polygon;
  angle: number;
  rowSpacingMm: number;
  stitchLengthMm: number;
  travelLengthMm: number;
  travelToleranceMm: number;
  centerPoint: Point | undefined;
  fillPattern: { rowOffsetMm: number; rowPatternMm: number[] }[];
  underPath: boolean;
  underlays: UnderlayParams[];
  gradient: FillGradient | undefined;
  skipLast: boolean;

  constructor(
    polygon: { shell: Vector[]; holes?: Vector[][] },
    options?: {
      angle?: number;
      rowSpacingMm?: number;
      stitchLengthMm?: number;
      travelLengthMm?: number;
      travelToleranceMm?: number;
      centerPosition?: Vector;
      fillPattern?: {
        rowOffsetMm: number;
        rowPatternMm: number[];
      }[];
      underPath?: boolean;
      underlays?: UnderlayParams[];
      gradient?: FillGradient;
      skipLast?: boolean;
    },
  ) {
    this.shell = polygon.shell;
    this.holes = polygon.holes;
    this.polygon = createPolygon(polygon.shell, polygon.holes);
    this.angle = options?.angle ?? 0;
    this.rowSpacingMm = options?.rowSpacingMm ?? 0.2;
    this.stitchLengthMm = options?.stitchLengthMm ?? 3;
    this.travelLengthMm = options?.travelLengthMm ?? 4;
    this.travelToleranceMm = options?.travelToleranceMm ?? 0.1;
    this.centerPoint = options?.centerPosition !== undefined
      ? geometryFactory.createPoint(options.centerPosition.x, options.centerPosition.y)
      : undefined;
    this.fillPattern = options?.fillPattern ?? [
      { rowOffsetMm: 0, rowPatternMm: [this.stitchLengthMm] },
      { rowOffsetMm: 0.33 * this.stitchLengthMm, rowPatternMm: [this.stitchLengthMm] },
      { rowOffsetMm: 0.66 * this.stitchLengthMm, rowPatternMm: [this.stitchLengthMm] },
    ];
    this.underPath = options?.underPath ?? true;
    this.underlays = options?.underlays ?? [];
    this.gradient = options?.gradient;
    this.skipLast = options?.skipLast ?? true;
  }

  getShape(): Polygon {
    return this.polygon;
  }

  getUnderlayAutoRoute(
    pixelsPerMm: number,
    options?: { entry?: Coordinate; exit?: Coordinate },
  ): AutoRoute {
    const underlays: RoutedFill[] = [];
    for (const params of this.underlays) {
      const underlayOptions = {
        insetMm: params.insetMm ?? 0.7,
        angle: params.angle ?? this.angle + 0.5 * Math.PI,
        rowSpacingMm: params.rowSpacingMm ?? 1,
        stitchLengthMm: params.stitchLengthMm ?? 3,
        travelLengthMm: params.travelLengthMm ?? 2.5,
        travelToleranceMm: params.travelToleranceMm ?? 1,
      };
      const buffer = this.polygon.buffer(-underlayOptions.insetMm * pixelsPerMm);
      const insetPolygons = PolygonExtracter.getPolygons(buffer).toArray();
      for (const insetPolygon of insetPolygons) {
        const shell = insetPolygon
          .getExteriorRing()
          .getCoordinates()
          .map((c: Coordinate) => new Vector(c.x, c.y));
        const holes = [];
        for (let i = 0; i < insetPolygon.getNumInteriorRing(); i++) {
          holes.push(
            insetPolygon
              .getInteriorRingN(i)
              .getCoordinates()
              .map((c: Coordinate) => new Vector(c.x, c.y)),
          );
        }
        underlays.push(new RoutedFill({ shell, holes }, underlayOptions));
      }
    }
    const autoRouteOptions = {
      entry: options?.entry ? new Vector(options.entry.x, options.entry.y) : undefined,
      exit: options?.exit ? new Vector(options.exit.x, options.exit.y) : undefined,
      preserveOrder: false,
      globalUnderlay: false,
      travelPolygons: [{ shell: this.shell, holes: this.holes }],
      travelLengthMm: this.travelLengthMm,
      travelToleranceMm: this.travelToleranceMm,
    };
    return new AutoRoute(underlays, autoRouteOptions);
  }

  getUnderlayRuns(pixelsPerMm: number): IRoutedRun[] {
    if (this.underlays.length === 0) return [];
    const underlays: IRoutedRun[] = [];
    for (const params of this.underlays) {
      const underlayOptions = {
        insetMm: params.insetMm ?? 0.7,
        angle: params.angle ?? this.angle + 0.5 * Math.PI,
        rowSpacingMm: params.rowSpacingMm ?? 1,
        stitchLengthMm: params.stitchLengthMm ?? 3,
        travelLengthMm: params.travelLengthMm ?? 2.5,
        travelToleranceMm: params.travelToleranceMm ?? 1,
      };
      const buffer = this.polygon.buffer(-underlayOptions.insetMm * pixelsPerMm);
      const insetPolygons = PolygonExtracter.getPolygons(buffer).toArray();
      for (const insetPolygon of insetPolygons) {
        if (insetPolygon.isEmpty()) continue;
        const shell = insetPolygon
          .getExteriorRing()
          .getCoordinates()
          .map((c: Coordinate) => new Vector(c.x, c.y));
        const holes = [];
        for (let i = 0; i < insetPolygon.getNumInteriorRing(); i++) {
          holes.push(
            insetPolygon
              .getInteriorRingN(i)
              .getCoordinates()
              .map((c: Coordinate) => new Vector(c.x, c.y)),
          );
        }
        underlays.push(new RoutedFill({ shell, holes }, underlayOptions));
      }
    }
    return underlays;
  }

  getUnderlayStitches(
    pixelsPerMm: number,
    options?: { entry?: Coordinate; exit?: Coordinate },
  ): Stitch[] {
    const underlays = this.getUnderlayRuns(pixelsPerMm);
    if (underlays.length === 0) return [];
    const autoRoute = new AutoRoute(underlays, {
      entry: options?.entry ? new Vector(options.entry.x, options.entry.y) : undefined,
      exit: options?.exit ? new Vector(options.exit.x, options.exit.y) : undefined,
      preserveOrder: false,
      travelPolygons: [{ shell: this.shell, holes: this.holes }],
      travelLengthMm: this.travelLengthMm,
      travelToleranceMm: this.travelToleranceMm,
    });
    return autoRoute.getStitches(pixelsPerMm);
  }

  getStitches(
    pixelsPerMm: number,
    options?: { entry?: Coordinate; exit?: Coordinate },
  ): Stitch[] {
    const fill = new BCDFill(
      { shell: this.shell, holes: this.holes },
      {
        entry: options?.entry
          ? new Vector(options?.entry.x, options?.entry.y)
          : undefined,
        exit: options?.entry ? new Vector(options?.entry.x, options?.entry.y) : undefined,
        angle: this.angle,
        rowSpacingMm: this.rowSpacingMm,
        fillPattern: this.fillPattern,
        fillPatternCenterPosition: this.centerPoint ? new Vector(this.centerPoint.getX(), this.centerPoint.getY()) : undefined,
        travelStitchLengthMm: this.travelLengthMm,
        travelStitchToleranceMm: this.travelToleranceMm,
        gradient: this.gradient,
        skipLast: this.skipLast,
        underpath: this.underPath,
      },
    );
    return fill.getStitches(pixelsPerMm);
  }
}
