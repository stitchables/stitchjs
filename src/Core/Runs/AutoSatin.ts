import { IRun } from '../IRun';
import { ClassicSatin } from './ClassicSatin';
import { Vector } from '../../Math/Vector';
import { Stitch } from '../Stitch';
import * as graphlib from 'graphlib';
import { Coordinate, Point } from 'jsts/org/locationtech/jts/geom';
import { DistanceOp } from 'jsts/org/locationtech/jts/operation/distance';
import { LocationIndexedLine } from 'jsts/org/locationtech/jts/linearref';
import { STRtree } from 'jsts/org/locationtech/jts/index/strtree';
import ItemDistance from 'jsts/org/locationtech/jts/index/strtree/ItemDistance';
import ItemBoundable from 'jsts/org/locationtech/jts/index/strtree/ItemBoundable';
import { geometryFactory } from '../../util/jsts';
import { StitchType } from '../EStitchType';
import MinPriorityQueue from '../../Optimize/MinPriorityQueue';

class CustomItemDistance {
  distance(item1: ItemBoundable, item2: ItemBoundable) {
    if (item1 === item2) return Number.MAX_VALUE;
    const g1 = item1.getItem().point;
    const g2 = item2.getItem().point;
    return g1.distance(g2);
  }
  get interfaces_() {
    return [ItemDistance];
  }
}

export class AutoSatin implements IRun {
  satinRuns: ClassicSatin[];
  startPosition: Vector;
  endPosition: Vector;

  constructor(satinRuns: ClassicSatin[], startPosition?: Vector, endPosition?: Vector) {
    this.satinRuns = [];
    for (let classicSatin of satinRuns) {
      if (classicSatin.quadStripVertices.length >= 4) {
        this.satinRuns.push(classicSatin);
      }
    }
    if (this.satinRuns.length > 0) {
      this.startPosition = startPosition || this.satinRuns[0].quadStripVertices[0];
      this.endPosition =
        endPosition ||
        this.satinRuns[this.satinRuns.length - 1].quadStripVertices[
          this.satinRuns[this.satinRuns.length - 1].quadStripVertices.length - 1
        ];
    } else {
      console.error('No valid classic satin runs found...');
      this.startPosition = startPosition || new Vector(0, 0);
      this.endPosition = endPosition || new Vector(0, 0);
    }
  }

  getStitches(pixelsPerMm: number): Stitch[] {
    const stitches: Stitch[] = [];

    if (this.satinRuns.length === 0) {
      return stitches;
    }

    const itemDistance = new CustomItemDistance();

    const startPoint = geometryFactory.createPoint(
      new Coordinate(this.startPosition.x, this.startPosition.y),
    );
    const startEnvelope = startPoint.getEnvelopeInternal();
    const endPoint = geometryFactory.createPoint(
      new Coordinate(this.endPosition.x, this.endPosition.y),
    );
    const endEnvelope = endPoint.getEnvelopeInternal();

    let [startNode, endNode] = ['', ''];
    let [startMinDist, endMinDist] = [Infinity, Infinity];
    const graph = new graphlib.Graph({ directed: false });
    const componentGraph = new graphlib.Graph({ directed: false });
    for (let i = 0; i < this.satinRuns.length; i++) {
      const satin = this.satinRuns[i].getFullSatin(pixelsPerMm);
      const centerCoords: Coordinate[] = [];
      for (let i = 0; i < 0.5 * satin.getNumPoints(); i++) {
        const left = satin.getCoordinateN(2 * i);
        const right = satin.getCoordinateN(2 * i + 1);
        centerCoords.push(
          new Coordinate(0.5 * (left.x + right.x), 0.5 * (left.y + right.y)),
        );
      }
      const center = geometryFactory.createLineString(centerCoords);
      const locationIndex = new LocationIndexedLine(satin);
      const strTree = new STRtree();
      let curr = satin.getPointN(0);
      graph.setNode(`${i},0`, { satinIndex: i, pointIndex: 0, point: curr });
      strTree.insert(curr.getEnvelopeInternal(), { point: curr, node: `${i},0` });
      for (let j = 1, k = 0; j < satin.getNumPoints(); j++, k++) {
        curr = satin.getPointN(j);
        const prev = satin.getPointN(k);
        const weight = curr.distance(prev);
        graph.setNode(`${i},${j}`, { satinIndex: i, pointIndex: j, point: curr });
        strTree.insert(curr.getEnvelopeInternal(), { point: curr, node: `${i},${j}` });
        graph.setEdge(`${i},${j}`, `${i},${k}`, { isJump: false, weight });
      }
      strTree.build();

      const startNeighbor = strTree.nearestNeighbour(
        startEnvelope,
        { point: startPoint },
        itemDistance,
      );
      const startDistance = DistanceOp.distance(startNeighbor.point, startPoint);
      if (startDistance < startMinDist) {
        startNode = startNeighbor.node;
        startMinDist = startDistance;
      }
      const endNeighbor = strTree.nearestNeighbour(
        endEnvelope,
        { point: endPoint },
        itemDistance,
      );
      const endDistance = DistanceOp.distance(endNeighbor.point, endPoint);
      if (endDistance < endMinDist) {
        endNode = endNeighbor.node;
        endMinDist = endDistance;
      }

      componentGraph.setNode(`${i}`, { satin, center, locationIndex, strTree });
      for (let j = 0; j < i; j++) {
        const prevTree = componentGraph.node(`${j}`).strTree;
        const [p, q]: { point: Point; node: string }[] = strTree.nearestNeighbour(
          prevTree,
          itemDistance,
        );
        const weight = DistanceOp.distance(p.point, q.point);
        componentGraph.setEdge(`${i}`, `${j}`, { p: p.node, q: q.node, weight });
      }
    }

    const mst = graphlib.alg.prim(componentGraph, (e) => componentGraph.edge(e).weight);
    for (const edge of mst.edges()) {
      const edgeLabel = componentGraph.edge(edge);
      graph.setEdge(edgeLabel.p, edgeLabel.q, {
        isJump: true,
        weight: edgeLabel.weight,
      });
    }

    const path = this.findPath(graph, startNode, endNode);

    stitches.push(new Stitch(this.startPosition, StitchType.START));
    let curr = graph.node(path[0][0]);
    stitches.push(
      new Stitch(new Vector(curr.point.getX(), curr.point.getY()), StitchType.JUMP),
    );
    for (let [from, to, type] of path) {
      const prev = graph.node(from);
      curr = graph.node(to);
      if (type === StitchType.TRAVEL) {
        // stitches.push(
        //   ...this.satinRuns[prev.satinIndex].getTravelStitches(
        //     componentGraph.node(prev.satinIndex).satin,
        //     prev.pointIndex,
        //     curr.pointIndex,
        //     pixelsPerMm,
        //   ),
        // );
      } else {
        stitches.push(new Stitch(new Vector(curr.point.getX(), curr.point.getY()), type));
      }
    }
    stitches.push(new Stitch(this.endPosition, StitchType.JUMP));

    return stitches;
  }

  findPath(
    graph: graphlib.Graph,
    startNode: string,
    endNode: string,
  ): [string, string, StitchType][] {
    const shortestPath = this.aStar(graph, startNode, endNode);
    if (!shortestPath) return [];
    const g = new graphlib.Graph({ directed: false });
    for (const node of graph.nodes()) g.setNode(node, graph.node(node));
    for (const edge of graph.edges()) g.setEdge(edge, graph.edge(edge));
    for (let i = 1; i < shortestPath.length; i++) {
      for (const edge of g.nodeEdges(shortestPath[i - 1], shortestPath[i]) || []) {
        g.removeEdge(edge);
      }
    }
    const path: [string, string, StitchType][] = [];
    let prev = null;
    for (const node of shortestPath) {
      if (prev !== null) {
        const prevEdges = graph.nodeEdges(prev, node) || [];
        if (prevEdges.length > 0 && graph.edge(prevEdges[0]).isJump) {
          path.push([prev, node, StitchType.JUMP]);
        } else {
          path.push([prev, node, StitchType.NORMAL]);
        }
      }
      prev = node;
      for (const [from, to, type] of dfsLabeledEdges(g, node)) {
        const edges = graph.nodeEdges(from, to) || [];
        if (from === to || edges.length === 0) continue;
        const stitchType = graph.edge(edges[0]).isJump
          ? StitchType.JUMP
          : StitchType.NORMAL;
        if (type === 'forward') {
          path.push([from, to, stitchType]);
          g.removeEdge(edges[0]);
        } else if (type === 'reverse') {
          path.push([to, from, stitchType]);
        } else if (type === 'nontree') {
          path.push([from, to, stitchType]);
          path.push([to, from, stitchType]);
          g.removeEdge(edges[0]);
        }
      }
    }
    const seen = new Set();
    for (let i = path.length - 1; i >= 0; i--) {
      const [from, to, type] = path[i];
      const [fromLabel, toLabel] = [graph.node(from), graph.node(to)];
      if (type === StitchType.NORMAL && fromLabel.satinIndex === toLabel.satinIndex) {
        const key =
          fromLabel.pointIndex > toLabel.pointIndex ? `${to}-${from}` : `${from}-${to}`;
        if (seen.has(key)) {
          path[i][2] = StitchType.TRAVEL;
        } else {
          seen.add(key);
        }
      }
    }
    for (let i = path.length - 1; i >= 1; i--) {
      if (path[i - 1][2] === StitchType.TRAVEL && path[i][2] === StitchType.TRAVEL) {
        path[i - 1][1] = path[i][1];
        path.splice(i, 1);
      }
    }
    return path;
  }

  aStar(graph: graphlib.Graph, startNode: string, endNode: string): string[] | null {
    const gScore = new Map();
    const fScore = new Map();
    const cameFrom = new Map();
    const openSet = new MinPriorityQueue();

    graph.nodes().forEach((n) => {
      gScore.set(n, Infinity);
      fScore.set(n, Infinity);
    });
    gScore.set(startNode, 0);
    fScore.set(
      startNode,
      graph.node(startNode).point.distance(graph.node(endNode).point),
    );

    openSet.enqueue({ node: startNode, priority: fScore.get(startNode) });

    while (!openSet.isEmpty()) {
      const { node: u } = openSet.dequeue();
      if (u === endNode) {
        // reconstruct path
        const path = [];
        let cur = endNode;
        while (cur) {
          path.unshift(cur);
          cur = cameFrom.get(cur);
        }
        return path;
      }

      for (const v of graph.neighbors(u) || []) {
        const nodeEdge = graph.nodeEdges(u, v);
        if (nodeEdge) {
          const weight = graph.edge(nodeEdge[0]).weight; // get the edge weight
          const tentativeG = gScore.get(u) + weight;
          if (tentativeG < gScore.get(v)) {
            cameFrom.set(v, u);
            gScore.set(v, tentativeG);
            const f =
              tentativeG + graph.node(v).point.distance(graph.node(endNode).point);
            fScore.set(v, f);
            openSet.enqueue({ node: v, priority: f });
          }
        }
      }
    }
    return null;
  }
}

type EdgeLabel = 'forward' | 'nontree' | 'reverse' | 'reverse-depth_limit';
type DfsEdge = [string, string, EdgeLabel];
function* dfsLabeledEdges<Node>(
  G: graphlib.Graph,
  source?: string,
  depthLimit?: number,
  sortNeighbors?: (nodes: string[]) => string[],
): Generator<DfsEdge> {
  const visited = new Set<string>();
  const getChildren = (n: string): Iterator<string> => {
    const neighbors = G.neighbors(n) ?? [];
    const sorted = sortNeighbors ? sortNeighbors(neighbors) : neighbors;
    return sorted[Symbol.iterator]();
  };

  const nodes = source === undefined ? G.nodes() : [source];
  if (depthLimit === undefined) depthLimit = G.nodeCount();

  for (const start of nodes) {
    if (visited.has(start)) continue;

    yield [start, start, 'forward'];
    visited.add(start);
    const stack: [string, Iterator<string>][] = [[start, getChildren(start)]];
    let depthNow = 1;

    while (stack.length > 0) {
      const [parent, children] = stack[stack.length - 1];
      const next = children.next();

      if (!next.done) {
        const child = next.value;
        if (visited.has(child)) {
          yield [parent, child, 'nontree'];
        } else {
          yield [parent, child, 'forward'];
          visited.add(child);

          if (depthNow < depthLimit) {
            stack.push([child, getChildren(child)]);
            depthNow += 1;
          } else {
            yield [parent, child, 'reverse-depth_limit'];
          }
        }
      } else {
        stack.pop();
        depthNow -= 1;
        if (stack.length > 0) {
          yield [stack[stack.length - 1][0], parent, 'reverse'];
        }
      }
    }

    yield [start, start, 'reverse'];
  }
}
