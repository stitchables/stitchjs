import { IRun } from '../IRun';
import { Vector } from '../../Math/Vector';
import {
  PrecisionModel,
  Coordinate,
  Point,
  LineString,
  LinearRing,
} from 'jsts/org/locationtech/jts/geom';
import GeometryNoder from 'jsts/org/locationtech/jts/noding/snapround/GeometryNoder';
import ItemBoundable from 'jsts/org/locationtech/jts/index/strtree/ItemBoundable';
import ItemDistance from 'jsts/org/locationtech/jts/index/strtree/ItemDistance';
import { STRtree } from 'jsts/org/locationtech/jts/index/strtree';
import GeometryItemDistance from 'jsts/org/locationtech/jts/index/strtree/GeometryItemDistance';
import FacetSequenceTreeBuilder from 'jsts/org/locationtech/jts/operation/distance/FacetSequenceTreeBuilder';
import ArrayList from 'jsts/java/util/ArrayList';
import { Stitch } from '../Stitch';
import * as graphlib from '@dagrejs/graphlib';
import { geometryFactory } from '../../util/jsts';
import DisjointSet from '../../Optimize/DisjointSet';
import { Run } from './Run';

type EndPointNode = Point;
type JumpNode = { p: Point; q: Point };
type Node = EndPointNode | JumpNode;
type Edge = LineString | LinearRing;

export class Redwork implements IRun {
  stitchLengthMm: number;
  stitchToleranceMm: number;
  graph: graphlib.Graph<null, Node, Edge>;
  nodedGeoms: LineString[];
  jumps: LineString[];
  line: LineString;
  constructor(
    lines: Vector[][],
    options?: {
      stitchLengthMm?: number;
      stitchToleranceMm?: number;
    },
  ) {
    this.stitchLengthMm = options?.stitchLengthMm ?? 3;
    this.stitchToleranceMm = options?.stitchToleranceMm ?? 1;
    this.graph = new graphlib.Graph<null, Node, LineString>();
    this.jumps = [];

    const geometries = new ArrayList(0);
    for (const line of lines) {
      const coords = line.map((v) => new Coordinate(v.x, v.y));
      geometries.add(geometryFactory.createLineString(coords));
    }

    const geometryNoder = new GeometryNoder(new PrecisionModel(10));
    this.nodedGeoms = geometryNoder.node(geometries).toArray();
    const nodedLines = geometryNoder.node(geometries).toArray();

    for (const nodedLine of nodedLines) {
      const startPoint = nodedLine.getStartPoint();
      this.graph.setNode(startPoint.toString(), startPoint);
      const endPoint = nodedLine.getEndPoint();
      this.graph.setNode(endPoint.toString(), startPoint);
      this.graph.setEdge(startPoint.toString(), endPoint.toString(), nodedLine);
      this.graph.setEdge(endPoint.toString(), startPoint.toString(), nodedLine.reverse());
    }

    const adj = new Map<string, string[]>();
    for (const node of this.graph.nodes()) {
      adj.set(node, this.graph.neighbors(node) ?? []);
    }
    const coordinates = [];
    const circuit = printCircuit(adj);
    for (let i = 1; i < circuit.length; i++) {
      const line = this.graph.edge(circuit[i - 1], circuit[i]);
      const coords = line.getCoordinates();
      for (let j = 0; j < coords.length - 1; j++) {
        coordinates.push(coords[j]);
      }
    }
    this.line = geometryFactory.createLineString(coordinates);

    // const componentGraph = new graphlib.Graph<null, Point, LineString>({
    //   directed: false,
    //   multigraph: true,
    // });
    // for (let i = 0; i < nodedLines.length; i++) {
    //   const startPoint = nodedLines[i].getStartPoint();
    //   const endPoint = nodedLines[i].getEndPoint();
    //   componentGraph.setNode(startPoint.toString(), startPoint);
    //   componentGraph.setNode(endPoint.toString(), endPoint);
    //   componentGraph.setEdge(startPoint.toString(), endPoint.toString(), nodedLines[i]);
    // }
    //
    // const components = graphlib.alg.components(componentGraph);
    // const componentTree = new STRtree(3);
    // for (let i = 0; i < components.length; i++) {
    //   const nodes = new Set(components[i]);
    //   const edges = [];
    //   const edgeTree = new STRtree();
    //   for (const edge of componentGraph.edges()) {
    //     if (nodes.has(edge.v) && nodes.has(edge.w)) {
    //       edges.push(componentGraph.edge(edge));
    //       const line = componentGraph.edge(edge);
    //       for (let j = 1; j < line.getNumPoints(); j++) {}
    //     }
    //   }
    //   const geometry = geometryFactory.createMultiLineString(edges);
    //   const tree = FacetSequenceTreeBuilder.build(geometry);
    //   componentTree.insert(geometry.getEnvelopeInternal(), {
    //     id: i.toString(),
    //     geometry,
    //     tree,
    //   });
    // }
    // componentTree.build();
    //
    // const disjointItemDistance = new DisjointSetItemDistance(
    //   Array.from({ length: components.length }, (_, i) => i.toString()),
    // );
    // while (!disjointItemDistance.disjointSet.isFullyConnected()) {
    //   const [p, q] = componentTree.nearestNeighbour(disjointItemDistance);
    //   disjointItemDistance.disjointSet.union(p.id, q.id);
    //   console.log(p, q);
    //   const [s, t] = p.tree.nearestNeighbour(q.tree, geomItemDist);
    //   const [sLoc, tLoc] = s.nearestLocations(t);
    //   this.jumps.push(geometryFactory.createLineString([sLoc.getCoordinate(), tLoc.getCoordinate()]));
    // }

    // for (const component of components) {
    //   // const parent = component.pop()!;
    //   // for (const node of component) {
    //   //   itemDistance.disjointSet.union(parent, node);
    //   // }
    //   const componentEdges = new Set<string>();
    //   for (let )
    //   componentTree.insert(nodedLine.getEnvelopeInternal(), {
    //     id: `${startPoint.toString()}`,
    //     edge: { v: startPoint.toString(), w: endPoint.toString() },
    //     geometry: nodedLine,
    //   });
    // }
    // lineTree.build();
    //
    // const jumps = new Map<string, { location: GeometryLocation, index: number }[]>;
    // let count = 0;
    // while (!itemDistance.disjointSet.isFullyConnected()) {
    //   const [p, q] = lineTree.nearestNeighbour(itemDistance);
    //   itemDistance.disjointSet.union(p.id, q.id);
    //   const [pLoc, qLoc] = (new DistanceOp(p.geometry, q.geometry)).nearestLocations();
    //   this.jumps.push(geometryFactory.createLineString([pLoc.getCoordinate(), qLoc.getCoordinate()]));
    //   console.log(count, pLoc.getCoordinate().distance(qLoc.getCoordinate()), pLoc, qLoc);
    //
    //   // if (jumps.has(JSON.stringify(p.edge))) {
    //   //   const locations = jumps.get(JSON.stringify(p.edge))!;
    //   //   locations.push(pLoc);
    //   //   jumps.set(JSON.stringify(p.edge), locations);
    //   // } else {
    //   //   jumps.set(JSON.stringify(p.edge), [pLoc]);
    //   // }
    //   // if (jumps.has(JSON.stringify(q.edge))) {
    //   //   const locations = jumps.get(JSON.stringify(q.edge))!;
    //   //   locations.push(qLoc);
    //   //   jumps.set(JSON.stringify(q.edge), locations);
    //   // } else {
    //   //   jumps.set(JSON.stringify(q.edge), [qLoc]);
    //   // }
    //
    //   // jumps.push({
    //   //   p: { edge: p.edge, location: pLoc },
    //   //   q: { edge: q.edge, location: qLoc },
    //   //   // geometryFactory.createLineString([pCoord, qCoord])
    //   // });
    //   count++;
    // }
    //
    // console.log(jumps);
  }

  getStitches(pixelsPerMm: number): Stitch[] {
    const run = new Run(
      this.line.getCoordinates().map((c: Coordinate) => new Vector(c.x, c.y)),
      { stitchToleranceMm: 0.1 },
    );
    return run.getStitches(pixelsPerMm);
  }
}

const geomItemDist = new GeometryItemDistance();
class DisjointSetItemDistance {
  disjointSet: DisjointSet;
  constructor(nodeIds: string[]) {
    this.disjointSet = new DisjointSet(nodeIds);
  }
  distance(item1: ItemBoundable, item2: ItemBoundable) {
    if (item1 === item2) return Number.MAX_VALUE;
    // check if they are in the same connected component
    const item1Parent = this.disjointSet.find(item1.getItem().id);
    const item2Parent = this.disjointSet.find(item2.getItem().id);
    if (item1Parent === item2Parent) return Number.MAX_VALUE;
    // return item1.getItem().geometry.distance(item2.getItem().geometry);
    const [p, q] = item1
      .getItem()
      .tree.nearestNeighbour(item2.getItem().tree, geomItemDist);
    return p.distance(q);
  }
  get interfaces_() {
    return [ItemDistance];
  }
}

function printCircuit(adj: Map<string, string[]>): string[] {
  if (adj.size === 0) return [];

  // Maintain a stack to keep vertices
  // We can start from any vertex, here we start with 0
  let currPath = [adj.keys().next().value!];

  // list to store final circuit
  let circuit = [];

  while (currPath.length > 0) {
    let currNode = currPath[currPath.length - 1];

    const neighbors = adj.get(currNode)!;
    // If there's remaining edge in adjacency list
    // of the current vertex
    if (neighbors.length > 0) {
      // Find and remove the next vertex that is
      // adjacent to the current vertex
      let nextNode = neighbors.pop()!;

      // Push the new vertex to the stack
      currPath.push(nextNode);

      adj.set(currNode, neighbors);
    }

    // back-track to find remaining circuit
    else {
      // Remove the current vertex and
      // put it in the circuit
      circuit.push(currPath.pop()!);
    }
  }

  // reverse the result vector
  circuit.reverse();

  return circuit;
}
