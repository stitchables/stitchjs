import { IPolygonPathFinder } from './PolygonPathFinder';
import { Coordinate, Point, LineString, Polygon } from 'jsts/org/locationtech/jts/geom';
import { tessellate, voronoi, VoronoiEdge } from 'voron8';
import { geometryFactory } from '../util/jsts';
import * as graphlib from '@dagrejs/graphlib';
import STRtree from 'jsts/org/locationtech/jts/index/strtree/STRtree';
import LinearComponentExtracter from 'jsts/org/locationtech/jts/geom/util/LinearComponentExtracter';
import RelateOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp';
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp';
import GeometryLocation from 'jsts/org/locationtech/jts/operation/distance/GeometryLocation';
import TopologyPreservingSimplifier from 'jsts/org/locationtech/jts/simplify/TopologyPreservingSimplifier';

export default class MATPolygonPathFinder implements IPolygonPathFinder {
  polygon: Polygon;
  spineGraph: graphlib.Graph<
    null,
    Point,
    { geometry: LineString; weight: number; from: string; to: string }
  >;
  spineTree: STRtree;
  legTree: STRtree;
  cellTree: STRtree;
  spineDijkstraCache: Map<string, Record<string, graphlib.Path>>;
  constructor(polygon: Polygon) {
    this.spineDijkstraCache = new Map();
    // ensure input polygon is free of collinear points
    this.polygon = TopologyPreservingSimplifier.simplify(polygon, 0.1);

    // prepare the input for voron8
    const rings = [
      this.polygon
        .getExteriorRing()
        .getCoordinates()
        .map((c: Coordinate) => [c.x, c.y]),
    ];
    for (let i = 0, n = this.polygon.getNumInteriorRing(); i < n; i++) {
      rings.push(
        this.polygon
          .getInteriorRingN(i)
          .getCoordinates()
          .map((c: Coordinate) => [c.x, c.y]),
      );
    }

    // generate the generalized voronoi diagram
    const voronoiResult = voronoi(rings, {
      assumeNoIntersections: true,
      skipIntersectionCheck: true,
    });

    // helper util for edge identification
    const getEdgeId = (e: VoronoiEdge) =>
      e.from < e.to ? `${e.from},${e.to}` : `${e.to},${e.from}`;

    // voron8 can emit distinct vertex indices at coincident locations (e.g.
    // where several exterior bisectors meet). The cell walk below threads a
    // shared-vertex pointer between consecutive boundary edges by vertex index,
    // so those duplicates break the handoff and cells reconstruct degenerately.
    // Map each vertex to a canonical index (the first vertex sharing its exact
    // location) and compare through it. Only the walk's shared-vertex tests use
    // this; the pushed vertices and spine node ids keep their original indices.
    const canonicalIndex: number[] = new Array(voronoiResult.vertices.length);
    const canonicalByKey = new Map<string, number>();
    voronoiResult.vertices.forEach((v, i) => {
      const key = `${v.x},${v.y}`;
      const existing = canonicalByKey.get(key);
      if (existing === undefined) {
        canonicalByKey.set(key, i);
        canonicalIndex[i] = i;
      } else {
        canonicalIndex[i] = existing;
      }
    });
    const canon = (i: number) => canonicalIndex[i];

    // preform and store the edge tessellations once
    const edgeMap: Record<string, LineString> = {};
    for (const edge of voronoiResult.edges) {
      if (edge.location === 'interior') {
        const pts = tessellate(edge.geometry);
        const coords = pts.map((p) => new Coordinate(p.x, p.y));
        edgeMap[getEdgeId(edge)] = geometryFactory.createLineString(coords);
      }
    }

    // iterate over the voronoi edges, build the spine graph, spineTree, and legTree
    this.spineGraph = new graphlib.Graph<
      null,
      Point,
      { geometry: LineString; weight: number; from: string; to: string }
    >({ directed: false });
    this.spineTree = new STRtree();
    this.legTree = new STRtree();
    for (const edge of voronoiResult.edges) {
      if (edge.location === 'interior') {
        const idFrom = edge.from.toString();
        const vFrom = voronoiResult.vertices[edge.from];
        const cFrom = new Coordinate(vFrom.x, vFrom.y);
        const pFrom = geometryFactory.createPoint(cFrom);
        const idTo = edge.to.toString();
        const vTo = voronoiResult.vertices[edge.to];
        const cTo = new Coordinate(vTo.x, vTo.y);
        const pTo = geometryFactory.createPoint(cTo);
        if (!vFrom.isInput) this.spineGraph.setNode(idFrom, pFrom);
        if (!vTo.isInput) this.spineGraph.setNode(idTo, pTo);
        if (!vFrom.isInput !== !vTo.isInput) {
          const geometry = geometryFactory.createLineString([cFrom, cTo]);
          const node = vFrom.isInput ? idTo : idFrom;
          this.legTree.insert(geometry.getEnvelopeInternal(), { geometry, node });
        }
        if (!vFrom.isInput && !vTo.isInput) {
          const geometry = edgeMap[getEdgeId(edge)];
          const weight = geometry.getLength();
          this.spineGraph.setEdge(idFrom, idTo, {
            geometry,
            weight,
            from: idFrom,
            to: idTo,
          });
          this.spineTree.insert(geometry.getEnvelopeInternal(), {
            geometry,
            nodes: [idFrom, idTo],
          });
        }
      }
    }

    // iterate over the faces, build the cell tree
    this.cellTree = new STRtree();
    for (const face of voronoiResult.faces) {
      // spine is the set of internal edges (and unique vertices) that
      // have no endpoint on the boundary of the shape
      const spine: { nodes: Set<string>; edges: string[][] } = {
        nodes: new Set<string>(),
        edges: [],
      };

      // edgeSequence is the sequence of edges defining the internal
      // boundary of the face
      const edgeSequence = [];

      // find the shared vertex between the first and last boundary edges
      const { from, to } = voronoiResult.edges[face.boundary[0]];
      const last = voronoiResult.edges[face.boundary[face.boundary.length - 1]];
      let prev =
        canon(from) === canon(last.from) || canon(from) === canon(last.to) ? from : to;

      // iterate over the boundary edges
      for (const e of face.boundary) {
        const curr = voronoiResult.edges[e];
        const id = getEdgeId(curr);
        if (curr.location === 'interior') {
          // if the previous shared vertex is the current "to" vertex we
          // need to reverse the order of the edge points later
          const isReversed = canon(prev) === canon(curr.to);
          const vertices = isReversed ? [curr.to, curr.from] : [curr.from, curr.to];
          edgeSequence.push({ id, vertices, isReversed });
          const vFrom = voronoiResult.vertices[curr.from];
          const vTo = voronoiResult.vertices[curr.to];
          if (!vFrom.isInput) spine.nodes.add(curr.from.toString());
          if (!vTo.isInput) spine.nodes.add(curr.to.toString());
          if (!vFrom.isInput && !vTo.isInput)
            spine.edges.push([curr.from.toString(), curr.to.toString()]);
        }
        // update prev to be the new shared vertex
        if (canon(prev) === canon(curr.to)) prev = curr.from;
        else prev = curr.to;
      }

      if (edgeSequence.length > 0) {
        // construct the cell boundary points, we need to be careful here because when
        // two edges are directly connected we need to drop the shared endpoint from one
        // but if they are separated by non-internal edges we need to keep both endpoints
        const boundary = [];
        let prev = null;
        for (const { id, vertices, isReversed } of edgeSequence) {
          const pts = edgeMap[id].getCoordinates();
          const start =
            prev === null ||
            (canon(prev) !== canon(vertices[0]) && canon(prev) !== canon(vertices[1]))
              ? 0
              : 1;
          for (let i = start; i < pts.length; i++) {
            const pt = pts[isReversed ? pts.length - 1 - i : i];
            if (boundary.length === 0 || boundary[boundary.length - 1] !== pt)
              boundary.push(pt);
          }
          prev = vertices[1];
        }
        boundary.push(boundary[0]);
        // insert the cell into the tree
        const geometry = TopologyPreservingSimplifier.simplify(
          geometryFactory.createPolygon(geometryFactory.createLinearRing(boundary)),
          0.00001,
        );
        this.cellTree.insert(geometry.getEnvelopeInternal(), { geometry, spine });
      }
    }

    // build the trees
    this.spineTree.build();
    this.legTree.build();
    this.cellTree.build();

    // Shortest paths on the spine graph are computed lazily, single-source, and
    // memoized. Building all-pairs (dijkstraAll) up front is O(V * (E + V log V))
    // and dominates construction for large spines, yet findPath only ever queries
    // a handful of source nodes (those where the endpoints connect to the spine).
  }

  getDijkstraFrom(source: string): Record<string, graphlib.Path> {
    let results = this.spineDijkstraCache.get(source);
    if (results === undefined) {
      results = graphlib.alg.dijkstra(
        this.spineGraph,
        source,
        (e) => this.spineGraph.edge(e).weight,
        (n) => this.spineGraph.nodeEdges(n)!,
      );
      this.spineDijkstraCache.set(source, results);
    }
    return results;
  }

  // find the potential connections to the spine and calculate the shortest path between
  // the two groups of connection points
  findPath(
    start: Point | LineString | Polygon,
    end: Point | LineString | Polygon,
  ): LineString {
    const startConnections = this.getConnections(start);
    const endConnections = this.getConnections(end);
    if (startConnections === undefined || endConnections === undefined)
      return geometryFactory.createLineString();
    const minPath: {
      nodes: string[] | undefined;
      weight: number;
      start: { node: string; connectionPath: Coordinate[] } | undefined;
      end: { node: string; connectionPath: Coordinate[] } | undefined;
    } = { nodes: undefined, weight: Infinity, start: undefined, end: undefined };
    for (const startConnection of startConnections) {
      for (const endConnection of endConnections) {
        const currPath = this.getShortestPath(startConnection.node, endConnection.node);
        if (currPath === undefined) continue;
        if (currPath.weight < minPath.weight) {
          minPath.nodes = currPath.nodes;
          minPath.weight = currPath.weight;
          minPath.start = startConnection;
          minPath.end = endConnection;
        }
      }
    }
    if (
      minPath.start !== undefined &&
      minPath.end !== undefined &&
      minPath.nodes !== undefined
    ) {
      if (minPath.nodes.length === 1) {
        return geometryFactory.createLineString([
          ...minPath.start.connectionPath,
          ...minPath.end.connectionPath.reverse(),
        ]);
      }
      const path = [...minPath.start.connectionPath];
      let prevNode = minPath.nodes[0];
      let coordinates = null;
      for (let i = 1; i < minPath.nodes.length; i++) {
        const currNode = minPath.nodes[i];
        const { geometry, from, to } = this.spineGraph.edge(prevNode, currNode);
        if (from === prevNode && to === currNode) {
          coordinates = geometry.getCoordinates();
        } else {
          coordinates = geometry.reverse().getCoordinates();
        }
        path.push(...coordinates.slice(0, -1));
        prevNode = currNode;
      }
      path.push(coordinates[coordinates.length - 1]);
      path.push(...minPath.end.connectionPath.reverse());
      return geometryFactory.createLineString(path);
    }
    return geometryFactory.createLineString();
  }

  getConnections(
    source: Point | LineString | Polygon,
    connectionPath: Coordinate[] = [],
    checkedIntersection = false,
  ): { node: string; connectionPath: Coordinate[] }[] | undefined {
    // prepare the input, buffer points and extract linear components
    let lineal = source;
    if (source instanceof Point) {
      lineal = LinearComponentExtracter.getGeometry(source.buffer(1));
      connectionPath.push(source.getCoordinate());
    } else if (source instanceof Polygon) {
      lineal = LinearComponentExtracter.getGeometry(source);
    }

    // check if input intersects the original polygon, if not find the nearest
    // point on the boundary and proceed with the point geometry
    if (!checkedIntersection) {
      if (!RelateOp.intersects(lineal, this.polygon)) {
        const [c1, c2] = DistanceOp.nearestPoints(this.polygon, lineal);
        return this.getConnections(
          geometryFactory.createPoint(c1).buffer(1),
          [...connectionPath, c2, c1],
          true,
        );
      }
    }

    // check if the input intersects the spine, if so return the connections to the
    // two spine edge endpoints
    const spineNeighbors = this.spineTree.query(lineal.getEnvelopeInternal());
    const spineConnections = [];
    for (const { geometry, nodes } of spineNeighbors) {
      if (lineal.intersects(geometry)) {
        const intersection = OverlayOp.intersection(lineal, geometry);
        for (const node of nodes) {
          const [c] = DistanceOp.nearestPoints(intersection, this.spineGraph.node(node));
          const distanceOp = new DistanceOp(geometry, geometryFactory.createPoint(c));
          const [location] = distanceOp.nearestLocations();
          const substring = this.extractToEndpoint(
            geometry,
            location,
            node === nodes[0] ? 'start' : 'end',
          );
          spineConnections.push({
            node,
            connectionPath: [...connectionPath, ...substring],
          });
        }
      }
    }
    if (spineConnections.length > 0) return spineConnections;

    // check if the input intersects the legs, if so return the connections to the
    // spine from the intersecting legs
    const legNeighbors = this.legTree.query(lineal.getEnvelopeInternal());
    const legConnections = [];
    for (const { geometry, node } of legNeighbors) {
      if (lineal.intersects(geometry)) {
        const intersection = OverlayOp.intersection(lineal, geometry);
        const [c1, c2] = DistanceOp.nearestPoints(
          intersection,
          this.spineGraph.node(node),
        );
        legConnections.push({ node, connectionPath: [...connectionPath, c1, c2] });
      }
    }
    if (legConnections.length > 0) return legConnections;

    // find all cells that the input intersects, for each intersecting cell
    // find the nearest point on the cells spine pieces and return the connections
    const cellNeighbors = this.cellTree.query(lineal.getEnvelopeInternal());
    const cellConnections: { node: string; connectionPath: Coordinate[] }[] = [];
    for (const { geometry, spine } of cellNeighbors) {
      const minConnections: {
        dist: number;
        connections: { node: string; connectionPath: Coordinate[] }[];
      } = { dist: Infinity, connections: [] };
      if (lineal.intersects(geometry)) {
        const intersection = lineal.intersection(geometry);
        if (spine.edges.length > 0) {
          for (const e of spine.edges) {
            const edge = this.spineGraph.edge(e[0], e[1]);
            const distanceOp = new DistanceOp(edge.geometry, intersection);
            const [l1, l2] = distanceOp.nearestLocations();
            const [c1, c2] = [l1.getCoordinate(), l2.getCoordinate()];
            const currDist = c1.distance(c2);
            if (currDist < minConnections.dist) {
              minConnections.dist = currDist;
              minConnections.connections = [
                {
                  node: e[0],
                  connectionPath: [
                    ...connectionPath,
                    c2,
                    ...this.extractToEndpoint(
                      edge.geometry,
                      l1,
                      e[0] === edge.from ? 'start' : 'end',
                    ),
                  ],
                },
                {
                  node: e[1],
                  connectionPath: [
                    ...connectionPath,
                    c2,
                    ...this.extractToEndpoint(
                      edge.geometry,
                      l1,
                      e[1] === edge.from ? 'start' : 'end',
                    ),
                  ],
                },
              ];
            }
          }
        } else {
          for (const node of [...spine.nodes]) {
            const nodePoint = this.spineGraph.node(node);
            const [c1, c2] = DistanceOp.nearestPoints(nodePoint, intersection);
            const currDist = c1.distance(c2);
            if (currDist < minConnections.dist) {
              minConnections.dist = currDist;
              minConnections.connections = [
                { node, connectionPath: [...connectionPath, c2, c1] },
              ];
            }
          }
        }
        cellConnections.push(...minConnections.connections);
      }
    }
    if (cellConnections.length > 0) return cellConnections;

    console.log('no connections found???');
    return undefined;
  }

  extractToEndpoint(
    line: LineString,
    location: GeometryLocation,
    endpoint: 'start' | 'end',
  ): Coordinate[] {
    const lineCoords = line.getCoordinates() as Coordinate[];
    const point = new Coordinate(location.getCoordinate());
    const segmentIndex = location.getSegmentIndex();

    let coords: Coordinate[];

    if (endpoint === 'start') {
      coords = [
        ...lineCoords.slice(0, segmentIndex + 1).map((coord) => new Coordinate(coord)),
        point,
      ];

      // Return from the location toward the requested endpoint.
      coords.reverse();
    } else {
      coords = [
        point,
        ...lineCoords.slice(segmentIndex + 1).map((coord) => new Coordinate(coord)),
      ];
    }

    // Avoid duplicating the location when it lies exactly on a vertex.
    coords = coords.filter((coord, i) => i === 0 || !coord.equals2D(coords[i - 1]));

    if (coords.length < 2) {
      coords.push(new Coordinate(coords[0]));
    }

    return coords;
  }

  getShortestPath(
    source: string,
    target: string,
  ): { nodes: string[]; weight: number } | undefined {
    if (!this.spineGraph.hasNode(source)) return undefined;
    const results = this.getDijkstraFrom(source);
    const targetResult = results?.[target];

    if (!targetResult || !Number.isFinite(targetResult.distance)) {
      return undefined;
    }

    const nodes = [];
    let current = target;

    while (current !== undefined) {
      nodes.push(current);

      if (current === source) break;

      current = results[current]?.predecessor;
    }

    if (nodes[nodes.length - 1] !== source) {
      return undefined;
    }

    nodes.reverse();

    return {
      nodes,
      weight: targetResult.distance,
    };
  }
}
