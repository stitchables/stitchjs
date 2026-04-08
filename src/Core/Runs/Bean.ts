import { Coordinate, LineString, Point } from 'jsts/org/locationtech/jts/geom';
import { LocationIndexedLine } from 'jsts/org/locationtech/jts/linearref';
import { IRun } from '../IRun';
import { Vector } from '../../Math/Vector';
import { Stitch } from '../Stitch';
import { StitchType } from '../EStitchType';
import { geometryFactory } from '../../util/jsts';
import * as graphlib from '@dagrejs/graphlib';
import { resample } from '../../Geometry/resample';

export class Bean implements IRun {
  line: LineString;
  entry: Coordinate;
  exit: Coordinate;
  repeatsPattern: number[];
  stitchLengthMm: number;
  stitchToleranceMm: number;
  constructor(
    vertices: Vector[],
    entry: Vector,
    exit: Vector,
    options?: {
      repeatsPattern?: number[];
      stitchLengthMm?: number;
      stitchToleranceMm?: number;
    },
  ) {
    const coordinates = vertices.map((v) => new Coordinate(v.x, v.y));
    this.line = geometryFactory.createLineString(coordinates);
    this.entry = new Coordinate(entry.x, entry.y);
    this.exit = new Coordinate(exit.x, exit.y);
    this.repeatsPattern = options?.repeatsPattern ?? [2];
    this.stitchLengthMm = options?.stitchLengthMm ?? 3;
    this.stitchToleranceMm = options?.stitchToleranceMm ?? 0.1;
  }

  getStitches(pixelsPerMm: number): Stitch[] {
    const stitchLengthPx = this.stitchLengthMm * pixelsPerMm;
    const stitchTolerancePx = this.stitchToleranceMm * pixelsPerMm;
    const resampledLine = resample(this.line, stitchLengthPx, stitchTolerancePx);
    const locationIndex = new LocationIndexedLine(resampledLine);
    const entryLocation = locationIndex.project(this.entry);
    const exitLocation = locationIndex.project(this.exit);
    const entryIndex =
      entryLocation.getSegmentIndex() +
      (entryLocation.getSegmentFraction() < 0.5 ? 0 : 1);
    const exitIndex =
      exitLocation.getSegmentIndex() + (exitLocation.getSegmentFraction() < 0.5 ? 0 : 1);
    const entryNode = resampledLine.getCoordinateN(entryIndex).toString();
    const exitNode = resampledLine.getCoordinateN(exitIndex).toString();
    const graph = new graphlib.Graph<string, Coordinate, number>({
      directed: false,
      multigraph: true,
    });
    let prevCoord = null;
    let prevNode = null;
    for (let i = 0; i < resampledLine.getNumPoints(); i++) {
      const currCoord = resampledLine.getCoordinateN(i);
      const currNode = currCoord.toString();
      graph.setNode(currNode, currCoord);
      if (prevCoord && prevNode) {
        const repeats = this.repeatsPattern[(i - 1) % this.repeatsPattern.length];
        const weight = prevCoord.distance(currCoord);
        for (let j = 0; j < 2 * Math.max(repeats, 1); j++) {
          graph.setEdge(prevNode, currNode, weight, j.toString());
        }
      }
      prevCoord = currCoord;
      prevNode = currNode;
    }
    if (entryNode !== exitNode) {
      const dijkstra = graphlib.alg.dijkstra(
        graph,
        entryNode,
        (e) => graph.edge(e) || 1,
        (v) => graph.nodeEdges(v) || [],
      );
      if (dijkstra[exitNode] !== null && dijkstra[exitNode].distance < Infinity) {
        let curr = exitNode;
        while (curr !== entryNode) {
          const prev = dijkstra[curr].predecessor;
          graph.setEdge(prev, curr, graph.edge(prev, curr, '0'), `extra`);
          curr = prev;
        }
      }
    }
    const stitches = [];
    const used = new Set<string>();
    const stack: Array<{ node: string; via?: graphlib.Edge }> = [{ node: entryNode }];
    const edgeKey = (e: graphlib.Edge): string => `${e.v}__${e.w}__${e.name ?? ''}`;
    const otherEndpoint = (e: graphlib.Edge, node: string): string => {
      if (e.v === node && e.w === node) return node;
      if (e.v === node) return e.w;
      if (e.w === node) return e.v;
      throw new Error(`Edge ${edgeKey(e)} is not incident to node ${node}`);
    };
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const incident = graph.nodeEdges(top.node)!;
      let nextEdge: graphlib.Edge | undefined;
      for (const candidate of incident) {
        if (used.has(edgeKey(candidate))) continue;
        nextEdge = candidate;
        if (top.via) {
          if (top.via.v === nextEdge.v && top.via.w === nextEdge.w) break;
          if (top.via.v === nextEdge.w && top.via.w === nextEdge.v) break;
        } else {
          break;
        }
      }
      if (nextEdge) {
        used.add(edgeKey(nextEdge));
        const nextNode = otherEndpoint(nextEdge, top.node);
        stack.push({ node: nextNode, via: nextEdge });
      } else {
        const p = graph.node(stack.pop()!.node);
        stitches.push(new Stitch(new Vector(p.x, p.y), StitchType.NORMAL));
      }
    }
    stitches.reverse();
    return stitches;
  }
}
