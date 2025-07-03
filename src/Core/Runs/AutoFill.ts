import { IRun } from '../IRun';
import { Polyline } from '../../Math/Polyline';
import { Vector } from '../../Math/Vector';
import {
  GeometryFactory,
  Geometry,
  Polygon,
  Coordinate,
  LinearRing,
  LineString,
  LineSegment,
  MultiLineString,
  Point,
  Envelope,
} from 'jsts/org/locationtech/jts/geom';
import { MinimumBoundingCircle } from 'jsts/org/locationtech/jts/algorithm';
import { OverlayOp } from 'jsts/org/locationtech/jts/operation/overlay';
import { DistanceOp } from 'jsts/org/locationtech/jts/operation/distance';
import { LengthIndexedLine } from 'jsts/org/locationtech/jts/linearref';
import { LineStringExtracter } from 'jsts/org/locationtech/jts/geom/util';
import { GeometrySnapper } from 'jsts/org/locationtech/jts/operation/overlay/snap';
import { STRtree } from 'jsts/org/locationtech/jts/index/strtree';
import IndexedFacetDistance from 'jsts/org/locationtech/jts/operation/distance/IndexedFacetDistance';

import * as graphlib from 'graphlib';
import { Stitch } from '../Stitch';
import { geometryFactory } from '../../util/jsts';
import { Utils } from '../../Math/Utils';

export class AutoFill implements IRun {
  shell: Polyline;
  holes: Polyline[];
  angle: number;
  rowSpacingMm: number;
  // fillStitchLengthMm: number;
  fillPattern: {
    rowOffsetMm: number;
    rowPatternMm: number[];
  }[] = [];
  travelStitchLengthMm: number;
  startPosition: Vector;
  endPosition: Vector;
  centerPosition: Vector;
  underpath?: boolean;

  geometryFactory: GeometryFactory;
  // rings: LinearRing[];
  polygon: Polygon;
  boundary: Geometry;
  boundingRadius: number;
  shapeGeoms: {
    geometry: LinearRing;
    lengthIndexedLine: LengthIndexedLine;
  }[];

  constructor(
    shell: Polyline,
    holes: Polyline[],
    angle: number,
    rowSpacingMm: number,
    fillPattern: {
      rowOffsetMm: number;
      rowPatternMm: number[];
    }[],
    travelStitchLengthMm: number,
    startPosition: Vector,
    endPosition: Vector,
    centerPosition?: Vector,
    underpath = true,
  ) {
    this.shell = shell;
    this.holes = holes;
    this.angle = angle;
    this.rowSpacingMm = rowSpacingMm;
    this.fillPattern = fillPattern;
    this.travelStitchLengthMm = travelStitchLengthMm;
    this.startPosition = startPosition;
    this.endPosition = endPosition;
    this.underpath = underpath;

    // this.geometryFactory = new GeometryFactory();
    this.geometryFactory = geometryFactory;
    const shellRing = this.geometryFactory.createLinearRing(
      this.shell.vertices.map((v) => new Coordinate(v.x, v.y)),
    );
    const holeRings = this.holes.map((h) =>
      this.geometryFactory.createLinearRing(
        h.vertices.map((v) => new Coordinate(v.x, v.y)),
      ),
    );
    this.polygon =
      this.holes.length > 0
        ? this.geometryFactory.createPolygon(shellRing, holeRings)
        : this.geometryFactory.createPolygon(shellRing);
    this.boundary = this.polygon.getBoundary();
    this.shapeGeoms = [shellRing, ...holeRings].map((r) => ({
      geometry: r,
      lengthIndexedLine: new LengthIndexedLine(r),
    }));

    const minimumBoundingCircle = new MinimumBoundingCircle(this.polygon);
    const boundingCenter = minimumBoundingCircle.getCentre();
    this.boundingRadius = minimumBoundingCircle.getRadius();
    if (centerPosition !== undefined) {
      this.centerPosition = centerPosition;
      this.boundingRadius += boundingCenter.distance(
        new Coordinate(centerPosition.x, centerPosition.y),
      );
    } else {
      this.centerPosition = new Vector(boundingCenter.x, boundingCenter.y);
    }
  }

  getStitches(pixelsPerMm: number): Stitch[] {
    const fillRows = this.getRows(
      this.centerPosition,
      this.angle,
      this.boundingRadius,
      pixelsPerMm * this.rowSpacingMm,
      'fill',
    );
    // console.log(fillRows);
    const fillSegments = LineStringExtracter.getGeometry(
      OverlayOp.intersection(this.polygon, fillRows),
    );
    console.log(fillSegments);
    const fillStitchGraph = this.buildFillStitchGraph(fillSegments);
    // console.log(fillStitchGraph);
    const travelGraph = this.buildTravelGraph(fillStitchGraph, pixelsPerMm);
    // console.log(travelGraph);
    const path = this.findStitchPath(fillStitchGraph, travelGraph);
    // console.log(path);
    // console.log(this.pathToStitches(path, travelGraph, fillStitchGraph));
    return this.pathToStitches(path, travelGraph, fillStitchGraph, pixelsPerMm).map(
      (c) => new Stitch(new Vector(c.x, c.y)),
    );
  }

  getRows(center: Vector, angle: number, radius: number, spacing: number, label = '') {
    const dir = Vector.fromAngle(angle).multiply(radius);
    const p1 = center.add(dir);
    const p2 = center.subtract(dir);
    const n = Vector.fromAngle(angle + 0.5 * Math.PI);
    let lineStrings = [
      this.buildLineString([new Coordinate(p1.x, p1.y), new Coordinate(p2.x, p2.y)], {
        index: 0,
      }),
    ];
    for (let i = 0, r = spacing; r < radius; i++, r += spacing) {
      const offset = n.multiply(r);
      lineStrings.push(
        this.buildLineString(
          [
            new Coordinate(p1.x + offset.x, p1.y + offset.y),
            new Coordinate(p2.x + offset.x, p2.y + offset.y),
          ],
          { index: i + 1 },
        ),
      );
      lineStrings.push(
        this.buildLineString(
          [
            new Coordinate(p1.x - offset.x, p1.y - offset.y),
            new Coordinate(p2.x - offset.x, p2.y - offset.y),
          ],
          { index: -(i + 1) },
        ),
      );
    }
    return this.buildMultiLineString(lineStrings, { angle, label });
  }

  buildLineString(coords: Coordinate[], data: { index: number }): LineString {
    const ls = this.geometryFactory.createLineString(coords);
    ls.setUserData(data);
    return ls;
  }

  buildMultiLineString(
    lineStrings: LineString[],
    data: { index?: number; angle?: number; label?: string },
  ) {
    const mls = this.geometryFactory.createMultiLineString(lineStrings);
    mls.setUserData(data);
    return mls;
  }

  getClosestShapeOutlineIndex(pos: Point) {
    let [outlineIndex, minDistance] = [
      0,
      DistanceOp.distance(this.shapeGeoms[0].geometry, pos),
    ];
    for (let i = 1; i < this.shapeGeoms.length; i++) {
      const distance = DistanceOp.distance(this.shapeGeoms[i].geometry, pos);
      if (distance < minDistance) {
        [outlineIndex, minDistance] = [i, distance];
      }
    }
    return outlineIndex;
  }

  insertNode(graph: graphlib.Graph, pos: Point) {
    const outlineIndex = this.getClosestShapeOutlineIndex(pos);
    const projection = this.shapeGeoms[outlineIndex].lengthIndexedLine.project(
      pos.getCoordinate(),
    );
    const projectedCoord =
      this.shapeGeoms[outlineIndex].lengthIndexedLine.extractPoint(projection);
    const projectedPoint = this.geometryFactory.createPoint(projectedCoord);

    const edges = [];
    for (const e of graph.edges()) {
      const edge = graph.edge(e.v, e.w, e.name);
      const node = graph.node(e.v);
      if (edge.type === 'outline' && node.shapeIndex === outlineIndex) {
        edges.push([graph.edge(e), e, edge]);
      }
    }

    if (edges.length > 0) {
      let [edge, minDistance] = [edges[0], edges[0][2].geometry.distance(projectedCoord)];
      for (let i = 1; i < edges.length; i++) {
        const distance = edges[i][2].geometry.distance(projectedCoord);
        if (distance < minDistance) {
          [edge, minDistance] = [edges[i], distance];
        }
      }
      graph.removeEdge(edge[1].v, edge[1].w, edge[1].name);
      graph.setNode(projectedPoint, {
        geometry: projectedPoint,
        shapeIndex: outlineIndex,
        length: projection,
        projection: projectedCoord,
      });
      const geom1 = new LineSegment(
        graph.node(edge[1].v).geometry.getCoordinate(),
        projectedCoord,
      );
      graph.setEdge(
        edge[1].v,
        projectedPoint,
        { type: 'outline', geometry: geom1 },
        'outline',
      );
      const geom2 = new LineSegment(
        projectedCoord,
        graph.node(edge[1].w).geometry.getCoordinate(),
      );
      graph.setEdge(
        projectedPoint,
        edge[1].w,
        { type: 'outline', geometry: geom2 },
        'outline',
      );
    } else {
      console.error(
        'The node lies on an outline which has no intersection with any segment',
      );
    }

    return null;
  }

  buildFillStitchGraph(segments: MultiLineString) {
    let g = new graphlib.Graph({ directed: false, multigraph: true });

    // First, add the grating segments as edges.  We'll use the coordinates
    // of the endpoints as nodes.
    for (let i = 0, n = segments.getNumGeometries(); i < n; i++) {
      const ls = segments.getGeometryN(i);
      let p = ls.getPointN(0),
        q = null;
      g.setNode(p, { geometry: p });
      for (let j = 1, m = ls.getNumPoints(); j < m; j++) {
        q = ls.getPointN(j);
        g.setNode(q, { geometry: q });
        g.setEdge(p, q, {
          type: 'segment',
          geometry: new LineSegment(p, q),
          underpathEdges: [],
        });
        p = q;
      }
    }

    // Tag nodes with outline and projection
    for (let node of g.nodes()) {
      const label = g.node(node);
      for (let i = 0, n = this.shapeGeoms.length; i < n; i++) {
        if (label.geometry.isWithinDistance(this.shapeGeoms[i].geometry, 0.0001)) {
          label.shapeIndex = i;
          label.length = this.shapeGeoms[i].lengthIndexedLine.project(
            label.geometry.getCoordinate(),
          );
          label.projection = this.shapeGeoms[i].lengthIndexedLine.extractPoint(
            label.length,
          );
          g.setNode(node, label);
          break;
        }
      }
    }

    // Add edges between outline nodes
    for (let i = 0, n = this.shapeGeoms.length; i < n; i++) {
      const nodes = g
        .filterNodes((node) => g.node(node).shapeIndex === i)
        .nodes()
        .map((n) => [n, g.node(n)])
        .sort((a, b) => a[1].length - b[1].length);
      // const nodes = this.filterGraphNodes(g, (node, label) => label.shapeIndex === i).map(n => n.label).sort((a, b) => a.length - b.length);
      let n1 = nodes[0],
        n2 = null;
      for (let j = 1, m = nodes.length; j < m + 1; j++) {
        n2 = nodes[j % m];
        const geometry = new LineSegment(
          n1[1].geometry.getCoordinate(),
          n2[1].geometry.getCoordinate(),
        );
        g.setEdge(n1[0], n2[0], { type: 'outline', geometry }, 'outline');
        if (j % 2 === 0) {
          g.setEdge(n1[0], n2[0], { type: 'extra', geometry }, 'extra');
        }
        n1 = n2;
      }
    }

    if (this.startPosition) {
      this.insertNode(
        g,
        this.geometryFactory.createPoint(
          new Coordinate(this.startPosition.x, this.startPosition.y),
        ),
      );
    }

    if (this.endPosition) {
      this.insertNode(
        g,
        this.geometryFactory.createPoint(
          new Coordinate(this.endPosition.x, this.endPosition.y),
        ),
      );
    }

    return g;
  }

  buildTravelGraph(fillStitchGraph: graphlib.Graph, pixelsPerMm: number): graphlib.Graph {
    let g = new graphlib.Graph({ directed: false, multigraph: true });

    // Add all the nodes from the main graph.  This will be all of the endpoints
    // of the rows of stitches.  Every node will be on the outline of the shape.
    // They'll all already have their `outline` and `projection` tags set.
    for (const n of fillStitchGraph.nodes()) {
      g.setNode(n, fillStitchGraph.node(n));
    }
    let endpoints, travelEdges;
    let grating = true;
    if (this.underpath) {
      // Build the travel edges
      const rows1 = this.getRows(
        this.centerPosition,
        this.angle + 0.25 * Math.PI,
        this.boundingRadius,
        this.travelStitchLengthMm * pixelsPerMm,
        '+',
      );
      const rows2 = this.getRows(
        this.centerPosition,
        this.angle - 0.25 * Math.PI,
        this.boundingRadius,
        this.travelStitchLengthMm * pixelsPerMm,
        '-',
      );
      const rows3 = this.getRows(
        this.centerPosition,
        this.angle + 0.5 * Math.PI,
        this.boundingRadius,
        Math.sqrt(2) * this.travelStitchLengthMm * pixelsPerMm,
        '90',
      );
      const segs1 = OverlayOp.intersection(this.polygon, rows1);
      const segs2 = OverlayOp.intersection(this.polygon, rows2);
      const segs3 = OverlayOp.intersection(this.polygon, rows3);
      endpoints = this.geometryFactory.createMultiPointFromCoords([
        ...segs1.getCoordinates(),
        ...segs2.getCoordinates(),
        ...segs3.getCoordinates(),
      ]);
      const diagonalEdges = LineStringExtracter.getGeometry(
        OverlayOp.symDifference(segs1, segs2),
      );
      const verticalEdges = OverlayOp.difference(segs3, segs1);
      const snapper = new GeometrySnapper(verticalEdges);
      const snappedVerticalEdges = LineStringExtracter.getGeometry(
        snapper.snapTo(diagonalEdges, 0.005),
      );
      travelEdges = LineStringExtracter.getGeometry(
        this.geometryFactory.createGeometryCollection([
          diagonalEdges,
          snappedVerticalEdges,
        ]),
      );

      if (endpoints.getNumGeometries() === 0) {
        grating = false;
      } else {
        // tag nodes with outline and projection
        // This will ensure that a path traveling inside the shape can reach its
        // target on the outline, which will be one of the points added above.
        for (let i = 0, n = endpoints.getNumGeometries(); i < n; i++) {
          for (let j = 0, m = this.shapeGeoms.length; j < m; j++) {
            const point = endpoints.getGeometryN(i);
            const coord = point.getCoordinate();
            if (point.isWithinDistance(this.shapeGeoms[j].geometry, 0.0001)) {
              const length = this.shapeGeoms[j].lengthIndexedLine.project(coord);
              const projection =
                this.shapeGeoms[j].lengthIndexedLine.extractPoint(length);
              g.setNode(point, { geometry: point, shapeIndex: j, length, projection });
            }
          }
        }
      }
    }

    // add boundary travel nodes
    if (!this.underpath || !grating) {
      for (let i = 0, n = this.shapeGeoms.length; i < n; i++) {
        let prev = null;
        for (const p of this.shapeGeoms[i].geometry.getCoordinates()) {
          const pt = this.geometryFactory.createPoint(p);
          if (prev !== null) {
            // Subdivide long straight line segments.  Otherwise we may not
            // have a node near the user's chosen starting or ending point
            const segment = new LineSegment(prev, p);
            const length = segment.getLength();
            if (length > this.travelStitchLengthMm * pixelsPerMm) {
              for (
                let j = this.travelStitchLengthMm * pixelsPerMm;
                j < length;
                j += this.travelStitchLengthMm * pixelsPerMm
              ) {
                const coord = segment.pointAlong(j / length);
                const subpoint = this.geometryFactory.createPoint(coord);
                const len = this.shapeGeoms[i].lengthIndexedLine.project(coord);
                const projection = this.shapeGeoms[i].lengthIndexedLine.extractPoint(len);
                g.setNode(subpoint, {
                  geometry: subpoint,
                  shapeIndex: i,
                  length: len,
                  projection,
                });
              }
            }
          }
          const pLen = this.shapeGeoms[i].lengthIndexedLine.project(p);
          const pProj = this.shapeGeoms[i].lengthIndexedLine.extractPoint(pLen);
          g.setNode(pt, { geometry: pt, shapeIndex: i, length: pLen, projection: pProj });
          prev = p;
        }
      }
    }

    // add edges between outline nodes
    for (let i = 0, n = this.shapeGeoms.length; i < n; i++) {
      const nodes = g
        .filterNodes((node) => g.node(node).shapeIndex === i)
        .nodes()
        .map((n) => [n, g.node(n)])
        .sort((a, b) => a[1].length - b[1].length);
      let n1 = nodes[0],
        n2 = null;
      for (let j = 1, m = nodes.length; j < m + 1; j++) {
        n2 = nodes[j % m];
        const geometry = new LineSegment(
          n1[1].geometry.getCoordinate(),
          n2[1].geometry.getCoordinate(),
        );
        const d = geometry.getLength();
        g.setEdge(n1[0], n2[0], { type: 'outline', geometry, weight: 3 * d }, 'outline');
        if (j % 2 === 0) {
          g.setEdge(n1[0], n2[0], { type: 'extra', geometry, weight: 3 * d }, 'extra');
        }
        n1 = n2;
      }
    }

    if (this.underpath && grating) {
      const strTree = new STRtree(4);
      // for (const e of Object.entries(fillStitchGraph._edgeLabels)) {
      //   if (e[1].type === "segment") {
      //     const p = e[1].geometry.getCoordinate(0);
      //     const q = e[1].geometry.getCoordinate(1);
      //     strTree.insert(new jsts.geom.Envelope(p, q), e);
      //   }
      // }
      for (const e of fillStitchGraph.edges().map((e) => [e, fillStitchGraph.edge(e)])) {
        if (e[1].type === 'segment') {
          const p = e[1].geometry.p0.getCoordinate();
          const q = e[1].geometry.p1.getCoordinate();
          strTree.insert(new Envelope(p, q), e);
        }
      }

      const indexedFacetDistance = new IndexedFacetDistance(this.polygon);

      for (let i = 0, n = travelEdges.getNumGeometries(); i < n; i++) {
        const geometry = travelEdges.getGeometryN(i);
        let p = geometry.getPointN(0),
          q = null;
        for (let j = 1, m = geometry.getNumPoints(); j < m; j++) {
          q = geometry.getPointN(j);
          const ls = new LineSegment(p.getX(), p.getY(), q.getX(), q.getY());
          const length = ls.getLength();
          // const dToShape = this.shapeBoundary.distance(ls.toGeometry(this.factory));
          // const dToShape = Math.max(Math.min(indexedFacetDistance.distance(ls.toGeometry(this.factory)), this.maximumInscribedCircle.maxDistance) / this.maximumInscribedCircle.maxDistance, 0.0001);
          const dToShape = indexedFacetDistance.distance(
            ls.toGeometry(this.geometryFactory),
          );
          if (!g.hasNode(p)) g.setNode(p, { geometry: p });
          if (!g.hasNode(q)) g.setNode(q, { geometry: q });
          g.setEdge(
            p,
            q,
            { type: 'travel', geometry: ls, weight: length / (dToShape + 0.1) },
            'travel',
          );
          for (const [k, v] of strTree.query(
            new Envelope(p.getCoordinate(), q.getCoordinate()),
          )) {
            const p1 = new Vector(v.geometry.p0.getX(), v.geometry.p0.getY());
            const p2 = new Vector(v.geometry.p1.getX(), v.geometry.p1.getY());
            const q1 = new Vector(ls.p0.getX(), ls.p0.getY());
            const q2 = new Vector(ls.p1.getX(), ls.p1.getY());
            if (
              // v.geometry.lineIntersection(ls) // not sure why this isn't working?
              Utils.lineSegmentIntersection(p1, p2, q1, q2)
            ) {
              fillStitchGraph.edge(k).underpathEdges.push([p, q, 'travel']);
            }
          }
          p = q;
        }
      }
    }

    return g;
  }

  getNearestNode(graph: graphlib.Graph, pos: Point): string {
    let [node, minDistance] = [
      graph.nodes()[0],
      graph.node(graph.nodes()[0]).geometry.distance(pos),
    ];
    for (const [k, v] of graph.nodes().map((n) => [n, graph.node(n)])) {
      const distance = v.geometry.distance(pos);
      if (distance < minDistance) {
        [node, minDistance] = [k, distance];
      }
    }
    return node;
  }

  findStitchPath(
    fillStitchGraph: graphlib.Graph,
    travelGraph: graphlib.Graph,
  ): [string, string, string | null][] {
    const g = new graphlib.Graph({ directed: false, multigraph: true });
    const h = new graphlib.Graph({ directed: false, multigraph: true });
    for (const [k, v] of fillStitchGraph
      .nodes()
      .map((n) => [n, fillStitchGraph.node(n)])) {
      g.setNode(k, v);
      h.setNode(k, v);
    }
    for (const v of fillStitchGraph.edges()) {
      const edgeLabel = fillStitchGraph.edge(v.v, v.w, v.name);
      g.setEdge(v.v, v.w, edgeLabel, v.name);
      h.setEdge(
        v.v,
        v.w,
        {
          type: edgeLabel.type,
          geometry: edgeLabel.geometry,
          weight: edgeLabel.geometry.getLength(),
        },
        v.name,
      );
    }
    for (const [k, v] of travelGraph.nodes().map((n) => [n, travelGraph.node(n)]))
      h.setNode(k, v);
    for (const v of travelGraph.edges())
      h.setEdge(v.v, v.w, travelGraph.edge(v.v, v.w, v.name), v.name);

    const startingPoint: Point = this.startPosition
      ? this.geometryFactory.createPoint(
          new Coordinate(this.startPosition.x, this.startPosition.y),
        )
      : this.shapeGeoms[0].geometry.getCoordinates()[0];
    const startingNode = this.getNearestNode(fillStitchGraph, startingPoint);
    const endingPoint: Point = this.endPosition
      ? this.geometryFactory.createPoint(
          new Coordinate(this.endPosition.x, this.endPosition.y),
        )
      : startingPoint;
    const endingNode = this.endPosition
      ? this.getNearestNode(fillStitchGraph, endingPoint)
      : startingNode;

    //     console.log(startingNode);
    //     console.log(endingNode);

    //     for (let [k, v] of Object.entries(h._edgeLabels)) {
    //       if (!('weight' in v)) {
    //         console.log(v);
    //       }
    //     }

    const path: [string, string, string | null][] = [];
    const vertexStack: [string, string | null][] = [[endingNode, null]];
    let prevVertex: [string, string | null] = ['', null];

    while (vertexStack.length > 0) {
      const currVertex = vertexStack[vertexStack.length - 1];
      const neighbors = g.neighbors(currVertex[0]);
      if (neighbors?.length === 0) {
        if (prevVertex[0] !== null) {
          path.push([prevVertex[0], currVertex[0], prevVertex[1]]);
        }
        prevVertex = currVertex;
        vertexStack.pop();
      } else {
        const edges = g.nodeEdges(currVertex[0]);
        if (edges) {
          let pickEdge = edges[0];
          if (g.edge(pickEdge).type !== 'segment') {
            for (const e of edges) {
              if (g.edge(e).type === 'segment') {
                pickEdge = e;
                break;
              }
            }
          }
          vertexStack.push([
            currVertex[0] === pickEdge.v ? pickEdge.w : pickEdge.v,
            g.edge(pickEdge).type,
          ]);
          g.removeEdge(pickEdge);
        }
      }
    }

    if (
      this.underpath ||
      fillStitchGraph.node(startingNode).shapeIndex ===
        fillStitchGraph.node(endingNode).shapeIndex
    ) {
      if (startingNode !== endingNode) {
        path.unshift([startingNode, endingNode, 'initial']);
      }
    } else {
      const startPath = [];
      const dijkstra = graphlib.alg.dijkstra(
        h,
        startingNode,
        (e) => h.edge(e).weight || 1,
        (v) => h.nodeEdges(v) || [],
      );
      if (dijkstra[endingNode] !== null && dijkstra[endingNode].distance < Infinity) {
        let curr = endingNode;
        while (curr !== startingNode) {
          startPath.unshift(curr);
          curr = dijkstra[curr].predecessor;
        }
        startPath.unshift(startingNode);
      }
      for (let i = startPath.length - 1; i > 0; i--) {
        path.unshift([startPath[i - 1], startPath[i], `segment`]);
      }
    }

    // If the starting and/or ending point falls far away from the end of a row
    // of stitches (like can happen at the top of a square), then we need to
    // add travel stitch to that point.
    const realStart = this.getNearestNode(travelGraph, startingPoint);
    path.unshift([realStart, startingNode, 'outline']);

    // We're willing to start inside the shape, since we'll just cover the
    // stitches.  We have to end on the outline of the shape.  This is mostly
    // relevant in the case that the user specifies an underlay with an inset
    // value, because the starting point (and possibly ending point) can be
    // inside the shape.
    const outlineNodes = [];
    for (const k of travelGraph.nodes()) {
      let isOutline = false;
      for (const e of travelGraph.nodeEdges(k) || []) {
        if (e.name === 'outline') {
          isOutline = true;
          break;
        }
      }
      if (isOutline) {
        outlineNodes.push(k);
      }
    }

    let [realEnd, minDistance]: [string, number] = ['', Infinity];
    for (const node of outlineNodes) {
      const distance = travelGraph.node(node).geometry.distance(endingPoint);
      if (distance < minDistance) {
        [realEnd, minDistance] = [node, distance];
      }
    }
    path.push([endingNode, realEnd, 'outline']);

    return path;
  }

  pathToStitches(
    path: [string, string, string | null][],
    travelGraph: graphlib.Graph,
    fillStitchGraph: graphlib.Graph,
    pixelsPerMm: number,
  ): Coordinate[] {
    const collapsedPath = [];
    let runStart = null;
    for (const edge of path) {
      if (edge[2] === 'segment') {
        if (runStart !== null) {
          const neighbors = fillStitchGraph.neighbors(runStart);
          if (neighbors) {
            if (neighbors.includes(edge[0])) {
              collapsedPath.push([runStart, edge[0], 'outline']);
            } else {
              collapsedPath.push([runStart, edge[0], 'collapsed']);
            }
          }
          runStart = null;
        }
        collapsedPath.push(edge);
      } else {
        if (runStart === null) {
          runStart = edge[0];
        }
      }
    }
    if (runStart !== null && runStart !== path[path.length - 1][1]) {
      collapsedPath.push([runStart, path[path.length - 1][1], 'collapsed']);
    }

    const stitches = [];

    if (collapsedPath[0][2] !== 'segment') {
      stitches.push(fillStitchGraph.node(path[0][0]).geometry.getCoordinate());
    }

    for (let i = 0, n = collapsedPath.length; i < n; i++) {
      const edge = collapsedPath[i];
      if (edge[2] === 'segment') {
        const rowStart = new Vector(
          fillStitchGraph.node(edge[0]).geometry.getCoordinate().x,
          fillStitchGraph.node(edge[0]).geometry.getCoordinate().y,
        );
        const rowEnd = new Vector(
          fillStitchGraph.node(edge[1]).geometry.getCoordinate().x,
          fillStitchGraph.node(edge[1]).geometry.getCoordinate().y,
        );

        const rowDirection = rowEnd.subtract(rowStart).normalized();
        const rowLength = rowEnd.distance(rowStart);

        const rowStartBasis = changeOfBasis2D(
          rowStart.subtract(this.centerPosition),
          Vector.fromAngle(this.angle),
          Vector.fromAngle(this.angle + 0.5 * Math.PI),
        );
        const rowEndBasis = changeOfBasis2D(
          rowEnd.subtract(this.centerPosition),
          Vector.fromAngle(this.angle),
          Vector.fromAngle(this.angle + 0.5 * Math.PI),
        );

        const rowIndex = Math.round(rowStartBasis.y / (this.rowSpacingMm * pixelsPerMm));
        const patternIndex =
          ((rowIndex % this.fillPattern.length) + this.fillPattern.length) %
          this.fillPattern.length;
        const rowPatternSegments = this.fillPattern[patternIndex].rowPatternMm.length;

        const rowStitches = [];

        const minRowBasis = Math.min(rowStartBasis.x, rowEndBasis.x);
        const maxRowBasis = Math.max(rowStartBasis.x, rowEndBasis.x);

        let negRowPosition = this.fillPattern[patternIndex].rowOffsetMm * pixelsPerMm;
        let posRowPosition = this.fillPattern[patternIndex].rowOffsetMm * pixelsPerMm;
        if (minRowBasis < negRowPosition && maxRowBasis > posRowPosition) {
          rowStitches.push(negRowPosition);
        }
        let negRowPatternIndex = -1;
        let posRowPatternIndex = 0;
        while (
          negRowPosition > -this.boundingRadius &&
          posRowPosition < this.boundingRadius
        ) {
          negRowPatternIndex =
            ((negRowPatternIndex % rowPatternSegments) + rowPatternSegments) %
            rowPatternSegments;
          negRowPosition -=
            this.fillPattern[patternIndex].rowPatternMm[negRowPatternIndex] * pixelsPerMm;
          posRowPosition +=
            this.fillPattern[patternIndex].rowPatternMm[posRowPatternIndex] * pixelsPerMm;
          if (negRowPosition > minRowBasis && negRowPosition < maxRowBasis) {
            rowStitches.unshift(negRowPosition);
          }
          if (posRowPosition > minRowBasis && posRowPosition < maxRowBasis) {
            rowStitches.push(posRowPosition);
          }
          negRowPatternIndex--;
          posRowPatternIndex = (posRowPatternIndex + 1) % rowPatternSegments;
        }
        rowStitches.unshift(minRowBasis);
        rowStitches.push(maxRowBasis);
        // console.log(rowStitches);

        // stitches.push(new Coordinate(rowStart.x, rowStart.y));
        if (rowStartBasis.x > rowEndBasis.x) {
          for (let i = rowStitches.length - 1; i >= 0; i--) {
            const l = rowStart.lerp(rowEnd, Utils.map(rowStitches[i], rowStartBasis.x, rowEndBasis.x, 0, 1));
            if (rowStart.distance(l) > pixelsPerMm) {
              stitches.push(new Coordinate(l.x, l.y));
            }
          }
        } else {
          for (let i = 0; i < rowStitches.length; i++) {
            const l = rowStart.lerp(rowEnd, Utils.map(rowStitches[i], rowStartBasis.x, rowEndBasis.x, 0, 1));
            if (rowStart.distance(l) > pixelsPerMm) {
              stitches.push(new Coordinate(l.x, l.y));
            }
          }
        }
        // stitches.push(new Coordinate(rowEnd.x, rowEnd.y));

        // stitches.push(new Coordinate(rowStart.x, rowStart.y));
        // let offset = this.fillPattern[patternIndex].rowOffsetMm * pixelsPerMm;
        // while (offset < rowLength) {
        //   stitches.push(
        //     new Coordinate(
        //       rowStart.x + offset * rowDirection.x,
        //       rowStart.y + offset * rowDirection.y,
        //     ),
        //   );
        //   offset += this.fillPattern[patternIndex].rowPatternMm[0] * pixelsPerMm;
        // }

        // stitches.push();
        // stitches.push();

        // travel_graph.remove_edges_from(
        //   fill_stitch_graph[edge[0]][edge[1]]['segment'].get('underpath_edges', [])
        // )

        // stitches.push(edge[0], edge[1]);
        if (fillStitchGraph.hasEdge(edge[0], edge[1])) {
          const edgeLabel = fillStitchGraph.edge(edge[0], edge[1]);
          if (edgeLabel.type === 'segment') {
            const underpathEdges = edgeLabel.underpathEdges;
            for (let j = 0, m = underpathEdges.length; j < m; j++) {
              travelGraph.removeEdge(
                underpathEdges[j][0],
                underpathEdges[j][1],
                underpathEdges[j][2],
              );
            }
          }
        }
      } else {
        const travel = [];

        // const dijkstra = graphlib.alg.dijkstra(travelGraph, edge[0], (e) => travelGraph.edge(e).weight, (v) => travelGraph.nodeEdges(v));
        // if (dijkstra[edge[1]] !== null && dijkstra[edge[1]].distance < Infinity) {
        //   let curr = edge[1];
        //   while (curr !== edge[0]) {
        //     travel.unshift(curr);
        //     curr = dijkstra[curr].predecessor;
        //   }
        //   travel.unshift(edge[0]);
        // }

        const shortestPath = this.aStar(travelGraph, edge[0], edge[1]);
        if (shortestPath) {
          for (let j = 1, m = shortestPath.length; j < m; j++) {
            travel.push(shortestPath[j]);
          }
        }

        if (travel.length > 0) {
          travel.forEach((v) =>
            stitches.push(travelGraph.node(v).geometry.getCoordinate()),
          );
        }
      }
    }
    return stitches;
    // console.log(stitches);
  }

  aStar(graph: graphlib.Graph, source: string, target: string): string[] | null {
    // gScore: best-known cost from source to n
    const gScore = new Map();
    // fScore: gScore[n] + heuristic(n, target)
    const fScore = new Map();
    const cameFrom = new Map();
    const openSet = new MinPriorityQueue();

    graph.nodes().forEach((n) => {
      gScore.set(n, Infinity);
      fScore.set(n, Infinity);
    });
    gScore.set(source, 0);
    fScore.set(source, graph.node(source).geometry.distance(graph.node(target).geometry));

    openSet.enqueue({ node: source, priority: fScore.get(source) });

    while (!openSet.isEmpty()) {
      const { node: u } = openSet.dequeue();
      if (u === target) {
        // reconstruct path
        const path = [];
        let cur = target;
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
              tentativeG + graph.node(v).geometry.distance(graph.node(target).geometry);
            fScore.set(v, f);
            openSet.enqueue({ node: v, priority: f });
          }
        }
      }
    }

    // no path
    return null;
  }
}

class MinPriorityQueue {
  heap: any[];
  constructor() {
    this.heap = [];
  }
  isEmpty() {
    return this.heap.length === 0;
  }
  enqueue(item: any) {
    this.heap.push(item);
    this._siftUp(this.heap.length - 1);
  }
  dequeue() {
    if (this.isEmpty()) return null;
    this._swap(0, this.heap.length - 1);
    const min = this.heap.pop();
    this._siftDown(0);
    return min;
  }
  peek() {
    return this.heap[0];
  }
  _parent(i: any) {
    return Math.floor((i - 1) / 2);
  }
  _left(i: any) {
    return 2 * i + 1;
  }
  _right(i: any) {
    return 2 * i + 2;
  }
  _swap(i: any, j: any) {
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
  }
  _siftUp(i: any) {
    let idx = i;
    while (idx > 0) {
      const p = this._parent(idx);
      if (this.heap[p].priority <= this.heap[idx].priority) break;
      this._swap(p, idx);
      idx = p;
    }
  }
  _siftDown(i: any) {
    let idx = i,
      len = this.heap.length;
    while (true) {
      const l = this._left(idx),
        r = this._right(idx);
      let smallest = idx;
      if (l < len && this.heap[l].priority < this.heap[smallest].priority) smallest = l;
      if (r < len && this.heap[r].priority < this.heap[smallest].priority) smallest = r;
      if (smallest === idx) break;
      this._swap(idx, smallest);
      idx = smallest;
    }
  }
}

function changeOfBasis2D(v: Vector, b1: Vector, b2: Vector): Vector {
  const [x, y] = [v.x, v.y];
  const [b1x, b1y] = [b1.x, b1.y];
  const [b2x, b2y] = [b2.x, b2.y];

  // Construct inverse of the change-of-basis matrix B = [b1 b2]
  const det = b1x * b2y - b1y * b2x;
  if (Math.abs(det) < 1e-10) {
    throw new Error('Basis vectors are linearly dependent (determinant is zero)');
  }

  const invB = [
    [b2y / det, -b1y / det],
    [-b2x / det, b1x / det],
  ];

  // Multiply invB * v
  const newX = invB[0][0] * x + invB[0][1] * y;
  const newY = invB[1][0] * x + invB[1][1] * y;

  return new Vector(newX, newY);
}
