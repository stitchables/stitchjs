import { IRun } from '../IRun';
import { Vector } from '../../Math/Vector';
import { Coordinate, LineString, PrecisionModel } from 'jsts/org/locationtech/jts/geom';
import GeometryNoder from 'jsts/org/locationtech/jts/noding/snapround/GeometryNoder';
import ItemBoundable from 'jsts/org/locationtech/jts/index/strtree/ItemBoundable';
import ItemDistance from 'jsts/org/locationtech/jts/index/strtree/ItemDistance';
import { STRtree } from 'jsts/org/locationtech/jts/index/strtree';
import LineMergeGraph from 'jsts/org/locationtech/jts/operation/linemerge/LineMergeGraph';
import ConnectedSubgraphFinder from 'jsts/org/locationtech/jts/planargraph/algorithm/ConnectedSubgraphFinder';
import Densifier from 'jsts/org/locationtech/jts/densify/Densifier';
import Arrays from 'jsts/java/util/Arrays';
import { Stitch } from '../Stitch';
import * as graphlib from '@dagrejs/graphlib';
import { geometryFactory } from '../../util/jsts';
import DisjointSet from '../../Optimize/DisjointSet';
import { resample } from '../../Geometry/resample';
import { StitchType } from '../EStitchType';

class DisjointSetItemDistance {
  disjointSet: DisjointSet;
  connections: Record<string, { distance: number; p: any; q: any }>;
  constructor(nodeIds: string[]) {
    this.disjointSet = new DisjointSet(nodeIds);
    this.connections = {};
  }
  getConnectionId(id1: string, id2: string) {
    return id1.localeCompare(id2) < 0 ? `${id1},${id2}` : `${id2},${id1}`;
  }
  updateConnection(id1: string, id2: string, distance: number, p: any, q: any) {
    const id = this.getConnectionId(id1, id2);
    if (distance < this.connections[id]?.distance || Infinity) {
      this.connections[id] = { distance, p, q };
    }
  }
  distance(item1: ItemBoundable, item2: ItemBoundable) {
    if (item1 === item2) return Number.MAX_VALUE;
    const i1: { id: string; pointTree: STRtree } = item1.getItem();
    const i2: { id: string; pointTree: STRtree } = item2.getItem();
    const parent1 = this.disjointSet.find(i1.id);
    const parent2 = this.disjointSet.find(i2.id);
    if (parent1 === parent2) return Number.MAX_VALUE;
    const [p, q] = i1.pointTree.nearestNeighbour(i2.pointTree, {
      distance(item1: ItemBoundable, item2: ItemBoundable) {
        return item1.getItem().point.distance(item2.getItem().point);
      },
    });
    const distance = p.point.distance(q.point);
    this.updateConnection(i1.id, i2.id, distance, p, q);
    return p.point.distance(q.point);
  }
  get interfaces_() {
    return [ItemDistance];
  }
}

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
    const denseLines = lines.map((l) => {
      return Densifier.densify(toLineString(l), options?.densifyDistancePx || 10);
    });

    // node the original lines - splits lines where they intersect
    const geometryNoder = new GeometryNoder(
      new PrecisionModel(options?.precisionModelScale || 10),
    );
    const nodeLines = geometryNoder.node(Arrays.asList(denseLines));

    // create a graph from the nodelines - set the user data for lookup later
    const lineMergeGraph = new LineMergeGraph();
    for (let i = 0, it = nodeLines.iterator(); it.hasNext(); i++) {
      const nodeLine = it.next();
      nodeLine.setUserData(i);
      lineMergeGraph.addEdge(nodeLine);
    }

    // find the connected components
    const componentFinder = new ConnectedSubgraphFinder(lineMergeGraph);
    const components = componentFinder.getConnectedSubgraphs();

    const componentTreeIds = [];
    const componentTree = new STRtree();
    for (let i = 0, it = components.iterator(); it.hasNext(); i++) {
      const component = it.next();
      const points = [];
      const pointTree = new STRtree();
      for (let jt = component.nodeIterator(); jt.hasNext(); ) {
        const point = geometryFactory.createPoint(jt.next().getCoordinate());
        points.push(point);
        const pointLabel = { point, lineIndex: undefined, sequenceIndex: undefined };
        pointTree.insert(point.getEnvelopeInternal(), pointLabel);
      }
      for (let jt = component.edgeIterator(); jt.hasNext(); ) {
        const line = jt.next().getLine();
        const lineIndex = line.getUserData();
        for (let j = 1, n = line.getNumPoints(); j < n - 1; j++) {
          const point = line.getPointN(j);
          points.push(point);
          const pointLabel = { point, lineIndex, sequenceIndex: j };
          pointTree.insert(point.getEnvelopeInternal(), pointLabel);
        }
      }
      pointTree.build();
      const geometry = geometryFactory.createMultiPoint(points);
      const componentLabel = { id: i.toString(), geometry, pointTree };
      componentTreeIds.push(componentLabel.id);
      componentTree.insert(geometry.getEnvelopeInternal(), componentLabel);
    }
    componentTree.build();

    const splits: Record<number, Set<number>> = [];
    const jumps = [];
    const itemDistance = new DisjointSetItemDistance(componentTreeIds);
    while (!itemDistance.disjointSet.isFullyConnected()) {
      const [ca, cb] = componentTree.nearestNeighbour(itemDistance);
      itemDistance.disjointSet.union(ca.id, cb.id);
      const connectionId = itemDistance.getConnectionId(ca.id, cb.id);
      const { p, q } = itemDistance.connections[connectionId];
      if (!(p.lineIndex in splits)) splits[p.lineIndex] = new Set<number>();
      splits[p.lineIndex].add(p.sequenceIndex);
      if (!(q.lineIndex in splits)) splits[q.lineIndex] = new Set<number>();
      splits[q.lineIndex].add(q.sequenceIndex);
      jumps.push({ p1: p.point, p2: q.point });
    }

    // get the root node - add split if necessary
    let root = nodeLines.iterator().next().getStartPoint().toString();
    if (options?.entry) {
      const entryCoordinate = new Coordinate(options.entry.x, options.entry.y);
      const entryPoint = geometryFactory.createPoint(entryCoordinate);
      const component = componentTree.nearestNeighbour(
        entryPoint.getEnvelopeInternal(),
        { geometry: entryPoint },
        {
          distance(item1: ItemBoundable, item2: ItemBoundable) {
            if (item1 === item2) return Number.MAX_VALUE;
            return item1.getItem().geometry.distance(item2.getItem().geometry);
          },
        },
      );
      const { point, lineIndex, sequenceIndex } = component.pointTree.nearestNeighbour(
        entryPoint.getEnvelopeInternal(),
        { point: entryPoint },
        {
          distance(item1: ItemBoundable, item2: ItemBoundable) {
            if (item1 === item2) return Number.MAX_VALUE;
            return item1.getItem().point.distance(item2.getItem().point);
          },
        },
      );
      if (lineIndex !== undefined && sequenceIndex !== undefined) {
        if (!(lineIndex in splits)) splits[lineIndex] = new Set<number>();
        splits[lineIndex].add(sequenceIndex);
      }
      root = point.toString();
    }

    // build the new planar graph with split points and jumps
    type pslgEdge = { type: 'STITCH' | 'JUMP'; line: LineString };
    const pslg = new graphlib.Graph<null, null, pslgEdge>({ multigraph: true });
    const toSubLine = (line: LineString, start: number, end: number) => {
      const coordinates = line.getCoordinates().slice(start, end + 1);
      return geometryFactory.createLineString(coordinates);
    };
    for (let i = 0, it = nodeLines.iterator(); it.hasNext(); i++) {
      const line = it.next();
      if (!(i in splits)) {
        const startNode = line.getStartPoint().toString();
        const endNode = line.getEndPoint().toString();
        pslg.setNode(startNode);
        pslg.setNode(endNode);
        pslg.setEdge(startNode, endNode, { type: 'STITCH', line }, `${i},forward`);
        pslg.setEdge(
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
          pslg.setNode(startNode);
          pslg.setNode(endNode);
          const subLine = toSubLine(line, startIndex, endIndex);
          pslg.setEdge(
            startNode,
            endNode,
            { type: 'STITCH', line: subLine },
            `${i},forward`,
          );
          pslg.setEdge(
            endNode,
            startNode,
            { type: 'STITCH', line: subLine.reverse() },
            `${i},backward`,
          );
          [startIndex, startNode] = [endIndex, endNode];
        }
      }
    }

    // add the jumps
    for (const { p1, p2 } of jumps) {
      const [n1, n2] = [p1.toString(), p2.toString()];
      const [c1, c2] = [p1.getCoordinate(), p2.getCoordinate()];
      const forward = geometryFactory.createLineString([c1, c2]);
      const backward = geometryFactory.createLineString([c2, c1]);
      pslg.setEdge(n1, n2, { type: 'JUMP', line: forward }, 'forward');
      pslg.setEdge(n2, n1, { type: 'JUMP', line: backward }, 'backward');
    }

    // build an eulerian circuit - Hierholzer's algorithm
    const edgeKey = (e: graphlib.Edge) => `${e.v},${e.w},${e.name ?? ''}`;
    const unused = new Set(pslg.edges().map((e) => edgeKey(e)));
    const out = new Map<string, graphlib.Edge[]>();
    for (const e of pslg.edges()) {
      if (!out.has(e.v)) out.set(e.v, []);
      out.get(e.v)!.push(e);
    }
    const stack: { node: string; edge?: graphlib.Edge }[] = [{ node: root }];
    const circuit: pslgEdge[] = [];
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
        if (popped.edge) circuit.push(pslg.edge(popped.edge));
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
        for (const c of line.getCoordinates()) {
          stitches.push(new Stitch(new Vector(c.x, c.y), StitchType.JUMP));
        }
      }
    }
    return stitches;
  }
}
