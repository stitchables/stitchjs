import { IRoutedRun } from './IRoutedRun';
import { Vector } from '../../Math/Vector';
import { Stitch } from '../Stitch';
import { Coordinate, Polygon } from 'jsts/org/locationtech/jts/geom';
import CascadedPolygonUnion from 'jsts/org/locationtech/jts/operation/union/CascadedPolygonUnion';
import ArrayList from 'jsts/java/util/ArrayList';
import { geometryFactory } from '../../util/jsts';
import { ClassicSatin } from '../Runs/ClassicSatin';

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
  underlays: {
    type: string;
    options?: UnderlayOptions;
  }[];
  constructor(
    quadStripVertices: Vector[],
    options?: {
      densityMm?: number;
      travelLengthMm?: number;
      travelToleranceMm?: number;
      underlays?: {
        type: string;
        options?: UnderlayOptions;
      }[];
    },
  ) {
    this.quadStripVertices = quadStripVertices;
    this.densityMm = options?.densityMm ?? 0.2;
    this.travelLengthMm = options?.travelLengthMm ?? 3;
    this.travelToleranceMm = options?.travelToleranceMm ?? 0.1;
    this.underlays = options?.underlays ?? [];
  }

  getShape(): Polygon {
    const toCoord = (v: Vector) => new Coordinate(v.x, v.y);
    // const ringCoords = [];
    // for (let i = 0; i < this.quadStripVertices.length; i += 2) {
    //   ringCoords.push(toCoord(this.quadStripVertices[i]));
    //   ringCoords.unshift(toCoord(this.quadStripVertices[i + 1]));
    // }
    // ringCoords.push(toCoord(this.quadStripVertices[this.quadStripVertices.length - 1]));
    // const polygonizer = new Polygonizer(true);
    // polygonizer.add(geometryFactory.createLinearRing(ringCoords));
    // console.log(polygonizer.getPolygons());
    // // if (polygonizer.getPolygons().toArray().length === 0) return geometryFactory.createLinearRing(ringCoords);
    // return polygonizer.getGeometry();
    const polygonCollection = new ArrayList(0);
    for (let i = 1; i < this.quadStripVertices.length / 2; i++) {
      polygonCollection.add(
        geometryFactory.createPolygon([
          toCoord(this.quadStripVertices[2 * i]),
          toCoord(this.quadStripVertices[2 * i + 1]),
          toCoord(this.quadStripVertices[2 * i - 1]),
          toCoord(this.quadStripVertices[2 * i - 2]),
          toCoord(this.quadStripVertices[2 * i]),
        ]),
      );
    }
    console.log(CascadedPolygonUnion.union(polygonCollection));
    return CascadedPolygonUnion.union(polygonCollection);
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
    };
    const classicSatin = new ClassicSatin(this.quadStripVertices, options);
    return classicSatin.getStitches(pixelsPerMm);
  }
}
