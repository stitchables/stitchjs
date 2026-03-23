import { IRun } from '../IRun';
import { IRoutedRun } from '../IRoutedRun';
import * as graphlib from '@dagrejs/graphlib';
import { Point, Coordinate, Polygon } from 'jsts/org/locationtech/jts/geom';
import { DistanceOp } from 'jsts/org/locationtech/jts/operation/distance';
import { STRtree } from 'jsts/org/locationtech/jts/index/strtree';
import ItemBoundable from 'jsts/org/locationtech/jts/index/strtree/ItemBoundable';
import { Stitch } from '../Stitch';
import { Vector } from '../../Math/Vector';
import { geometryFactory } from '../../util/jsts';
import { findPath } from '../../Optimize/findPath';

class CustomItemDistance {
  distance(item1: ItemBoundable, item2: ItemBoundable) {
    if (item1 === item2) return Number.MAX_VALUE;
    const g1 = item1.getItem().point;
    const g2 = item2.getItem().point;
    return g1.distance(g2);
  }
}

export class AutoRoute implements IRun {
  autoRuns: IRoutedRun[];
  polygons: Polygon[];
  componentGraph: graphlib.Graph;
  start: { index: number; point: Point };
  end: { index: number; point: Point };
  constructor(autoRuns: IRoutedRun[], startPosition: Vector, endPosition: Vector) {
    this.autoRuns = [];
    this.polygons = [];
    this.componentGraph = new graphlib.Graph<string, null, number>({ directed: false });
    for (let i = 0; i < autoRuns.length; i++) {
      const run = autoRuns[i];
      const polygon = run.getPolygon();
      this.autoRuns.push(run);
      this.polygons.push(polygon);
      this.componentGraph.setNode(i.toString());
    }

    const startPoint = geometryFactory.createPoint(
      new Coordinate(startPosition.x, startPosition.y),
    );
    const endPoint = geometryFactory.createPoint(
      new Coordinate(endPosition.x, endPosition.y),
    );
    this.start = {
      index: 0,
      point: geometryFactory.createPoint(
        DistanceOp.nearestPoints(this.polygons[0], startPoint)[0],
      ),
    };
    this.end = {
      index: 0,
      point: geometryFactory.createPoint(
        DistanceOp.nearestPoints(this.polygons[0], endPoint)[0],
      ),
    };
    let minStartDist = startPoint.distance(this.start.point);
    let minEndDist = endPoint.distance(this.end.point);
    for (let i = 1; i < this.polygons.length; i++) {
      const start = DistanceOp.nearestPoints(this.polygons[i], startPoint);
      if (start[0].distance(start[1]) < minStartDist) {
        this.start = { index: i, point: geometryFactory.createPoint(start[0]) };
      }
      const end = DistanceOp.nearestPoints(this.polygons[i], endPoint);
      if (end[0].distance(end[1]) < minEndDist) {
        this.end = { index: i, point: geometryFactory.createPoint(end[0]) };
      }
    }

    const potentialJumps = [];
    for (let i = 0; i < this.polygons.length; i++) {
      const u = i.toString();
      const poly1 = this.polygons[i];
      for (let j = i + 1; j < this.polygons.length; j++) {
        const v = j.toString();
        const poly2 = this.polygons[j];
        const [uCoordinate, vCoordinate] = DistanceOp.nearestPoints(poly1, poly2);
        const weight = uCoordinate.distance(vCoordinate);
        potentialJumps.push({ u, v, uCoordinate, vCoordinate, weight });
      }
    }
    const augmentation = this.oneEdgeAugmentation(this.componentGraph, potentialJumps);
    for (const e of augmentation.edges) {
      this.componentGraph.setEdge(e.u, e.v, {
        weight: e.weight,
        uIndex: e.u,
        vIndex: e.v,
        uCoordinate: e.uCoordinate,
        vCoordinate: e.vCoordinate,
      });
    }
  }

  oneEdgeAugmentation(
    graph: graphlib.Graph,
    candidateEdges: {
      u: string;
      v: string;
      uCoordinate: Coordinate;
      vCoordinate: Coordinate;
      weight: number;
    }[],
  ): {
    isPossible: boolean;
    edges: {
      u: string;
      v: string;
      uCoordinate: Coordinate;
      vCoordinate: Coordinate;
      weight: number;
    }[];
  } {
    const g = new graphlib.Graph({ directed: false, multigraph: false, compound: false });
    for (const n of graph.nodes()) g.setNode(n, g.node(n));
    for (const e of graph.edges()) g.setEdge(e.v, e.w, g.edge(e));
    const result: {
      u: string;
      v: string;
      uCoordinate: Coordinate;
      vCoordinate: Coordinate;
      weight: number;
    }[] = [];
    while (true) {
      const components = graphlib.alg.components(g);
      if (components.length <= 1) return { isPossible: true, edges: result };
      let edge: {
        u: string;
        v: string;
        uCoordinate: Coordinate;
        vCoordinate: Coordinate;
        weight: number;
      } | null = null;
      for (let i = 0; i < components.length; i++) {
        for (let j = i + 1; j < components.length; j++) {
          const setA = new Set(components[i]);
          const setB = new Set(components[j]);
          let currEdge: {
            u: string;
            v: string;
            uCoordinate: Coordinate;
            vCoordinate: Coordinate;
            weight: number;
          } | null = null;
          if (candidateEdges.length > 0) {
            for (const e of candidateEdges) {
              const check1 = setA.has(e.u) && setB.has(e.v);
              const check2 = setA.has(e.v) && setB.has(e.u);
              if (!(check1 || check2)) continue;
              if (e.u === e.v) continue;
              if (g.hasEdge(e.u, e.v)) continue;
              if (!currEdge || e.weight < currEdge.weight) currEdge = e;
            }
          }
          if (!currEdge) continue;
          if (!edge || currEdge.weight < edge.weight) edge = currEdge;
        }
      }
      if (!edge) return { isPossible: false, edges: result };
      g.setEdge(edge.u, edge.v);
      result.push(edge);
    }
  }

  findCoveringWalk(graph: graphlib.Graph, S: string, T: string): string[] | null {
    if (graph.isDirected()) {
      throw new Error('This implementation assumes an undirected graph.');
    }
    if (!graph.hasNode(S) || !graph.hasNode(T)) return null;

    const nodes = graph.nodes() as string[];
    if (nodes.length === 0) return null;

    // ---- Step 1: Build a spanning tree rooted from S ----
    const parent = new Map<string, string | null>();
    const children = new Map<string, string[]>();

    for (const v of nodes) children.set(v, []);

    const stack: string[] = [S];
    parent.set(S, null);

    while (stack.length > 0) {
      const v = stack.pop()!;
      const nbrs = (graph.neighbors(v) as string[] | undefined) ?? [];
      for (const u of nbrs) {
        if (!parent.has(u)) {
          parent.set(u, v);
          children.get(v)!.push(u);
          stack.push(u);
        }
      }
    }

    // Graph must be connected (or at least all nodes reachable from S)
    if (parent.size !== nodes.length) {
      return null;
    }

    // ---- Step 2: Recover the unique S->T path in the tree ----
    const pathST: string[] = [];
    {
      let cur: string | null = T;
      while (cur !== null) {
        pathST.push(cur);
        cur = parent.get(cur) ?? null;
      }
      pathST.reverse();

      if (pathST[0] !== S) return null;
    }

    // const onPath = new Set<string>(pathST);

    // Map each path vertex to its next path vertex
    const nextOnPath = new Map<string, string | null>();
    for (let i = 0; i < pathST.length; i++) {
      nextOnPath.set(pathST[i], i + 1 < pathST.length ? pathST[i + 1] : null);
    }

    const walk: string[] = [S];

    function step(to: string) {
      if (walk[walk.length - 1] !== to) {
        walk.push(to);
      }
    }

    /**
     * Fully explore a subtree rooted at v, assuming v is NOT on the S->T path.
     * Start at v and end back at v.
     */
    function exploreOffPathSubtree(v: string): void {
      for (const c of children.get(v) ?? []) {
        step(c);
        exploreOffPathSubtree(c);
        step(v);
      }
    }

    /**
     * Process a path vertex p:
     * - explore every child subtree not on the S->T path, returning to p each time
     * - then move forward to the next path vertex (if any)
     */
    function processPathVertex(p: string): void {
      const next = nextOnPath.get(p) ?? null;

      for (const c of children.get(p) ?? []) {
        if (c === next) continue; // this child continues along the S->T spine

        step(c);
        exploreOffPathSubtree(c);
        step(p);
      }

      if (next !== null) {
        step(next);
        processPathVertex(next);
      }
    }

    processPathVertex(S);

    return walk;
  }

  getStitches(pixelsPerMm: number): Stitch[] {
    const travelData = [];
    for (let i = 0; i < this.componentGraph.nodeCount(); i++) {
      travelData.push(this.autoRuns[i].getTravelData(pixelsPerMm));
    }

    const nodeDistance = new CustomItemDistance();
    function getClosestNodeToPoint(tree: STRtree, point: Point) {
      const envelope = point.getEnvelopeInternal();
      return tree.nearestNeighbour(envelope, { point }, nodeDistance).name;
    }

    const coveringWalk = this.findCoveringWalk(
      this.componentGraph,
      this.start.index.toString(),
      this.end.index.toString(),
    );
    if (!coveringWalk) return [];

    // label the component nodes with the internal start and end nodes
    const path = [
      {
        name: coveringWalk[0],
        startNode: getClosestNodeToPoint(
          travelData[parseInt(coveringWalk[0])].nodeTree,
          this.start.point,
        ),
        endNode: '',
        isLast: false,
      },
    ];
    for (let i = 1; i < coveringWalk.length; i++) {
      const fromNode = coveringWalk[i - 1];
      const toNode = coveringWalk[i];
      const edge = this.componentGraph.edge(fromNode, toNode);
      const isSwitched = edge.uIndex === fromNode;
      const jumpFromPoint = geometryFactory.createPoint(
        isSwitched ? edge.uCoordinate : edge.vCoordinate,
      );
      const jumpToPoint = geometryFactory.createPoint(
        isSwitched ? edge.vCoordinate : edge.uCoordinate,
      );
      path[i - 1].endNode = getClosestNodeToPoint(
        travelData[parseInt(fromNode)].nodeTree,
        jumpFromPoint,
      );
      path.push({
        name: toNode,
        startNode: getClosestNodeToPoint(
          travelData[parseInt(toNode)].nodeTree,
          jumpToPoint,
        ),
        endNode: '',
        isLast: false,
      });
    }
    path[path.length - 1].endNode = getClosestNodeToPoint(
      travelData[parseInt(coveringWalk[coveringWalk.length - 1])].nodeTree,
      this.end.point,
    );

    // label the last time each component is seen in the path
    const seenComponents = new Set<string>();
    for (let i = path.length - 1; i >= 0; i--) {
      if (!seenComponents.has(path[i].name)) {
        path[i].isLast = true;
        seenComponents.add(path[i].name);
      }
    }

    const stitches = [];
    for (let i = 0; i < path.length; i++) {
      if (!path[i].isLast) {
        const travelPath = findPath(
          travelData[parseInt(path[i].name)].graph,
          path[i].startNode,
          path[i].endNode,
          (nodeLabel: any) => nodeLabel.geometry,
          travelData[parseInt(path[i].name)].getEdgeWeight,
        );
        if (travelPath && travelPath.length > 0) {
          for (let j = 0; j < travelPath.length; j++) {
            const point = travelData[parseInt(path[i].name)].graph.node(
              travelPath[j],
            ).geometry;
            stitches.push(new Stitch(new Vector(point.getX(), point.getY())));
          }
        }
      } else {
        const startPoint = travelData[parseInt(path[i].name)].graph.node(
          path[i].startNode,
        ).geometry;
        const endPoint = travelData[parseInt(path[i].name)].graph.node(
          path[i].endNode,
        ).geometry;

        const underlay = this.autoRuns[parseInt(path[i].name)].getUnderlay(
          pixelsPerMm,
          startPoint,
          endPoint,
        );
        stitches.push(...underlay);

        const fill = this.autoRuns[parseInt(path[i].name)].getStitches(
          pixelsPerMm,
          endPoint,
          endPoint,
        );
        stitches.push(...fill);
      }
    }

    return stitches;
  }
}
