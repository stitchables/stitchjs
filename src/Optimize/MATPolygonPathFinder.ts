import {
  Coordinate,
  Point,
  Location,
  MultiPoint,
  LineString,
  Envelope,
  Polygon,
  GeometryCollection,
} from 'jsts/org/locationtech/jts/geom';
import VoronoiDiagramBuilder from 'jsts/org/locationtech/jts/triangulate/VoronoiDiagramBuilder';
import IndexedPointInAreaLocator from 'jsts/org/locationtech/jts/algorithm/locate/IndexedPointInAreaLocator';
import IndexedFacetDistance from 'jsts/org/locationtech/jts/operation/distance/IndexedFacetDistance';
import { STRtree } from 'jsts/org/locationtech/jts/index/strtree';
import ItemBoundable from 'jsts/org/locationtech/jts/index/strtree/ItemBoundable';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp';
import RelateOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp';
import Densifier from 'jsts/org/locationtech/jts/densify/Densifier';
import * as graphlib from '@dagrejs/graphlib';
import { geometryFactory } from '../util/jsts';
import { Vector } from '../Math/Vector';
import { resample } from '../Geometry/resample';
import { IPolygonPathFinder, PathFinderGeometry } from './PolygonPathFinder';

class GeometryItemDistance {
  distance(item1: ItemBoundable, item2: ItemBoundable) {
    return item1.getItem().geometry.distance(item2.getItem().geometry);
  }
}

// Approximating skeleton with the medial axis
export default class MATPolygonPathFinder implements IPolygonPathFinder {
  polygon: Polygon;
  locator: IndexedPointInAreaLocator;
  indexedFacetDistance: IndexedFacetDistance;
  spineGraph: graphlib.Graph<null, Coordinate, number>;
  spinePaths: Record<string, Record<string, graphlib.Path>>;
  spineTree: STRtree;
  cellTree: STRtree;
  polygons: GeometryCollection;
  constructor(polygon: Polygon) {
    this.polygon = polygon;
    this.indexedFacetDistance = new IndexedFacetDistance(polygon);
    this.spineGraph = new graphlib.Graph<null, Coordinate, number>({ directed: false });
    this.spineTree = new STRtree();
    this.cellTree = new STRtree();
    this.polygons = geometryFactory.createGeometryCollection();
    this.locator = new IndexedPointInAreaLocator(polygon);
    this.spinePaths = {};
  }

  static fromPolygon(
    polygon: Polygon,
    distanceTolerance = 10,
  ): MATPolygonPathFinder | MultiPoint {
    const pf = new MATPolygonPathFinder(polygon);

    const vdb = new VoronoiDiagramBuilder();
    vdb.setClipEnvelope(polygon.getEnvelopeInternal());
    // vdb.setSites(Densifier.densify(polygon, distanceTolerance));
    const sites = resample(
      polygon.getExteriorRing(),
      distanceTolerance,
      0,
    ).getCoordinates();
    for (let i = 0; i < polygon.getNumInteriorRing(); i++) {
      sites.push(
        ...resample(polygon.getInteriorRingN(i), distanceTolerance, 0).getCoordinates(),
      );
    }
    vdb.setSites(geometryFactory.createMultiPointFromCoords(sites));
    const subdivision = vdb.getSubdivision();

    pf.polygons = vdb.getDiagram(geometryFactory);
    const cells: Record<string, { polygon: Polygon; nodeSet: Set<string> }> = {};
    for (let i = 0; i < pf.polygons.getNumGeometries(); i++) {
      const polygon = pf.polygons.getGeometryN(i);
      const cellId = polygon.getUserData().toString();
      const nodeSet = new Set<string>();
      cells[cellId] = { polygon, nodeSet };
    }
    const edges = subdivision.getPrimaryEdges(false).toArray();
    for (const edge of edges) {
      const [da, db] = [edge.orig(), edge.sym().orig()];
      const [va, vb] = [edge.rot().orig(), edge.sym().rot().orig()];
      const [ca, cb] = [va.getCoordinate(), vb.getCoordinate()];
      const [la, lb] = [pf.locator.locate(ca), pf.locator.locate(cb)];
      const [sa, sb] = [ca.toString(), cb.toString()];
      if (la === Location.INTERIOR && lb === Location.INTERIOR) {
        if (polygon.covers(geometryFactory.createLineString([ca, cb]))) {
          cells[da.getCoordinate().toString()].nodeSet.add(sa);
          cells[da.getCoordinate().toString()].nodeSet.add(sb);
          cells[db.getCoordinate().toString()].nodeSet.add(sa);
          cells[db.getCoordinate().toString()].nodeSet.add(sb);
          pf.spineGraph.setNode(sa, ca);
          pf.spineGraph.setNode(sb, cb);
          pf.spineGraph.setEdge(sa, sb, ca.distance(cb));
          const envelope = new Envelope(ca, cb);
          const geometry = geometryFactory.createLineString([ca, cb]);
          const nodes = [sa, sb];
          pf.spineTree.insert(envelope, { nodes, geometry });
        }
      }
    }

    if (graphlib.alg.components(pf.spineGraph).length > 1) {
      const coords = pf.spineGraph.nodes().map((n) => pf.spineGraph.node(n));
      return geometryFactory.createMultiPointFromCoords(coords);
    }

    for (const { polygon, nodeSet } of Object.values(cells)) {
      if (nodeSet.size > 0) {
        const envelope = polygon.getEnvelopeInternal();
        const geometry = polygon;
        const nodes = Array.from(nodeSet);
        pf.cellTree.insert(envelope, { geometry, nodes });
      }
    }

    pf.spinePaths = graphlib.alg.dijkstraAll(
      pf.spineGraph,
      (e) => pf.spineGraph.edge(e),
      (v) => pf.spineGraph.nodeEdges(v) ?? [],
    );

    return pf;
  }

  getAccess(
    input: PathFinderGeometry,
    isInterior = false,
  ): { node: string; coordinate: Coordinate }[] {
    if (input instanceof Coordinate) {
      return this.getAccess(geometryFactory.createPoint(input), isInterior);
    }
    if (input instanceof Point) {
      const coordinate = input.getCoordinate();
      if (!isInterior && this.locator.locate(coordinate) === Location.EXTERIOR) {
        return this.getAccess(this.indexedFacetDistance.nearestPoints(input)[0], true);
      }
      const envelope = new Envelope(coordinate);
      const item = { geometry: input };
      const itemDistance = new GeometryItemDistance();
      const cell = this.cellTree.nearestNeighbour(envelope, item, itemDistance);
      return cell.nodes.map((node: string) => {
        return { node, coordinate };
      });
    }

    if (!isInterior) {
      const intersection = OverlayOp.intersection(this.polygon, input);
      if (intersection.isEmpty()) {
        return this.getAccess(this.indexedFacetDistance.nearestPoints(input)[0], true);
      } else {
        return this.getAccess(intersection, true);
      }
    }

    const nodes = new Set<string>();
    const cells = this.cellTree.query(input.getEnvelopeInternal());
    for (const cell of cells) {
      if (RelateOp.intersects(cell.geometry, input)) {
        for (const node of cell.nodes) {
          nodes.add(node);
        }
      }
    }

    const inputIFD = new IndexedFacetDistance(input);
    return Array.from(nodes).map((n) => {
      const point = geometryFactory.createPoint(this.spineGraph.node(n));
      return { node: n, coordinate: inputIFD.nearestPoints(point)[0] };
    });
  }

  findPath(start: PathFinderGeometry, end: PathFinderGeometry): LineString {
    const starts = this.getAccess(start);
    const ends = this.getAccess(end);

    let startAccess = starts[0];
    let endAccess = ends[0];
    let minPathLength = this.spinePaths[startAccess.node][endAccess.node].distance;
    for (let i = 0; i < starts.length; i++) {
      for (let j = 0; j < ends.length; j++) {
        const pathLength = this.spinePaths[starts[i].node][ends[j].node].distance;
        if (pathLength < minPathLength) {
          startAccess = starts[i];
          endAccess = ends[j];
          minPathLength = pathLength;
        }
      }
    }

    if (
      this.spinePaths[startAccess.node][endAccess.node] !== null &&
      this.spinePaths[startAccess.node][endAccess.node].distance < Infinity
    ) {
      let currNode = endAccess.node;
      const coords = [endAccess.coordinate];
      coords.push(this.spineGraph.node(currNode));
      while (currNode !== startAccess.node) {
        const prevNode = this.spinePaths[startAccess.node][currNode].predecessor;
        coords.push(this.spineGraph.node(prevNode));
        currNode = prevNode;
      }
      coords.push(this.spineGraph.node(startAccess.node));
      coords.push(startAccess.coordinate);
      if (coords.length > 1) {
        return geometryFactory.createLineString(coords).reverse();
      } else {
        return geometryFactory.createLineString();
      }
    } else {
      return geometryFactory.createLineString();
    }
  }
}
