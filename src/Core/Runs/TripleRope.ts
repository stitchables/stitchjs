import { IRun } from '../IRun';
import { Vector } from '../../Math/Vector';
import { Run } from './Run';
import { Stitch } from '../Stitch';
import { StitchType } from '../EStitchType';

export class TripleRope implements IRun {
  run: Run;
  ropeRun: Run;
  widthMm: number;
  constructor(
    vertices: Vector[],
    options?: {
      widthMm?: number;
      startPosition?: Vector;
      endPosition?: Vector;
      stitchLengthMm?: number;
      stitchToleranceMm?: number;
      travelLengthMm?: number;
      travelToleranceMm?: number;
    },
  ) {
    this.run = new Run(vertices, options);
    this.ropeRun = new Run(vertices, {
      ...options,
      ...{ startPosition: vertices[0], endPosition: vertices[vertices.length - 1] },
    });
    this.widthMm = options?.widthMm ?? 0.4;
  }

  getNormal(prev: Vector | undefined, curr: Vector, next: Vector | undefined): Vector {
    if (prev === undefined && next !== undefined) return next.subtract(curr).normalized();
    if (prev !== undefined && next === undefined) return curr.subtract(prev).normalized();
    if (prev === undefined || next === undefined) return new Vector(0, 0);
    if (Math.abs(curr.subtract(prev).cross(next.subtract(prev))) <= 0.00001)
      return curr.subtract(prev).normalized();
    return curr
      .subtract(prev)
      .normalized()
      .add(next.subtract(curr).normalized())
      .normalized();
  }

  getStitches(pixelsPerMm: number): Stitch[] {
    const stitches: Stitch[] = [];

    const [start, end] = this.run.getStartAndEndPositions(
      this.run.line,
      this.run.lineIndex,
    );
    const startProjLength = this.run.lineIndex.project(start);
    const startProjCoord = this.run.lineIndex.extractPoint(startProjLength);
    const endProjLength = this.run.lineIndex.project(end);
    const endProjCoord = this.run.lineIndex.extractPoint(endProjLength);
    const travelLengthPx = this.run.travelLengthMm * pixelsPerMm;
    const travelTolerancePx = this.run.travelToleranceMm * pixelsPerMm;

    stitches.push(new Stitch(new Vector(start.x, start.y), StitchType.START));

    // if necessary jump from start to start projection
    if (start.distance(startProjCoord) > pixelsPerMm) {
      console.log('start jump');
      const startProjVec = new Vector(startProjCoord.x, startProjCoord.y);
      stitches.push(new Stitch(startProjVec, StitchType.JUMP));
    }

    // if necessary travel from start projection to the end of the rope
    const startExtract = this.run.lineIndex.extractLine(
      startProjLength,
      this.run.line.getLength(),
    );
    if (
      startExtract.getLength() > this.run.travelLengthMm * pixelsPerMm &&
      startExtract.getNumPoints() > 1
    ) {
      console.log('start travel');
      const startTravel = this.run.evenRunLine(
        startExtract,
        travelLengthPx,
        travelTolerancePx,
      );
      for (let i = 1, n = startTravel.getNumPoints(); i < n; i++) {
        const coord = startTravel.getCoordinateN(i);
        stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.TRAVEL));
      }
    }

    // travel from the end of the rope to the beginning of the rope
    const mainExtract = this.run.lineIndex.extractLine(this.run.line.getLength(), 0);
    const mainTravel = this.run.evenRunLine(
      mainExtract,
      travelLengthPx,
      travelTolerancePx,
    );
    for (let i = 1, n = mainTravel.getNumPoints(); i < n; i++) {
      const coord = mainTravel.getCoordinateN(i);
      stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.TRAVEL));
    }

    const ropeStitches = this.ropeRun
      .getStitches(pixelsPerMm)
      .filter((s) => s.stitchType === StitchType.NORMAL)
      .map((s) => s.position);
    const leftRope: Stitch[] = [];
    const rightRope: Stitch[] = [];
    for (let i = 0; i < ropeStitches.length; i++) {
      const prev = ropeStitches[i - 1] ?? undefined;
      const curr = ropeStitches[i];
      const next = ropeStitches[i + 1] ?? undefined;
      const normal = this.getNormal(prev, curr, next)
        .rotate(0.5 * Math.PI)
        .multiply(this.widthMm * pixelsPerMm);
      if (i % 2 === 0) {
        leftRope.push(new Stitch(curr.add(normal), StitchType.NORMAL));
        rightRope.push(new Stitch(curr.subtract(normal), StitchType.NORMAL));
      } else {
        rightRope.push(new Stitch(curr.add(normal), StitchType.NORMAL));
        leftRope.push(new Stitch(curr.subtract(normal), StitchType.NORMAL));
      }
    }
    rightRope.reverse();
    stitches.push(...leftRope, ...rightRope);

    // if necessary travel from beginning of the rope to the endProjection
    const endExtract = this.run.lineIndex.extractLine(0, endProjLength);
    if (
      endExtract.getLength() > this.run.travelLengthMm * pixelsPerMm &&
      endExtract.getNumPoints() > 1
    ) {
      console.log('end travel');
      const endTravel = this.run.evenRunLine(
        endExtract,
        travelLengthPx,
        travelTolerancePx,
      );
      for (let i = 1, n = endTravel.getNumPoints(); i < n; i++) {
        const coord = endTravel.getCoordinateN(i);
        stitches.push(new Stitch(new Vector(coord.x, coord.y), StitchType.TRAVEL));
      }
    }

    // if necessary jump from end projection to end
    if (end.distance(endProjCoord) > pixelsPerMm) {
      console.log('end jump');
      stitches.push(new Stitch(new Vector(end.x, end.y), StitchType.JUMP));
    }

    return stitches;
  }
}
