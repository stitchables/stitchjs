import { IRun } from '../IRun';
import { IRoutedRun } from './IRoutedRun';
import * as graphlib from '@dagrejs/graphlib';
import { Coordinate, LineString, Point, Polygon } from 'jsts/org/locationtech/jts/geom';
import CascadedPolygonUnion from 'jsts/org/locationtech/jts/operation/union/CascadedPolygonUnion';
import { RelateOp } from 'jsts/org/locationtech/jts/operation/relate';
import { OverlayOp } from 'jsts/org/locationtech/jts/operation/overlay';
import { STRtree } from 'jsts/org/locationtech/jts/index/strtree';
import { DistanceOp } from 'jsts/org/locationtech/jts/operation/distance';
import ItemBoundable from 'jsts/org/locationtech/jts/index/strtree/ItemBoundable';
import ItemDistance from 'jsts/org/locationtech/jts/index/strtree/ItemDistance';
import ArrayList from 'jsts/java/util/ArrayList';
import { Vector } from '../../Math/Vector';
import { geometryFactory } from '../../util/jsts';
import { Stitch } from '../Stitch';
import { createPolygon } from '../../Geometry/createPolygon';
import PolygonPathFinder from '../../Optimize/PolygonPathFinder';
import DisjointSet from '../../Optimize/DisjointSet';
import { resample } from '../../Geometry/resample';
import { StitchType } from '../EStitchType';
import MinimumSpanningTree from '../../Optimize/MinimumSpanningTree';

class DisjointSetItemDistance {
  disjointSet: DisjointSet;
  constructor(nodeIds: string[]) {
    this.disjointSet = new DisjointSet(nodeIds);
  }
  distance(item1: ItemBoundable, item2: ItemBoundable) {
    if (item1 === item2) return Number.MAX_VALUE;
    // check if they are in the same connected component
    const item1Parent = this.disjointSet.find(item1.getItem().nodeId);
    const item2Parent = this.disjointSet.find(item2.getItem().nodeId);
    if (item1Parent === item2Parent) return Number.MAX_VALUE;
    return item1.getItem().geometry.distance(item2.getItem().geometry);
  }
  get interfaces_() {
    return [ItemDistance];
  }
}

class GeometryItemDistance {
  distance(item1: ItemBoundable, item2: ItemBoundable) {
    return item1.getItem().geometry.distance(item2.getItem().geometry);
  }
}

type ComponentEdge = {
  path: LineString | Point;
  weight: number;
  fromNode: string;
};
class Component {
  componentId: string;
  runs: { run: IRoutedRun; boundary: Polygon; pathFinder: PolygonPathFinder }[];
  travels: Polygon[];
  freeSpace: Polygon;
  pathFinder: PolygonPathFinder;
  graph: graphlib.Graph<null, number, ComponentEdge>;
  spanningTree: graphlib.Graph;
  constructor(
    componentId: string,
    runs: { run: IRoutedRun; boundary: Polygon; pathFinder: PolygonPathFinder }[],
    travels: Polygon[],
    freeSpace: Polygon,
  ) {
    this.componentId = componentId;
    this.runs = runs;
    this.travels = travels;
    this.freeSpace = freeSpace;
    this.pathFinder = new PolygonPathFinder(this.freeSpace);
    const graphOpts = { directed: false, multigraph: true };
    this.graph = new graphlib.Graph<null, number, ComponentEdge>(graphOpts);

    for (let i = 0; i < this.runs.length; i++) {
      this.graph.setNode(i.toString(), i);
      const bi = this.runs[i].boundary.getBoundary();
      for (let j = 0; j < i; j++) {
        const bj = this.runs[j].boundary.getBoundary();
        if (RelateOp.intersects(bi, bj)) {
          const coordinate = OverlayOp.intersection(bi, bj).getCoordinate();
          this.graph.setEdge(
            i.toString(),
            j.toString(),
            {
              path: geometryFactory.createPoint(coordinate),
              weight: 0,
              fromNode: i.toString(),
            },
            i.toString(),
          );
        }
      }
    }

    const runSpaceCollection = new ArrayList(0);
    for (const run of runs) runSpaceCollection.add(run.boundary);
    const runSpace = CascadedPolygonUnion.union(runSpaceCollection);

    const travelSpaceCollection = new ArrayList(0);
    for (const travel of travels) travelSpaceCollection.add(travel);
    const travelSpace = CascadedPolygonUnion.union(travelSpaceCollection);

    if (this.travels.length > 0) {
      const freeTravels =
        runSpace === null ? travelSpace : OverlayOp.difference(travelSpace, runSpace);
      if (!freeTravels.isEmpty()) {
        for (let i = 0; i < freeTravels.getNumGeometries(); i++) {
          const freeTravel = freeTravels.getGeometryN(i);
          const connectedRuns = [];
          for (let j = 0; j < this.runs.length; j++) {
            if (
              DistanceOp.isWithinDistance(freeTravel, this.runs[j].boundary, 0.000001)
            ) {
              connectedRuns.push(j);
            }
          }
          if (connectedRuns.length > 0) {
            const freeTravelPathFinder = new PolygonPathFinder(freeTravel);
            for (let j = 1; j < connectedRuns.length; j++) {
              const boundary1 = this.runs[connectedRuns[j]].boundary;
              for (let k = 0; k < j; k++) {
                const boundary2 = this.runs[connectedRuns[k]].boundary;
                const connectingPath = freeTravelPathFinder.findPath(
                  boundary1,
                  boundary2,
                );
                if (!connectingPath.isEmpty()) {
                  this.graph.setEdge(
                    connectedRuns[j].toString(),
                    connectedRuns[k].toString(),
                    {
                      path: connectingPath,
                      weight: connectingPath.getLength(),
                      fromNode: connectedRuns[j].toString(),
                    },
                    i.toString(),
                  );
                }
              }
            }
          }
        }
      }
    }
    this.spanningTree = MinimumSpanningTree<number, ComponentEdge>(
      this.graph,
      (label) => label.weight,
    );
  }

  getStitchPlan(entry: Point, exit: Point): TravelPlanStep[] {
    if (this.runs.length === 0) {
      if (DistanceOp.distance(entry, exit) < 0.00001) return [];
      return [this.getTravel(entry, exit)];
    }
    if (this.runs.length === 1 && this.travels.length === 0) {
      return [
        {
          nodeId: this.componentId,
          runIndex: 0,
          entry: entry.getCoordinate(),
          exit: exit.getCoordinate(),
        },
      ];
    }
    let startNode, endNode, isEndOnNode;
    if (
      DistanceOp.distance(
        geometryFactory.createMultiPolygon(this.runs.map((r) => r.boundary)),
        exit,
      ) < 0.00001
    ) {
      isEndOnNode = true;
      endNode = '0';
      let minDist = DistanceOp.distance(this.runs[0].boundary, exit);
      for (let i = 1; i < this.runs.length; i++) {
        const dist = DistanceOp.distance(this.runs[i].boundary, exit);
        if (dist < minDist) {
          endNode = i.toString();
          minDist = dist;
        }
      }
      startNode = farthestNode(
        graphlib.alg.dijkstra(
          this.spanningTree,
          endNode,
          (e) => this.spanningTree.edge(e).weight,
        ),
      );
    } else {
      isEndOnNode = false;
      const diameter = findTreeDiameter(
        this.spanningTree,
        (e) => this.spanningTree.edge(e).weight,
      );
      startNode = diameter.start;
      endNode = diameter.end;
      if (
        this.pathFinder.findPath(exit, this.runs[parseInt(diameter.start)].boundary) <
        this.pathFinder.findPath(exit, this.runs[parseInt(diameter.end)].boundary)
      ) {
        startNode = diameter.end;
        endNode = diameter.start;
      }
    }
    // const startNode = '0';
    // const endNode = (this.runs.length - 1).toString();
    const path = shortestTreeWalkVisitAll(this.spanningTree, endNode, startNode);

    if (path.length === 1) {
      return [
        {
          nodeId: this.componentId,
          runIndex: parseInt(path[0]),
          entry: entry.getCoordinate(),
          exit: exit.getCoordinate(),
        },
      ];
    }

    let prevEdge = this.spanningTree.edge(
      this.spanningTree.nodeEdges(path[1], path[0])![0],
    );
    let currEntry =
      prevEdge.path instanceof Point
        ? prevEdge.path
        : prevEdge.fromNode === path[0]
          ? prevEdge.path.getStartPoint()
          : prevEdge.path.getEndPoint();
    let currExit = isEndOnNode ? exit : currEntry;
    const plan: TravelPlanStep[] = [];
    if (!isEndOnNode) plan.unshift(this.pathFinder.findPath(currExit, exit));
    plan.unshift({
      nodeId: this.componentId,
      runIndex: parseInt(path[0]),
      entry: currEntry.getCoordinate(),
      exit: currExit.getCoordinate(),
    });
    plan.unshift(prevEdge.fromNode === path[0] ? prevEdge.path.reverse() : prevEdge.path);
    let nextEdge = prevEdge;

    const seenNodes = new Set<string>([path[0]]);
    for (let i = 1; i < path.length - 1; i++) {
      prevEdge = this.spanningTree.edge(
        this.spanningTree.nodeEdges(path[i + 1], path[i])![0],
      );
      currEntry =
        prevEdge.path instanceof Point
          ? prevEdge.path
          : prevEdge.fromNode === path[i]
            ? prevEdge.path.getStartPoint()
            : prevEdge.path.getEndPoint();
      currExit =
        nextEdge.path instanceof Point
          ? nextEdge.path
          : nextEdge.fromNode === path[i]
            ? nextEdge.path.getStartPoint()
            : nextEdge.path.getEndPoint();
      if (seenNodes.has(path[i])) {
        const pathFinder = new PolygonPathFinder(this.runs[parseInt(path[i])].boundary);
        plan.unshift(pathFinder.findPath(currEntry, currExit));
      } else {
        plan.unshift({
          nodeId: this.componentId,
          runIndex: parseInt(path[i]),
          entry: currEntry.getCoordinate(),
          exit: currExit.getCoordinate(),
        });
        seenNodes.add(path[i]);
      }
      plan.unshift(
        prevEdge.fromNode === path[i] ? prevEdge.path.reverse() : prevEdge.path,
      );
      nextEdge = prevEdge;
    }

    currExit =
      nextEdge.path instanceof Point
        ? nextEdge.path
        : nextEdge.fromNode === startNode
          ? nextEdge.path.getStartPoint()
          : nextEdge.path.getEndPoint();
    if (!seenNodes.has(startNode)) {
      plan.unshift({
        nodeId: this.componentId,
        runIndex: parseInt(startNode),
        entry: currExit.getCoordinate(),
        exit: currExit.getCoordinate(),
      });
    }
    plan.unshift(this.pathFinder.findPath(entry, currExit));

    const grouped = [];
    let current = [];
    for (const step of plan) {
      if (step instanceof LineString) {
        current.push(...step.getCoordinates());
      } else {
        if (current.length > 0) {
          const backtracked = removeBacktracking(current);
          if (backtracked.length > 1) {
            grouped.push(geometryFactory.createLineString(backtracked));
          }
          current = [];
        }
        grouped.push(step);
      }
    }
    if (current.length > 0) {
      const backtracked = removeBacktracking(current);
      if (backtracked.length > 1) {
        grouped.push(geometryFactory.createLineString(backtracked));
      }
    }


    return grouped;
  }
  getTravel(entry: Point, exit: Point): LineString {
    return this.pathFinder.findPath(entry, exit);
  }
}

type NodePoint = { nodeId: string; point: Point };
type RouteEdge = { p: NodePoint; q: NodePoint; weight: number };
type StitchStep = {
  nodeId: string;
  runIndex: number;
  entry: Coordinate;
  exit: Coordinate;
};
type TravelPlanStep = LineString | StitchStep;

export class AutoRoute implements IRun {
  graph: graphlib.Graph<null, Component, RouteEdge>;
  travelPlan: TravelPlanStep[];
  entry: { nodeId: string; point: Point };
  exit: { nodeId: string; point: Point };
  preserveOrder: boolean;
  travelLengthMm: number;
  travelToleranceMm: number;
  constructor(
    routedRuns: IRoutedRun[],
    options?: {
      travelPolygons?: { shell: Vector[]; holes?: Vector[][] }[];
      entry?: Vector;
      exit?: Vector;
      preserveOrder?: boolean;
      travelLengthMm?: number;
      travelToleranceMm?: number;
    },
  ) {
    if (routedRuns.length === 0) {
      throw new Error('Empty array routedRuns passed to AutoRoute constructor...');
    }
    this.graph = new graphlib.Graph<null, Component, RouteEdge>({ directed: false });
    this.travelPlan = [];
    this.entry = { nodeId: '', point: geometryFactory.createPoint() };
    this.exit = { nodeId: '', point: geometryFactory.createPoint() };
    this.preserveOrder = options?.preserveOrder ?? false;
    this.travelLengthMm = options?.travelLengthMm ?? 3;
    this.travelToleranceMm = options?.travelToleranceMm ?? 0.1;

    const runs = [];
    const travels = [];
    const freeSpaceCollection = new ArrayList(0);
    for (const run of routedRuns) {
      const boundary = run.getShape();
      const pathFinder = new PolygonPathFinder(boundary);
      freeSpaceCollection.add(boundary);
      runs.push({ run, boundary, pathFinder });
    }
    if (options?.travelPolygons) {
      for (const { shell, holes } of options.travelPolygons) {
        const polygon = createPolygon(shell, holes);
        freeSpaceCollection.add(polygon);
        travels.push(polygon);
      }
    }
    const freeSpace = CascadedPolygonUnion.union(freeSpaceCollection);

    const componentTree = new STRtree();
    const runsQueue = new Set(runs.keys());
    const travelsQueue = new Set(travels.keys());
    for (let i = 0; i < freeSpace.getNumGeometries(); i++) {
      const nodeId = i.toString();
      const boundary = freeSpace.getGeometryN(i);
      const treeItem = { nodeId, geometry: boundary };
      componentTree.insert(boundary.getEnvelopeInternal(), treeItem);
      const componentRuns = [];
      const componentTravels = [];
      for (const j of runsQueue) {
        const run = runs[j];
        if (RelateOp.intersects(boundary, run.boundary)) {
          componentRuns.push(run);
          runsQueue.delete(j);
        }
      }
      for (const j of travelsQueue) {
        const travel = travels[j];
        if (RelateOp.intersects(boundary, travel)) {
          componentTravels.push(travel);
          travelsQueue.delete(j);
        }
      }

      const component = new Component(nodeId, componentRuns, componentTravels, boundary);
      this.graph.setNode(nodeId, component);
    }
    componentTree.build();

    // build the minimum spanning tree of the component graph
    const itemDistance = new DisjointSetItemDistance(this.graph.nodes());
    while (!itemDistance.disjointSet.isFullyConnected()) {
      const [p, q] = componentTree.nearestNeighbour(itemDistance);
      const [pCoord, qCoord] = DistanceOp.nearestPoints(p.geometry, q.geometry);
      const label = {
        p: { nodeId: p.nodeId, point: geometryFactory.createPoint(pCoord) },
        q: { nodeId: q.nodeId, point: geometryFactory.createPoint(qCoord) },
        weight: pCoord.distance(qCoord),
      };
      this.graph.setEdge(p.nodeId, q.nodeId, label);
      itemDistance.disjointSet.union(p.nodeId, q.nodeId);
    }

    const geometryItemDistance = new GeometryItemDistance();
    if (options?.entry) {
      const coordinate = new Coordinate(options.entry.x, options.entry.y);
      const geometry = geometryFactory.createPoint(coordinate);
      const envelope = geometry.getEnvelopeInternal();
      const neighbor = componentTree.nearestNeighbour(
        envelope,
        { geometry },
        geometryItemDistance,
      );
      this.entry.nodeId = neighbor.nodeId;
      this.entry.point = geometryFactory.createPoint(
        DistanceOp.nearestPoints(neighbor.geometry, geometry)[0],
      );
    }
    if (options?.exit) {
      const coordinate = new Coordinate(options.exit.x, options.exit.y);
      const geometry = geometryFactory.createPoint(coordinate);
      const envelope = geometry.getEnvelopeInternal();
      const neighbor = componentTree.nearestNeighbour(
        envelope,
        { geometry },
        geometryItemDistance,
      );
      this.exit.nodeId = neighbor.nodeId;
      this.exit.point = geometryFactory.createPoint(
        DistanceOp.nearestPoints(neighbor.geometry, geometry)[0],
      );
    }
    if (this.entry.nodeId === '' || this.exit.nodeId === '') {
      // todo: figure out how to pick the best entry/exit points
      // todo: maybe pick the node that is farthest away from the given node?
      // todo: or if no node is given, pick the two nodes that are farthest away from each other?
      const coordinate = new Coordinate(0, 0);
      const geometry = geometryFactory.createPoint(coordinate);
      const envelope = geometry.getEnvelopeInternal();
      const neighbor = componentTree.nearestNeighbour(
        envelope,
        { geometry },
        geometryItemDistance,
      );
      const nearest = DistanceOp.nearestPoints(neighbor.geometry, geometry)[0];
      if (this.entry.nodeId === '') {
        this.entry.nodeId = neighbor.nodeId;
        this.entry.point = geometryFactory.createPoint(nearest);
      }
      if (this.exit.nodeId === '') {
        this.exit.nodeId = neighbor.nodeId;
        this.exit.point = geometryFactory.createPoint(nearest);
      }
    }

    const componentPath = shortestTreeWalkVisitAll(
      this.graph,
      this.exit.nodeId,
      this.entry.nodeId,
    );

    if (componentPath.length === 1) {
      this.travelPlan.push(
        ...this.graph
          .node(componentPath[0])
          .getStitchPlan(this.entry.point, this.exit.point),
      );
    } else {
      let prevEdge = this.graph.edge(componentPath[0], componentPath[1]);
      let prevExit =
        prevEdge.p.nodeId === componentPath[0] ? prevEdge.q.point : prevEdge.p.point;
      let currEntry =
        prevEdge.p.nodeId === componentPath[0] ? prevEdge.p.point : prevEdge.q.point;
      let currExit = this.exit.point;
      this.travelPlan.unshift(
        ...this.graph.node(componentPath[0]).getStitchPlan(currEntry, currExit),
      );
      this.travelPlan.unshift(
        geometryFactory.createLineString([
          prevExit.getCoordinate(),
          currEntry.getCoordinate(),
        ]),
      );
      currExit = prevExit;

      const seenNodes = new Set<string>([componentPath[0]]);
      for (let i = 1; i < componentPath.length - 1; i++) {
        prevEdge = this.graph.edge(componentPath[i + 1], componentPath[i]);
        prevExit =
          prevEdge.p.nodeId === componentPath[i] ? prevEdge.q.point : prevEdge.p.point;
        currEntry =
          prevEdge.p.nodeId === componentPath[i] ? prevEdge.p.point : prevEdge.q.point;
        if (seenNodes.has(componentPath[i])) {
          this.travelPlan.unshift(
            this.graph.node(componentPath[i]).getTravel(currEntry, currExit),
          );
        } else {
          this.travelPlan.unshift(
            ...this.graph.node(componentPath[i]).getStitchPlan(currEntry, currExit),
          );
          seenNodes.add(componentPath[i]);
        }
        this.travelPlan.unshift(
          geometryFactory.createLineString([
            prevExit.getCoordinate(),
            currEntry.getCoordinate(),
          ]),
        );
        currExit = prevExit;
      }

      if (seenNodes.has(this.entry.nodeId)) {
        this.travelPlan.unshift(
          this.graph.node(this.entry.nodeId).getTravel(this.entry.point, currExit),
        );
      } else {
        this.travelPlan.unshift(
          ...this.graph.node(this.entry.nodeId).getStitchPlan(this.entry.point, currExit),
        );
      }
    }
  }

  getStitches(pixelsPerMm: number): Stitch[] {
    const travelLengthPx = this.travelLengthMm * pixelsPerMm;
    const travelTolerancePx = this.travelToleranceMm * pixelsPerMm;

    const stitches = [];
    for (const step of this.travelPlan) {
      if (step instanceof Point) continue;
      if (step instanceof LineString) {
        const resampled = resample(step, travelLengthPx, travelTolerancePx);
        for (let i = 0; i < resampled.getNumPoints(); i++) {
          const c: Coordinate = resampled.getCoordinateN(i);
          stitches.push(new Stitch(new Vector(c.x, c.y), StitchType.TRAVEL));
        }
      } else {
        const routedRun = this.graph.node(step.nodeId).runs[step.runIndex].run;
        const access = { entry: step.entry, exit: step.exit };
        const underlay = routedRun.getUnderlayStitches(pixelsPerMm, access);
        if (underlay.length > 0) {
          underlay.forEach((s) => (s.stitchType = StitchType.UNDERLAY));
          stitches.push(...underlay);
          access.entry = step.exit;
        }
        stitches.push(...routedRun.getStitches(pixelsPerMm, access));
      }
    }
    return stitches;
  }
}

export function shortestTreeWalkVisitAll(
  graph: graphlib.Graph,
  start: string,
  end: string,
): string[] {
  if (!graph.hasNode(start)) throw new Error(`Unknown start node: ${start}`);
  if (!graph.hasNode(end)) throw new Error(`Unknown end node: ${end}`);
  if (graph.isDirected()) throw new Error('Expected an undirected tree');

  const path = findPathWithDijkstra(graph, start, end);
  const nextOnPath = new Map<string, string>();

  for (let i = 0; i < path.length - 1; i++) {
    nextOnPath.set(path[i], path[i + 1]);
  }

  const result: string[] = [];

  function dfs(node: string, parent: string | null): void {
    result.push(node);

    const finalNext = nextOnPath.get(node);

    for (const neighbor of graph.neighbors(node) ?? []) {
      if (neighbor === parent || neighbor === finalNext) continue;

      dfs(neighbor, node);
      result.push(node);
    }

    if (finalNext !== undefined) {
      dfs(finalNext, node);
    }
  }

  dfs(start, null);
  return result;
}

function findPathWithDijkstra(
  graph: graphlib.Graph,
  start: string,
  end: string,
): string[] {
  const results = graphlib.alg.dijkstra(graph, start);

  const endResult = results[end];

  if (!endResult || endResult.distance === Infinity) {
    throw new Error(`No path from ${start} to ${end}`);
  }

  const path: string[] = [];
  let current: string | undefined = end;

  while (current !== undefined) {
    path.push(current);

    if (current === start) break;

    current = results[current]?.predecessor;
  }

  path.reverse();

  if (path[0] !== start) {
    throw new Error(`Could not reconstruct path from ${start} to ${end}`);
  }

  return path;
}

export function findTreeDiameter(
  graph: graphlib.Graph,
  weightFn?: (edge: { v: string; w: string; name?: string }) => number,
): {
  start: string;
  end: string;
  distance: number;
  path: string[];
} {
  const nodes = graph.nodes();

  if (nodes.length === 0) {
    throw new Error('Graph is empty');
  }

  const arbitrary = nodes[0];

  // First sweep
  const first = graphlib.alg.dijkstra(graph, arbitrary, weightFn);
  const start = farthestNode(first);

  // Second sweep
  const second = graphlib.alg.dijkstra(graph, start, weightFn);
  const end = farthestNode(second);

  // Reconstruct path
  const path: string[] = [];
  let current: string | undefined = end;

  while (current !== undefined) {
    path.push(current);

    if (current === start) break;

    current = second[current].predecessor;
  }

  path.reverse();

  return {
    start,
    end,
    distance: second[end].distance,
    path,
  };
}

function farthestNode(
  results: Record<
    string,
    {
      distance: number;
      predecessor?: string;
    }
  >,
): string {
  let bestNode = '';
  let bestDistance = -Infinity;

  for (const node in results) {
    const d = results[node].distance;

    if (d !== Infinity && d > bestDistance) {
      bestDistance = d;
      bestNode = node;
    }
  }

  return bestNode;
}

function dist(a: Coordinate, b: Coordinate) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
function almostSame(a: Coordinate, b: Coordinate, eps = 1e-9) {
  return dist(a, b) <= eps;
}
function cross(a: Coordinate, b: Coordinate, c: Coordinate) {
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
}
function dot(a: Coordinate, b: Coordinate, c: Coordinate) {
  return (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
}
function removeBacktracking(line: Coordinate[], eps = 1e-9): Coordinate[] {
  const out: Coordinate[] = [];

  for (const p of line) {
    if (out.length && almostSame(out[out.length - 1], p, eps)) continue;

    out.push(p);

    let changed = true;

    while (changed && out.length >= 3) {
      changed = false;

      const c = out[out.length - 1];
      const b = out[out.length - 2];
      const a = out[out.length - 3];

      const ab = dist(a, b);
      const bc = dist(b, c);

      if (ab <= eps || bc <= eps) {
        out.splice(out.length - 2, 1);
        changed = true;
        continue;
      }

      const isCollinear = Math.abs(cross(a, b, c)) <= eps * ab * bc;
      const isBacktracking = dot(a, b, c) < 0;

      if (isCollinear && isBacktracking) {
        // Replace A -> B -> C with A -> C.
        out.splice(out.length - 2, 1);

        // If C landed back on A, remove C too.
        if (
          out.length >= 2 &&
          almostSame(out[out.length - 2], out[out.length - 1], eps)
        ) {
          out.pop();
        }

        changed = true;
      }
    }
  }

  return out;
}
