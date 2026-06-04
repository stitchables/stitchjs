import { IRoutedRun } from './IRoutedRun';
import { Vector } from '../../Math/Vector';
import { Coordinate, Point, Polygon } from 'jsts/org/locationtech/jts/geom';
import PolygonExtracter from 'jsts/org/locationtech/jts/geom/util/PolygonExtracter';
import { geometryFactory } from '../../util/jsts';
import { Stitch } from '../Stitch';
import { AutoFill } from '../Runs/AutoFill';
import { Polyline } from '../../Math/Polyline';
import { AutoRoute } from './AutoRoute';
import { createPolygon } from '../../Geometry/createPolygon';

interface UnderlayParams {
  insetMm?: number;
  angle?: number;
  rowSpacingMm?: number;
  stitchLengthMm?: number;
  travelLengthMm?: number;
  travelToleranceMm?: number;
}

export class RoutedFill implements IRoutedRun {
  shell: Vector[];
  holes?: Vector[][];
  polygon: Polygon;
  angle: number;
  rowSpacingMm: number;
  stitchLengthMm: number;
  travelLengthMm: number;
  travelToleranceMm: number;
  centerPoint: Point;
  fillPattern: { rowOffsetMm: number; rowPatternMm: number[] }[];
  underPath: boolean;
  underlays: UnderlayParams[];

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
    this.centerPoint = geometryFactory.createPoint();
    this.fillPattern = options?.fillPattern ?? [
      { rowOffsetMm: 0, rowPatternMm: [this.stitchLengthMm] },
      { rowOffsetMm: 0.33 * this.stitchLengthMm, rowPatternMm: [this.stitchLengthMm] },
      { rowOffsetMm: 0.66 * this.stitchLengthMm, rowPatternMm: [this.stitchLengthMm] },
    ];
    this.underPath = options?.underPath ?? true;
    this.underlays = options?.underlays ?? [];
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
    const center = this.polygon.getCentroid();
    const fill = new AutoFill(
      Polyline.fromObjects(this.shell, true),
      this.holes?.map((h) => Polyline.fromObjects(h, true)) ?? [],
      this.angle,
      this.rowSpacingMm,
      this.fillPattern,
      this.travelLengthMm,
      new Vector(options?.entry?.x ?? 0, options?.entry?.y ?? 0),
      new Vector(options?.exit?.x ?? 0, options?.exit?.y ?? 0),
      new Vector(center.getX(), center.getY()),
      this.underPath,
    );
    return fill.getStitches(pixelsPerMm);
  }
}
