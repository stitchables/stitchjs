import {
  Coordinate,
  Point,
  MultiPoint,
  LineString,
  Envelope,
  Polygon,
  Location,
} from 'jsts/org/locationtech/jts/geom';
import IndexedPointInAreaLocator from 'jsts/org/locationtech/jts/algorithm/locate/IndexedPointInAreaLocator';
import IndexedFacetDistance from 'jsts/org/locationtech/jts/operation/distance/IndexedFacetDistance';
import ConformingDelaunayTriangulationBuilder from 'jsts/org/locationtech/jts/triangulate/ConformingDelaunayTriangulationBuilder';
import ConformingDelaunayTriangulator from 'jsts/org/locationtech/jts/triangulate/ConformingDelaunayTriangulator';
import DelaunayTriangulationBuilder from 'jsts/org/locationtech/jts/triangulate/DelaunayTriangulationBuilder';
import Segment from 'jsts/org/locationtech/jts/triangulate/Segment';
import QuadEdgeSubdivision from 'jsts/org/locationtech/jts/triangulate/quadedge/QuadEdgeSubdivision';
import QuadEdge from 'jsts/org/locationtech/jts/triangulate/quadedge/QuadEdge';
import { STRtree } from 'jsts/org/locationtech/jts/index/strtree';
import ItemBoundable from 'jsts/org/locationtech/jts/index/strtree/ItemBoundable';
import RelateOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp';
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp';
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp';
import MaximumInscribedCircle from 'jsts/org/locationtech/jts/algorithm/construct/MaximumInscribedCircle';
import ArrayList from 'jsts/java/util/ArrayList';
import { geometryFactory } from '../util/jsts';
import * as graphlib from '@dagrejs/graphlib';
import { Line } from '../CSG/Line';

class CustomItemDistance {
  distance(item1: ItemBoundable, item2: ItemBoundable) {
    return item1.getItem().geometry.distance(item2.getItem().geometry);
  }
}

type Geometry = Point | MultiPoint | LineString | Polygon;

export default class NavMeshPolygonPathFinder {
  polygon: Polygon;
  graph: graphlib.Graph<null, Coordinate, number>;
  tGraph: graphlib.Graph;
  tree: STRtree;
  paths: Record<string, Record<string, graphlib.Path>>;
  tPaths: Record<string, Record<string, graphlib.Path>>;
  constructor(
    polygon: Polygon,
    sites = geometryFactory.createMultiPoint(),
    distanceTolerance = 10,
  ) {
    this.polygon = polygon;

    const locator = new IndexedPointInAreaLocator(polygon);
    const ifd = new IndexedFacetDistance(this.polygon);

    const cdtb = new ConformingDelaunayTriangulationBuilder();
    cdtb.setConstraints(this.polygon.getBoundary());
    if (!sites.isEmpty()) {
      cdtb.setSites(sites);
    } else {
      cdtb.setSites(
        geometryFactory.createMultiPointFromCoords(
          poissonDiskSample(
            this.polygon.getEnvelopeInternal(),
            distanceTolerance,
            locator,
          ),
        ),
      );
    }
    this.create(cdtb);
    const subdivision = cdtb.getSubdivision();

    this.tGraph = new graphlib.Graph();
    const edgeToTriangle = new Map<string, string>();
    function coordKey(c: Coordinate) {
      return `${c.x},${c.y}`;
    }
    function triangleId(coords: Coordinate[]) {
      return coords.map(coordKey).sort().join(';');
    }
    function edgeKey(from: Coordinate, to: Coordinate) {
      return `${coordKey(from)}|${coordKey(to)}`;
    }
    function inCenter(coords: Coordinate[]) {
      let x = 0,
        y = 0,
        p = 0;
      for (let i = 0; i < 3; i++) {
        const s = coords[(i + 1) % 3].distance(coords[(i + 2) % 3]);
        x += coords[i].x * s;
        y += coords[i].y * s;
        p += s;
      }
      return new Coordinate(x / p, y / p);
    }
    subdivision.visitTriangles(
      {
        visit: (triEdges: QuadEdge[]) => {
          const coords = triEdges.map((e) => e.orig().getCoordinate());
          const center = inCenter(coords);
          if (locator.locate(center) === Location.INTERIOR) {
            const id = triangleId(coords);
            const nodes = coords.map(coordKey);

            this.tGraph.setNode(id, { id, coords, nodes, center });

            for (let i = 0; i < 3; i++) {
              const a = coords[i];
              const b = coords[(i + 1) % 3];
              const m = new Coordinate((a.x + b.x) / 2, (a.y + b.y) / 2);
              const eKey = edgeKey(a, b);
              const otherTriangleId = edgeToTriangle.get(edgeKey(b, a));

              if (otherTriangleId && otherTriangleId !== id) {
                this.tGraph.setEdge(id, otherTriangleId, {
                  sharedEdge: [a, b],
                  edgeKey: eKey,
                  weight:
                    a.distance(b) / (ifd.distance(geometryFactory.createPoint(m)) + 1),
                });
                this.tGraph.setEdge(otherTriangleId, id, {
                  sharedEdge: [b, a],
                  edgeKey: edgeKey(b, a),
                  weight:
                    a.distance(b) / (ifd.distance(geometryFactory.createPoint(m)) + 1),
                });
              } else {
                edgeToTriangle.set(eKey, id);
              }
            }
          }
        },
      },
      false,
    );

    this.tPaths = graphlib.alg.dijkstraAll(
      this.tGraph,
      (e) => this.tGraph.edge(e).weight,
      (v) => this.tGraph.outEdges(v) ?? [],
    );

    this.graph = new graphlib.Graph<null, Coordinate, number>({ directed: false });
    this.tree = new STRtree();
    subdivision.visitTriangles(
      {
        visit: (triEdges: QuadEdge[]) => {
          const [a, b, c] = triEdges.map((e) => e.orig().getCoordinate());
          const [sa, sb, sc] = [b.distance(c), c.distance(a), a.distance(b)];
          const xn = sa * a.x + sb * b.x + sc * c.x;
          const yn = sa * a.y + sb * b.y + sc * c.y;
          const denom = sa + sb + sc;
          const inCenter = new Coordinate(xn / denom, yn / denom);
          if (locator.locate(inCenter) === Location.INTERIOR) {
            const nodes = [a.toString(), b.toString(), c.toString()];
            const coords = [a, b, c];
            for (let i = 0; i < 3; i++) {
              if (!this.graph.hasNode(nodes[i])) this.graph.setNode(nodes[i], coords[i]);
            }
            for (let i = 0; i < 3; i++) {
              const j = (i + 1) % 3;
              if (!this.graph.hasEdge(nodes[i], nodes[j])) {
                const midCoord = new Coordinate(
                  (coords[i].x + coords[j].x) / 2,
                  (coords[i].y + coords[j].y) / 2,
                );
                const midPoint = geometryFactory.createPoint(midCoord);
                const l = coords[i].distance(coords[j]);
                this.graph.setEdge(nodes[i], nodes[j], l / (ifd.distance(midPoint) + 1));
              }
            }
            const geometry = geometryFactory.createPolygon([a, b, c, a]);
            const envelope = geometry.getEnvelopeInternal();
            this.tree.insert(envelope, { geometry, nodes, id: triangleId([a, b, c]) });
          }
        },
      },
      false,
    );

    this.paths = graphlib.alg.dijkstraAll(
      this.graph,
      (e) => this.graph.edge(e),
      (v) => this.graph.nodeEdges(v) ?? [],
    );
  }

  findPath(start: Geometry, end: Geometry, isIntersecting = false): LineString {
    let startBoundary, endBoundary;
    if (start instanceof Point || start instanceof MultiPoint) startBoundary = start;
    else {
      // @ts-ignore
      startBoundary = start.getBoundary();
    }
    if (end instanceof Point || end instanceof MultiPoint) endBoundary = end;
    else {
      // @ts-ignore
      endBoundary = end.getBoundary();
    }

    // if (!isIntersecting) {
    //   const isStartIntersects = RelateOp.intersects(this.polygon, startBoundary);
    //   const isEndIntersects = RelateOp.intersects(this.polygon, endBoundary);
    //   if (!isStartIntersects || !isEndIntersects) {
    //     return this.findTrianglePath(
    //       isStartIntersects ? start : geometryFactory.createPoint(DistanceOp.nearestPoints(this.polygon, startBoundary)[0]),
    //       isEndIntersects ? end : geometryFactory.createPoint(DistanceOp.nearestPoints(this.polygon, endBoundary)[0]),
    //       true
    //     );
    //   }
    // }

    const entryCandidates = [];
    if (
      !(startBoundary instanceof Point) &&
      RelateOp.intersects(this.polygon, startBoundary)
    ) {
      const neighbors = this.tree.query(startBoundary.getEnvelopeInternal());
      for (let i = neighbors.iterator(); i.hasNext(); ) {
        const { geometry, nodes, id } = i.next();
        if (RelateOp.intersects(geometry, startBoundary)) {
          entryCandidates.push(id);
        }
      }
    } else {
      const projection = geometryFactory.createPoint(
        DistanceOp.nearestPoints(this.polygon, startBoundary)[0],
      );
      entryCandidates.push(
        this.tree.nearestNeighbour(
          projection.getEnvelopeInternal(),
          { geometry: projection },
          new CustomItemDistance(),
        ).id,
      );
    }

    const exitCandidates = [];
    if (
      !(endBoundary instanceof Point) &&
      RelateOp.intersects(this.polygon, endBoundary)
    ) {
      const neighbors = this.tree.query(endBoundary.getEnvelopeInternal());
      for (let i = neighbors.iterator(); i.hasNext(); ) {
        const { geometry, nodes, id } = i.next();
        if (RelateOp.intersects(geometry, endBoundary)) {
          exitCandidates.push(id);
        }
      }
    } else {
      const projection = geometryFactory.createPoint(
        DistanceOp.nearestPoints(this.polygon, endBoundary)[0],
      );
      exitCandidates.push(
        this.tree.nearestNeighbour(
          projection.getEnvelopeInternal(),
          { geometry: projection },
          new CustomItemDistance(),
        ).id,
      );
    }

    let entry, exit;
    let minPathLength = Infinity;
    for (let i = 0; i < entryCandidates.length; i++) {
      for (let j = 0; j < exitCandidates.length; j++) {
        const pathLength = this.tPaths[entryCandidates[i]][exitCandidates[j]].distance;
        if (pathLength < minPathLength) {
          entry = entryCandidates[i];
          exit = exitCandidates[j];
          minPathLength = pathLength;
        }
      }
    }

    // const entryIntersection = OverlayOp.intersection(
    //   startBoundary,
    //   geometryFactory.createPolygon([...this.tGraph.node(entry).coords, this.tGraph.node(entry).coords[0]])
    // );
    // const exitIntersection = OverlayOp.intersection(
    //   endBoundary,
    //   geometryFactory.createPolygon([...this.tGraph.node(entry).coords, this.tGraph.node(entry).coords[0]])
    // );
    // const portals = [{ left: , right: }]

    if (
      this.tPaths[entry][exit] !== null &&
      this.tPaths[entry][exit].distance < Infinity
    ) {
      let currNode = exit;
      const nodes = [];
      const portals = [];
      nodes.push(currNode);
      while (currNode !== entry) {
        const prevNode = this.tPaths[entry][currNode].predecessor;
        const [left, right] = this.tGraph.edge(prevNode, currNode).sharedEdge;
        portals.push({ left, right });
        nodes.push(prevNode);
        currNode = prevNode;
      }
      if (portals.length === 0)
        return geometryFactory.createLineString(
          DistanceOp.nearestPoints(startBoundary, endBoundary),
        );
      const exitPortal = DistanceOp.nearestPoints(
        endBoundary,
        geometryFactory.createLineString([portals[0].left, portals[0].right]),
      )[0];
      portals.unshift({ left: exitPortal, right: exitPortal });
      portals.reverse();
      const entryPortal = DistanceOp.nearestPoints(
        startBoundary,
        geometryFactory.createLineString([portals[0].left, portals[0].right]),
      )[0];
      portals.unshift({ left: entryPortal, right: entryPortal });
      return this.funnel(portals);
      // return { nodes, line: this.funnel(portals) };
    }
    return geometryFactory.createLineString();
  }

  funnel(portals: { left: Coordinate; right: Coordinate }[]): LineString {
    function triArea2(a: Coordinate, b: Coordinate, c: Coordinate) {
      return (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    }

    function vdistsq(a: Coordinate, b: Coordinate) {
      return (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    }
    const pts = [];

    // Initialize apex, left, and right points
    let apexIndex = 0;
    let leftIndex = 0;
    let rightIndex = 0;

    let apex = portals[0].left;
    let funnelLeft = portals[0].left;
    let funnelRight = portals[0].right;

    pts.push(apex);

    for (let i = 1; i < portals.length; i++) {
      const left = portals[i].left;
      const right = portals[i].right;

      // --- Update Right Wall ---
      // Does the new right point tighten the funnel side?
      if (triArea2(apex, funnelRight, right) <= 0) {
        if (apex === funnelRight || triArea2(apex, funnelLeft, right) > 0) {
          // Tighten the funnel inward
          funnelRight = right;
          rightIndex = i;
        } else {
          // Right crossed over Left! Left becomes the new apex.
          apex = funnelLeft;
          apexIndex = leftIndex;
          pts.push(apex);

          // Restart scan from the new apex
          funnelLeft = apex;
          funnelRight = apex;
          leftIndex = apexIndex;
          rightIndex = apexIndex;
          i = apexIndex;
          continue;
        }
      }

      // --- Update Left Wall ---
      // Does the new left point tighten the funnel side?
      if (triArea2(apex, funnelLeft, left) >= 0) {
        if (apex === funnelLeft || triArea2(apex, funnelRight, left) < 0) {
          // Tighten the funnel inward
          funnelLeft = left;
          leftIndex = i;
        } else {
          // Left crossed over Right! Right becomes the new apex.
          apex = funnelRight;
          apexIndex = rightIndex;
          pts.push(apex);

          // Restart scan from the new apex
          funnelLeft = apex;
          funnelRight = apex;
          leftIndex = apexIndex;
          rightIndex = apexIndex;
          i = apexIndex;
          continue;
        }
      }
    }

    // Add the destination point if it isn't already there
    const lastPoint = portals[portals.length - 1].left;
    if (pts.length === 0 || vdistsq(pts[pts.length - 1], lastPoint) > 0.00001) {
      pts.push(lastPoint);
    }

    return geometryFactory.createLineString(pts);
  }

  oldFindPath(
    start: Geometry,
    end: Geometry,
  ): { s: Coordinate[]; t: Coordinate[]; path: LineString } {
    let startBoundary, endBoundary;
    if (start instanceof Point || start instanceof MultiPoint) startBoundary = start;
    else {
      // @ts-ignore
      startBoundary = start.getBoundary();
    }
    if (end instanceof Point || end instanceof MultiPoint) endBoundary = end;
    else {
      // @ts-ignore
      endBoundary = end.getBoundary();
    }

    let entryCandidates;
    if (RelateOp.intersects(this.polygon, startBoundary)) {
      const neighbors = this.tree.query(startBoundary.getEnvelopeInternal());
      const nodeSet = new Set<string>();
      for (let i = neighbors.iterator(); i.hasNext(); ) {
        const { geometry, nodes } = i.next();
        if (RelateOp.intersects(geometry, startBoundary)) {
          nodes.forEach((node: string) => nodeSet.add(node));
        }
      }
      entryCandidates = Array.from(nodeSet);
    } else {
      const projection = geometryFactory.createPoint(
        DistanceOp.nearestPoints(this.polygon, startBoundary)[0],
      );
      entryCandidates = this.tree.nearestNeighbour(
        projection.getEnvelopeInternal(),
        { geometry: projection },
        new CustomItemDistance(),
      ).nodes;
    }

    let exitCandidates;
    if (RelateOp.intersects(this.polygon, endBoundary)) {
      const neighbors = this.tree.query(endBoundary.getEnvelopeInternal());
      const nodeSet = new Set<string>();
      for (let i = neighbors.iterator(); i.hasNext(); ) {
        const { geometry, nodes } = i.next();
        if (RelateOp.intersects(geometry, endBoundary)) {
          nodes.forEach((node: string) => nodeSet.add(node));
        }
      }
      exitCandidates = Array.from(nodeSet);
    } else {
      const projection = geometryFactory.createPoint(
        DistanceOp.nearestPoints(this.polygon, endBoundary)[0],
      );
      exitCandidates = this.tree.nearestNeighbour(
        projection.getEnvelopeInternal(),
        { geometry: projection },
        new CustomItemDistance(),
      ).nodes;
    }

    let entry, exit;
    let minPathLength = Infinity;
    for (let i = 0; i < entryCandidates.length; i++) {
      for (let j = 0; j < exitCandidates.length; j++) {
        const pathLength = this.paths[entryCandidates[i]][exitCandidates[j]].distance;
        if (pathLength < minPathLength) {
          entry = entryCandidates[i];
          exit = exitCandidates[j];
          minPathLength = pathLength;
        }
      }
    }

    if (this.paths[entry][exit] !== null && this.paths[entry][exit].distance < Infinity) {
      let currNode = exit;
      const coords = [];
      coords.push(this.graph.node(currNode));
      while (currNode !== entry) {
        const prevNode = this.paths[entry][currNode].predecessor;
        coords.push(this.graph.node(prevNode));
        currNode = prevNode;
      }
      coords.push(this.graph.node(entry));
      if (coords.length > 1) {
        return {
          s: entryCandidates.map((n: string) => this.graph.node(n)),
          t: exitCandidates.map((n: string) => this.graph.node(n)),
          path: geometryFactory.createLineString(coords).reverse(),
        };
      } else {
        return geometryFactory.createLineString();
      }
    }
    return geometryFactory.createLineString();
  }

  create(cdtb: ConformingDelaunayTriangulationBuilder) {
    if (cdtb._subdiv !== null) return null;
    const siteEnv = DelaunayTriangulationBuilder.envelope(cdtb._siteCoords);
    let segments = new ArrayList(0);
    if (cdtb._constraintLines !== null) {
      siteEnv.expandToInclude(cdtb._constraintLines.getEnvelopeInternal());
      cdtb.createVertices(cdtb._constraintLines);
      segments = ConformingDelaunayTriangulationBuilder.createConstraintSegments(
        cdtb._constraintLines,
      );
    }
    const sites = cdtb.createSiteVertices(cdtb._siteCoords);
    const cdt = new ConformingDelaunayTriangulator(sites, cdtb._tolerance);
    // @ts-ignore
    cdt.setConstraints(segments, new ArrayList(cdtb._constraintVertexMap.values()));
    cdt.formInitialDelaunay();

    // cdt.enforceConstraints()
    function enforceGabriel(
      cdt: ConformingDelaunayTriangulator,
      segsToInsert: ArrayList,
    ) {
      const newSegments = new ArrayList(0);
      let splits = 0;
      const segsToRemove = new ArrayList(0);
      for (let i = segsToInsert.iterator(); i.hasNext(); ) {
        const seg = i.next();
        const encroachPt = cdt.findNonGabrielPoint(seg);
        if (encroachPt === null) continue;
        cdt._splitPt = cdt._splitFinder.findSplitPoint(seg, encroachPt);
        const splitVertex = cdt.createVertex(cdt._splitPt, seg);
        const insertedVertex = cdt.insertSite(splitVertex);
        if (!insertedVertex.getCoordinate().equals2D(cdt._splitPt)) {
        }
        const s1 = new Segment(
          seg.getStartX(),
          seg.getStartY(),
          seg.getStartZ(),
          splitVertex.getX(),
          splitVertex.getY(),
          splitVertex.getZ(),
          seg.getData(),
        );
        const s2 = new Segment(
          splitVertex.getX(),
          splitVertex.getY(),
          splitVertex.getZ(),
          seg.getEndX(),
          seg.getEndY(),
          seg.getEndZ(),
          seg.getData(),
        );
        newSegments.add(s1);
        newSegments.add(s2);
        segsToRemove.add(seg);
        splits = splits + 1;
      }
      for (let i = segsToRemove.iterator(); i.hasNext(); ) {
        segsToInsert.remove(i.next());
      }
      segsToInsert.addAll(newSegments);
      return splits;
    }
    function enforceConstraints(cdt: ConformingDelaunayTriangulator) {
      cdt.addConstraintVertices();
      let count = 0;
      let splits = 0;
      do {
        // splits = cdt.enforceGabriel(cdt._segments)
        splits = enforceGabriel(cdt, cdt._segments);
        count++;
      } while (splits > 0 && count < ConformingDelaunayTriangulator.MAX_SPLIT_ITER);
      if (count === ConformingDelaunayTriangulator.MAX_SPLIT_ITER)
        console.log(
          `Too many splitting iterations while enforcing constraints.  Last split point was at: ${cdt._splitPt}`,
        );
      // throw new ConstraintEnforcementException('Too many splitting iterations while enforcing constraints.  Last split point was at: ', this._splitPt)
    }
    enforceConstraints(cdt);

    cdtb._subdiv = cdt.getSubdivision();
  }
}

function poissonDiskSample(
  envelope: Envelope,
  radius: number,
  locator: IndexedPointInAreaLocator,
  k = 30,
): Coordinate[] {
  const xMin = envelope.getMinX();
  const yMin = envelope.getMinY();
  const width = envelope.getWidth();
  const height = envelope.getHeight();
  const radius2 = radius * radius;
  const cellSize = radius / Math.sqrt(2);
  const gridWidth = Math.ceil(width / cellSize);
  const gridHeight = Math.ceil(height / cellSize);
  const grid = new Array(gridWidth * gridHeight).fill(null);
  const points: number[][] = [];
  const activeQueue: number[][] = [];

  function insertPoint(x: number, y: number): void {
    const p = [x, y];
    if (locator.locate(new Coordinate(p[0] + xMin, p[1] + yMin)) === Location.INTERIOR) {
      points.push(p);
    }
    activeQueue.push(p);
    const col = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);
    grid[col + row * gridWidth] = p;
  }

  insertPoint(Math.random() * width, Math.random() * height);
  while (activeQueue.length > 0) {
    // Pick a random existing active point
    const activeIndex = (Math.random() * activeQueue.length) | 0;
    const p = activeQueue[activeIndex];
    let foundValidCandidate = false;

    // Try up to k times to find a valid sample around the active point
    for (let i = 0; i < k; i++) {
      // Sample uniformly from the spherical shell between radius and 2*radius
      const angle = Math.random() * Math.PI * 2;
      const currentRadius = radius + Math.random() * radius;
      const cx = p[0] + currentRadius * Math.cos(angle);
      const cy = p[1] + currentRadius * Math.sin(angle);

      // Check boundaries
      if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
        const col = Math.floor(cx / cellSize);
        const row = Math.floor(cy / cellSize);

        // Scan neighboring cells within a 5x5 area in the grid
        const minCol = Math.max(0, col - 2);
        const maxCol = Math.min(gridWidth - 1, col + 2);
        const minRow = Math.max(0, row - 2);
        const maxRow = Math.min(gridHeight - 1, row + 2);

        let isFarEnough = true;

        for (let r = minRow; r <= maxRow; r++) {
          for (let c = minCol; c <= maxCol; c++) {
            const neighbor = grid[c + r * gridWidth];
            if (neighbor) {
              const dx = cx - neighbor[0];
              const dy = cy - neighbor[1];
              if (dx * dx + dy * dy < radius2) {
                isFarEnough = false;
                break;
              }
            }
          }
          if (!isFarEnough) break;
        }

        if (isFarEnough) {
          insertPoint(cx, cy);
          foundValidCandidate = true;
          break;
        }
      }
    }

    // If no candidate point could be found nearby, remove from active queue
    if (!foundValidCandidate) {
      activeQueue.splice(activeIndex, 1);
    }
  }

  return points.map((p) => new Coordinate(p[0] + xMin, p[1] + yMin));
}
