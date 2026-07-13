import { IRun } from '../IRun';
import { Vector } from '../../Math/Vector';
import {
  Coordinate,
  LineString,
  MultiLineString,
  PrecisionModel,
} from 'jsts/org/locationtech/jts/geom';
import GeometryNoder from 'jsts/org/locationtech/jts/noding/snapround/GeometryNoder';
import ItemBoundable from 'jsts/org/locationtech/jts/index/strtree/ItemBoundable';
import LineMergeGraph from 'jsts/org/locationtech/jts/operation/linemerge/LineMergeGraph';
import ConnectedSubgraphFinder from 'jsts/org/locationtech/jts/planargraph/algorithm/ConnectedSubgraphFinder';
import Densifier from 'jsts/org/locationtech/jts/densify/Densifier';
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp';
import Arrays from 'jsts/java/util/Arrays';
import { Stitch } from '../Stitch';
import * as graphlib from '@dagrejs/graphlib';
import { geometryFactory } from '../../util/jsts';
import { resample } from '../../Geometry/resample';
import { StitchType } from '../EStitchType';
import { geometryMst } from '../../Geometry/geometryMst';

export class Redwork implements IRun {
  stitchLengthMm: number;
  stitchToleranceMm: number;
  route: { type: 'STITCH' | 'JUMP'; line: LineString }[];
  constructor(
    lines: Vector[][],
    options?: {
      entry?: Vector;
      stitchLengthMm?: number;
      stitchToleranceMm?: number;
      densifyDistancePx?: number;
      precisionModelScale?: number;
    },
  ) {
    this.stitchLengthMm = options?.stitchLengthMm ?? 3;
    this.stitchToleranceMm = options?.stitchToleranceMm ?? 0.1;

    // densify the original line work to ensure there are always "close" jumping points
    const toCoord = (v: Vector) => new Coordinate(v.x, v.y);
    const toLineString = (vs: Vector[]) => {
      return geometryFactory.createLineString(vs.map(toCoord));
    };
    const denseLines = lines
      .map((l) => {
        return Densifier.densify(toLineString(l), options?.densifyDistancePx || 10);
      })
      .filter((l: LineString) => l.getLength() > 0);

    // node the original lines - splits lines where they intersect
    const precisionModel = new PrecisionModel(options?.precisionModelScale || 10);
    const geometryNoder = new GeometryNoder(precisionModel);
    const nodeLines = geometryNoder.node(Arrays.asList(denseLines));

    // create a graph from the nodelines - set the user data for lookup later
    const lineMergeGraph = new LineMergeGraph();
    for (let i = 0, it = nodeLines.iterator(); it.hasNext(); i++) {
      const nodeLine = it.next();
      nodeLine.setUserData(i);
      lineMergeGraph.addEdge(nodeLine);
    }

    // find the connected components
    const geometryComponents: MultiLineString[] = [];
    const componentFinder = new ConnectedSubgraphFinder(lineMergeGraph);
    const components = componentFinder.getConnectedSubgraphs();
    for (let it = components.iterator(); it.hasNext(); ) {
      const lineComponents = [];
      for (let jt = it.next().edgeIterator(); jt.hasNext(); ) {
        lineComponents.push(jt.next().getLine());
      }
      geometryComponents.push(geometryFactory.createMultiLineString(lineComponents));
    }

    // calculate the minimum jumps necessary to connect all components
    const jumps = geometryMst(geometryComponents);

    // collect the split points created by the jumps
    const splits: Record<number, Set<number>> = [];
    for (const { a, b } of jumps.edges) {
      const ai = a.location.getGeometryComponent().getUserData();
      const as = a.location.getSegmentIndex();
      if (as > 0) {
        if (!(ai in splits)) splits[ai] = new Set<number>();
        splits[ai].add(as);
      }
      const bi = b.location.getGeometryComponent().getUserData();
      const bs = b.location.getSegmentIndex();
      if (bs > 0) {
        if (!(bi in splits)) splits[bi] = new Set<number>();
        splits[bi].add(bs);
      }
    }

    // get the root node - add split if necessary
    let root = nodeLines.iterator().next().getStartPoint().toString();
    if (options?.entry) {
      const entryCoordinate = new Coordinate(options.entry.x, options.entry.y);
      const entryPoint = geometryFactory.createPoint(entryCoordinate);
      const { geom } = jumps.componentTree.nearestNeighbour(
        entryPoint.getEnvelopeInternal(),
        { geom: entryPoint },
        {
          distance(item1: ItemBoundable, item2: ItemBoundable) {
            if (item1 === item2) return Number.MAX_VALUE;
            return item1.getItem().geom.distance(item2.getItem().geom);
          },
        },
      );
      const distanceOp = new DistanceOp(geom, entryPoint);
      const [location, _] = distanceOp.nearestLocations();
      const line = location.getGeometryComponent();
      const lineIndex = line.getUserData();
      const sequenceIndex = location.getSegmentIndex();
      if (sequenceIndex > 0) {
        if (!(lineIndex in splits)) splits[lineIndex] = new Set<number>();
        splits[lineIndex].add(sequenceIndex);
      }
      root = line.getPointN(sequenceIndex).toString();
    }

    // prepare the route graph
    type routeEdge = { type: 'STITCH' | 'JUMP'; line: LineString };
    const routeGraph = new graphlib.Graph<null, null, routeEdge>({ multigraph: true });
    const toSubLine = (line: LineString, start: number, end: number) => {
      const coordinates = line.getCoordinates().slice(start, end + 1);
      return geometryFactory.createLineString(coordinates);
    };
    for (let i = 0, it = nodeLines.iterator(); it.hasNext(); i++) {
      const line = it.next();
      if (!(i in splits)) {
        const startNode = line.getStartPoint().toString();
        const endNode = line.getEndPoint().toString();
        routeGraph.setNode(startNode);
        routeGraph.setNode(endNode);
        routeGraph.setEdge(startNode, endNode, { type: 'STITCH', line }, `${i},forward`);
        routeGraph.setEdge(
          endNode,
          startNode,
          { type: 'STITCH', line: line.reverse() },
          `${i},backward`,
        );
      } else {
        const splitIndices = [...splits[i]].sort((a, b) => a - b);
        splitIndices.push(line.getNumPoints() - 1);
        let [startIndex, startNode] = [0, line.getPointN(0).toString()];
        for (const endIndex of splitIndices) {
          const endNode = line.getPointN(endIndex).toString();
          routeGraph.setNode(startNode);
          routeGraph.setNode(endNode);
          const subLine = toSubLine(line, startIndex, endIndex);
          routeGraph.setEdge(
            startNode,
            endNode,
            { type: 'STITCH', line: subLine },
            `${i},forward`,
          );
          routeGraph.setEdge(
            endNode,
            startNode,
            { type: 'STITCH', line: subLine.reverse() },
            `${i},backward`,
          );
          [startIndex, startNode] = [endIndex, endNode];
        }
      }
    }

    // add the jumps to the route graph
    for (const { a, b } of jumps.edges) {
      const pa = a.location
        .getGeometryComponent()
        .getPointN(a.location.getSegmentIndex());
      const pb = b.location
        .getGeometryComponent()
        .getPointN(b.location.getSegmentIndex());
      const ca = pa.getCoordinate();
      const cb = pb.getCoordinate();
      const forward = geometryFactory.createLineString([ca, cb]);
      const backward = geometryFactory.createLineString([cb, ca]);
      routeGraph.setEdge(
        pa.toString(),
        pb.toString(),
        { type: 'JUMP', line: forward },
        'forward',
      );
      routeGraph.setEdge(
        pb.toString(),
        pa.toString(),
        { type: 'JUMP', line: backward },
        'backward',
      );
    }

    // build an eulerian circuit - Hierholzer's algorithm
    const edgeKey = (e: graphlib.Edge) => `${e.v},${e.w},${e.name ?? ''}`;
    const unused = new Set(routeGraph.edges().map((e) => edgeKey(e)));
    const out = new Map<string, graphlib.Edge[]>();
    for (const e of routeGraph.edges()) {
      if (!out.has(e.v)) out.set(e.v, []);
      out.get(e.v)!.push(e);
    }
    const stack: { node: string; edge?: graphlib.Edge }[] = [{ node: root }];
    const circuit: routeEdge[] = [];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const edges = out.get(top.node) ?? [];
      let e: graphlib.Edge | undefined;
      while (edges.length) {
        const candidate = edges.pop()!;
        if (unused.delete(edgeKey(candidate))) {
          e = candidate;
          break;
        }
      }
      if (e) stack.push({ node: e.w, edge: e });
      else {
        const popped = stack.pop()!;
        if (popped.edge) circuit.push(routeGraph.edge(popped.edge));
      }
    }
    circuit.reverse();

    // compose the final route - combining consecutive stitch lines
    this.route = [];
    let run = [];
    for (const { type, line } of circuit) {
      if (type === 'JUMP') {
        if (run.length > 1)
          this.route.push({
            type: 'STITCH',
            line: geometryFactory.createLineString(run),
          });
        run = [];
        this.route.push({ type, line });
      } else {
        run.push(...line.getCoordinates().slice(0, -1));
      }
    }
    if (run.length > 1) {
      this.route.push({ type: 'STITCH', line: geometryFactory.createLineString(run) });
    }
  }

  getStitches(pixelsPerMm: number): Stitch[] {
    const lengthPx = this.stitchLengthMm * pixelsPerMm;
    const tolerancePx = this.stitchToleranceMm * pixelsPerMm;
    const stitches = [];
    for (const { type, line } of this.route) {
      if (type === 'STITCH') {
        const resampled = resample(line, lengthPx, tolerancePx);
        for (const c of resampled.getCoordinates()) {
          stitches.push(new Stitch(new Vector(c.x, c.y), StitchType.NORMAL));
        }
      } else {
        const c = line.getCoordinateN(0);
        stitches.push(new Stitch(new Vector(c.x, c.y), StitchType.JUMP));
      }
    }
    return stitches;
  }
}
