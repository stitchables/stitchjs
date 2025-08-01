import { Utils } from '../../Math/Utils';
import { Vector } from '../../Math/Vector';
import { Stitch } from '../Stitch';
import { geometryFactory } from '../../util/jsts';
import { OverlayOp } from 'jsts/org/locationtech/jts/operation/overlay';
import { Coordinate, LineString } from 'jsts/org/locationtech/jts/geom';
import {
  LengthIndexedLine,
  LocationIndexedLine,
} from 'jsts/org/locationtech/jts/linearref';
import { StitchType } from '../EStitchType';

export class ClassicSatin {
  vertices: Vector[];
  densityMm: number;
  travelLengthMm: number;
  startPosition: Vector;
  endPosition: Vector;
  centerLine: LineString;
  centerIndex: LocationIndexedLine;

  constructor(
    vertices: Vector[],
    densityMm = 0.4,
    travelLengthMm = 3,
    startPosition?: Vector,
    endPosition?: Vector,
  ) {
    this.vertices = vertices;
    this.densityMm = densityMm;
    this.travelLengthMm = travelLengthMm;
    this.centerLine = geometryFactory.createLineString();
    this.centerIndex = new LocationIndexedLine(geometryFactory.createLineString());
    if (this.vertices.length < 4) {
      console.error('ClassicSatin Run requires at least 4 vertices...');
      this.startPosition = startPosition || new Vector(0, 0);
      this.endPosition = endPosition || new Vector(0, 0);
    } else {
      this.startPosition = startPosition || this.vertices[0];
      this.endPosition = endPosition || this.vertices[this.vertices.length - 1];
      const coords = [];
      for (let i = 0; i < this.vertices.length; i += 2) {
        const [left, right] = [this.vertices[i], this.vertices[i + 1]];
        const center = left.lerp(right, 0.5);
        coords.push(new Coordinate(center.x, center.y));
      }
      this.centerLine = geometryFactory.createLineString(coords);
      this.centerIndex = new LocationIndexedLine(this.centerLine);
    }
  }

  getFullSatin(pixelsPerMm: number): [LineString, LineString] {
    const lengthIndex = new LengthIndexedLine(this.centerLine);
    const stepSize =
      this.centerLine.getLength() /
      Math.round(this.centerLine.getLength() / (this.densityMm * pixelsPerMm));
    let currLength = stepSize;
    const satinCoords: Coordinate[] = [];
    const centerCoords: Coordinate[] = [];

    let left, right, center;
    left = this.vertices[0];
    right = this.vertices[1];
    center = left.lerp(right, 0.5);
    centerCoords.push(new Coordinate(center.x, center.y));
    satinCoords.push(new Coordinate(left.x, left.y));
    satinCoords.push(new Coordinate(right.x, right.y));

    while (currLength < this.centerLine.getLength() - 0.5 * stepSize) {
      center = lengthIndex.extractPoint(currLength);
      const location = this.centerIndex.indexOf(center);
      const index = location.getSegmentIndex();
      const fraction = location.getSegmentFraction();
      left = this.vertices[2 * index].lerp(this.vertices[2 * (index + 1)], fraction);
      right = this.vertices[2 * index + 1].lerp(
        this.vertices[2 * (index + 1) + 1],
        fraction,
      );
      centerCoords.push(center);
      satinCoords.push(new Coordinate(left.x, left.y));
      satinCoords.push(new Coordinate(right.x, right.y));
      currLength += stepSize;
    }
    left = this.vertices[this.vertices.length - 2];
    right = this.vertices[this.vertices.length - 1];
    center = left.lerp(right, 0.5);
    centerCoords.push(new Coordinate(center.x, center.y));
    satinCoords.push(new Coordinate(left.x, left.y));
    satinCoords.push(new Coordinate(right.x, right.y));

    return [
      geometryFactory.createLineString(satinCoords),
      geometryFactory.createLineString(centerCoords),
    ];
  }

  getTravelStitches(
    line: LineString,
    fromIndex: number,
    toIndex: number,
    pixelsPerMm: number,
  ): Stitch[] {
    const travelStitches: Stitch[] = [];
    if (Math.abs(fromIndex - toIndex) <= 1) return travelStitches;

    const fromCross = geometryFactory
      .createLineString([
        line.getCoordinateN(fromIndex),
        line.getCoordinateN(fromIndex + (fromIndex > toIndex ? -1 : 1)),
      ])
      .buffer(0.01);
    const fromCenterLocation = this.centerIndex.project(
      OverlayOp.intersection(this.centerLine, fromCross).getCoordinate(),
    );
    const toCross = geometryFactory
      .createLineString([
        line.getCoordinateN(toIndex),
        line.getCoordinateN(toIndex + (fromIndex > toIndex ? 1 : -1)),
      ])
      .buffer(0.01);
    const toCenterLocation = this.centerIndex.project(
      OverlayOp.intersection(this.centerLine, toCross).getCoordinate(),
    );
    const centerTravel: LineString = this.centerIndex.extractLine(
      fromCenterLocation,
      toCenterLocation,
    );
    const centerTravelIndex = new LengthIndexedLine(centerTravel);
    const centerTravelLength = centerTravel.getLength();
    const countSegments = Math.round(
      centerTravelLength / (this.travelLengthMm * pixelsPerMm),
    );
    for (let i = 0; i < countSegments - 1; i++) {
      const currLength = Utils.map(i + 1, 0, countSegments, 0, centerTravelLength);
      const currPoint = centerTravelIndex.extractPoint(currLength);
      travelStitches.push(
        new Stitch(new Vector(currPoint.x, currPoint.y), StitchType.TRAVEL),
      );
    }
    return travelStitches;
  }

  getSatinStitches(fullSatin: LineString, fromIndex: number, toIndex: number): Stitch[] {
    const satinStitches: Stitch[] = [];
    for (
      let i = fromIndex;
      fromIndex <= toIndex ? i <= toIndex : i >= toIndex;
      fromIndex <= toIndex ? i++ : i--
    ) {
      satinStitches.push(
        new Stitch(Vector.fromObject(fullSatin.getCoordinateN(i)), StitchType.NORMAL),
      );
    }
    return satinStitches;
  }

  getStitches(pixelsPerMm: number): Stitch[] {
    const stitches = [] as Stitch[];
    if (this.vertices.length < 4) {
      console.error('ClassicSatin Run requires at least 4 vertices...');
      return stitches;
    }
    const [fullSatin, _] = this.getFullSatin(pixelsPerMm);
    const locationIndex = new LocationIndexedLine(fullSatin);
    const startCoord = new Coordinate(this.startPosition.x, this.startPosition.y);
    const startLocation = locationIndex.project(startCoord);
    const startIndex =
      startLocation.getSegmentFraction() < 0.5
        ? startLocation.getSegmentIndex()
        : startLocation.getSegmentIndex() + 1;
    const endCoord = new Coordinate(this.endPosition.x, this.endPosition.y);
    const endLocation = locationIndex.project(endCoord);
    const endIndex =
      endLocation.getSegmentFraction() < 0.5
        ? endLocation.getSegmentIndex()
        : endLocation.getSegmentIndex() + 1;
    const cut1 = startIndex < endIndex ? 0 : fullSatin.getNumPoints() - 1;
    const cut2 = startIndex < endIndex ? fullSatin.getNumPoints() - 1 : 0;
    stitches.push(new Stitch(this.startPosition, StitchType.START));
    const firstSatin = fullSatin.getCoordinateN(startIndex);
    if (this.startPosition.distance(Vector.fromObject(firstSatin)) > pixelsPerMm) {
      stitches.push(new Stitch(new Vector(firstSatin.x, firstSatin.y), StitchType.JUMP));
    }
    stitches.push(...this.getTravelStitches(fullSatin, startIndex, cut1, pixelsPerMm));
    stitches.push(...this.getSatinStitches(fullSatin, cut1, endIndex));
    stitches.push(...this.getTravelStitches(fullSatin, endIndex, cut2, pixelsPerMm));
    stitches.push(...this.getSatinStitches(fullSatin, cut2, endIndex));
    const lastSatin = fullSatin.getCoordinateN(endIndex);
    if (this.endPosition.distance(Vector.fromObject(lastSatin)) > pixelsPerMm) {
      stitches.push(new Stitch(this.endPosition, StitchType.JUMP));
    }
    return stitches;
  }
}
