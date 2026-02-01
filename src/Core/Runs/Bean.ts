import { IRun } from '../IRun';
import { Vector } from '../../Math/Vector';
import { Run } from './Run';
import { Stitch } from '../Stitch';
import { StitchType } from '../EStitchType';

export class Bean implements IRun {
  run: Run;
  repeatsPattern: number[];
  constructor(
    vertices: Vector[],
    options?: {
      repeatsPattern?: number[];
      startPosition?: Vector;
      endPosition?: Vector;
      stitchLengthMm?: number;
      stitchToleranceMm?: number;
      travelLengthMm?: number;
      travelToleranceMm?: number;
    },
  ) {
    this.run = new Run(vertices, {
      ...options,
      ...{ startPosition: vertices[0], endPosition: vertices[vertices.length - 1] },
    });
    this.repeatsPattern = options?.repeatsPattern ?? [1];
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
      const startProjVec = new Vector(startProjCoord.x, startProjCoord.y);
      stitches.push(new Stitch(startProjVec, StitchType.JUMP));
    }

    // if necessary travel from start projection to the beginning of the rope
    const startExtract = this.run.lineIndex.extractLine(
      startProjLength,
      this.run.line.getLength(),
    );
    if (
      startExtract.getLength() > this.run.travelLengthMm * pixelsPerMm &&
      startExtract.getNumPoints() > 1
    ) {
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

    const runStitches = this.run
      .getStitches(pixelsPerMm)
      .filter((s) => s.stitchType === StitchType.NORMAL)
      .map(s => s.position);
    for (let i = 0; i < runStitches.length - 1; i++) {
      const position = runStitches[i + 1];
      const repeatListPos = i % this.repeatsPattern.length;
      stitches.push(new Stitch(position, StitchType.NORMAL));
      for (let j = 0; j < this.repeatsPattern[repeatListPos]; j++) {
        stitches.push(...stitches.slice(-2).map(s => new Stitch(s.position, StitchType.NORMAL)));
      }
    }

    // if necessary travel from end of the rope to the endProjection
    const endExtract = this.run.lineIndex.extractLine(
      this.run.line.getLength(),
      endProjLength,
    );
    if (
      endExtract.getLength() > this.run.travelLengthMm * pixelsPerMm &&
      endExtract.getNumPoints() > 1
    ) {
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
      stitches.push(new Stitch(new Vector(end.x, end.y), StitchType.JUMP));
    }

    return stitches;
  }
}
