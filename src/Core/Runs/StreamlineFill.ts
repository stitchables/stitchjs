import { IRun } from '../IRun';
import { Vector } from '../../Math/Vector';
import {
  Coordinate,
  Envelope,
  LineString,
  MultiPolygon,
} from 'jsts/org/locationtech/jts/geom';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp';
import LineStringExtracter from 'jsts/org/locationtech/jts/geom/util/LineStringExtracter';
import { Stitch } from '../Stitch';
import { createPolygon } from '../../Geometry/createPolygon';
import { Utils } from '../../Math/Utils';
import { noise } from '../../Math/Noise';
import { geometryFactory } from '../../util/jsts';
import { computeStreamlinesSync } from '@matthewjacobson/ess';
import { Redwork } from './Redwork';

export class StreamlineFill implements IRun {
  polygons: MultiPolygon;
  boundingBox: Envelope;
  entry: Vector | undefined;
  stitchLengthMm: number;
  stitchToleranceMm: number;
  vectorField: (x: number, y: number) => { x: number; y: number };
  separationMm: number;
  testRatioPct: number;
  timeStep: number;
  densifyDistancePx: number | undefined;
  precisionModelScale: number | undefined;
  constructor(
    polygons: { shell: Vector[]; holes?: Vector[][] }[],
    options?: {
      entry?: Vector;
      stitchLengthMm?: number;
      stitchToleranceMm?: number;
      vectorField?: (x: number, y: number) => { x: number; y: number };
      separationMm?: number;
      testRatioPct?: number;
      timeStep?: number;
      densifyDistancePx?: number;
      precisionModelScale?: number;
    },
  ) {
    this.polygons = geometryFactory.createMultiPolygon(
      polygons.map((p) => createPolygon(p.shell, p.holes)),
    );
    this.boundingBox = this.polygons.getEnvelopeInternal();
    this.entry = options?.entry;
    this.stitchLengthMm = options?.stitchLengthMm || 3;
    this.stitchToleranceMm = options?.stitchToleranceMm || 1;
    if (options?.vectorField === undefined) {
      this.vectorField = (x, y) => {
        const angle = Utils.map(
          noise((x + 123456) / 400, (y + 345678) / 400),
          0,
          1,
          0,
          2 * Math.PI,
        );
        const out = new Vector(x, y).rotate(angle);
        return { x: out.x, y: out.y };
      };
    } else this.vectorField = options?.vectorField;
    this.separationMm = options?.separationMm || 5;
    this.testRatioPct = options?.testRatioPct || 0.5;
    this.timeStep = options?.timeStep || 1;
    this.densifyDistancePx = options?.densifyDistancePx;
    this.precisionModelScale = options?.precisionModelScale;
  }

  getStitches(pixelsPerMm: number): Stitch[] {
    const { streamlines } = computeStreamlinesSync({
      vectorField: this.vectorField,
      boundingBox: {
        left: this.boundingBox.getMinX(),
        top: this.boundingBox.getMinY(),
        width: this.boundingBox.getWidth(),
        height: this.boundingBox.getHeight(),
      },
      dSep: this.separationMm * pixelsPerMm,
      dTest: this.testRatioPct * this.separationMm * pixelsPerMm,
      stepSize: this.timeStep,
    });
    const lines = geometryFactory.createMultiLineString(
      streamlines.map((line) => {
        return geometryFactory.createLineString(
          line.points.map((p) => new Coordinate(p.x, p.y)),
        );
      }),
    );
    const maskedLines = OverlayOp.intersection(this.polygons, lines);
    const redwork = new Redwork(
      [
        ...LineStringExtracter.getLines(maskedLines)
          .toArray()
          .map((l: LineString) =>
            l.getCoordinates().map((c: Coordinate) => new Vector(c.x, c.y)),
          ),
        ...LineStringExtracter.getLines(this.polygons.getBoundary())
          .toArray()
          .map((l: LineString) =>
            l.getCoordinates().map((c: Coordinate) => new Vector(c.x, c.y)),
          ),
      ],
      {
        entry: this.entry,
        stitchLengthMm: this.stitchLengthMm,
        stitchToleranceMm: this.stitchToleranceMm,
        densifyDistancePx: this.densifyDistancePx,
        precisionModelScale: this.precisionModelScale,
      },
    );
    return redwork.getStitches(pixelsPerMm);
  }
}
