import { IRun } from '../IRun';
import { Vector } from '../../Math/Vector';
import {
  Coordinate,
  Envelope,
  LinearRing,
  LineSegment,
  LineString,
  MultiLineString,
  Point,
  Polygon,
} from 'jsts/org/locationtech/jts/geom';
import DiscreteHausdorffDistance from 'jsts/org/locationtech/jts/algorithm/distance/DiscreteHausdorffDistance';
import { OverlayOp } from 'jsts/org/locationtech/jts/operation/overlay';
import { LineStringExtracter } from 'jsts/org/locationtech/jts/geom/util';
import { LengthIndexedLine } from 'jsts/org/locationtech/jts/linearref';
import { GeometrySnapper } from 'jsts/org/locationtech/jts/operation/overlay/snap';
import { STRtree } from 'jsts/org/locationtech/jts/index/strtree';
import { DistanceOp } from 'jsts/org/locationtech/jts/operation/distance';
import IndexedFacetDistance from 'jsts/org/locationtech/jts/operation/distance/IndexedFacetDistance';
import VWSimplifier from 'jsts/org/locationtech/jts/simplify/VWSimplifier';
import LineMerger from 'jsts/org/locationtech/jts/operation/linemerge/LineMerger';
import { geometryFactory } from '../../util/jsts';
import { Stitch } from '../Stitch';
import graphlib from 'graphlib';
import { Polyline } from '../../Math/Polyline';
import { resample } from '../../Geometry/resample';
import MinPriorityQueue from '../../Optimize/MinPriorityQueue';
import { Utils } from '../../Math/Utils';

function vec2Coord(v: Vector): Coordinate {
  return new Coordinate(v.x, v.y);
}

export class CircularFill implements IRun {
  polygon: Polygon;
  startPosition: Coordinate;
  endPosition: Coordinate;
  centerPosition: Coordinate;
  rowSpacingMm: number;
  stitchLengthMm: number;
  travelLengthMm: number;
  travelToleranceMm: number;
  underpath: Boolean;
  indexedOutlines: {
    geometry: LinearRing;
    lengthIndexedLine: LengthIndexedLine;
  }[];
  constructor(
    shell: Vector[],
    holes: Vector[][],
    options?: {
      startPosition?: Vector;
      endPosition?: Vector;
      centerPosition?: Vector;
      rowSpacingMm?: number;
      stitchLengthMm?: number;
      travelLengthMm?: number;
      travelToleranceMm?: number;
      underpath?: Boolean;
    },
  ) {
    const shellCoords = shell.map((v) => new Coordinate(v.x, v.y));
    const shellRing = geometryFactory.createLinearRing(shellCoords);
    const holeRings = holes.map((h) => {
      const holeCoords = h.map((v) => new Coordinate(v.x, v.y));
      return geometryFactory.createLinearRing(holeCoords);
    });
    this.polygon = geometryFactory.createPolygon(shellRing, holeRings);
    this.startPosition = vec2Coord(options?.startPosition ?? shell[0]);
    this.endPosition = vec2Coord(options?.endPosition ?? shell[0]);
    this.centerPosition = options?.centerPosition
      ? vec2Coord(options?.centerPosition)
      : this.polygon.getCentroid().getCoordinate();
    this.rowSpacingMm = options?.rowSpacingMm ?? 0.2;
    this.stitchLengthMm = options?.stitchLengthMm ?? 3;
    this.travelLengthMm = options?.travelLengthMm ?? 3;
    this.travelToleranceMm = options?.travelToleranceMm ?? 1;
    this.underpath = options?.underpath ?? true;
    this.indexedOutlines = [shellRing, ...holeRings].map((r) => ({
      geometry: r,
      lengthIndexedLine: new LengthIndexedLine(r),
    }));
  }

  getStitches(pixelsPerMm: number): Stitch[] {
    // const centerPoint = geometryFactory.createPoint(this.centerPosition);
    // const maxSpiralRadius = DiscreteHausdorffDistance.distance(this.polygon, centerPoint);
    // const rowSpacingPx = this.rowSpacingMm * pixelsPerMm;
    // const stitchSpacingPx = this.stitchLengthMm * pixelsPerMm;
    //
    // const lineMerger = new LineMerger();
    // const radius = maxSpiralRadius + 4 * rowSpacingPx;
    // const spacing = 2 * rowSpacingPx;
    // const sampling = stitchSpacingPx;
    // lineMerger.add(this.getSpiral(radius, spacing, sampling, 0));
    // lineMerger.add(this.getSpiral(radius, spacing, sampling, Math.PI));
    // const spiral = lineMerger.getMergedLineStrings().toArray()[0];
    // const spiralSegments = LineStringExtracter.getGeometry(OverlayOp.intersection(this.polygon, spiral));

    const spiralSegments = this.getSpiralSegments(pixelsPerMm);

    const fillStitchGraph = this.buildFillStitchGraph(spiralSegments);
    const travelGraph = this.buildTravelGraph(fillStitchGraph, pixelsPerMm);
    const path = this.findStitchPath(fillStitchGraph, travelGraph);
    return this.pathToStitches(path, travelGraph, fillStitchGraph, pixelsPerMm).map(
      (c) => new Stitch(new Vector(c.x, c.y)),
    );
  }

  getSpiralSegments(pixelsPerMm: number): MultiLineString {
    const rowSpacing = this.rowSpacingMm * pixelsPerMm;
    const sampleSpacing = this.stitchLengthMm * pixelsPerMm;

    const centerPoint = geometryFactory.createPoint(this.centerPosition);
    const isCovered = this.polygon.covers(centerPoint);
    const minRadius = this.polygon.distance(centerPoint);
    const maxRadius = DiscreteHausdorffDistance.distance(this.polygon, centerPoint);

    function normalizeAngle(theta: number): number {
      const twoPi = 2 * Math.PI;
      theta = theta % twoPi;
      return theta < 0 ? theta + twoPi : theta;
    }

    function minimalSweepInterval(P: Coordinate, Qs: Coordinate[]) {
      if (Qs.length === 1) {
        const a = normalizeAngle(Math.atan2(Qs[0].y - P.y, Qs[0].x - P.x));
        return { startAngle: a, endAngle: a, sweepAngle: 0 };
      }

      const angles = Qs.map((Q) => normalizeAngle(Math.atan2(Q.y - P.y, Q.x - P.x))).sort(
        (a, b) => a - b,
      );

      let maxGap = -1;
      let gapStartIndex = 0;

      for (let i = 0; i < angles.length; i++) {
        const a = angles[i];
        const b = i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI;
        const gap = b - a;
        if (gap > maxGap) {
          maxGap = gap;
          gapStartIndex = i;
        }
      }

      const startAngle = angles[(gapStartIndex + 1) % angles.length];
      const endAngle = angles[gapStartIndex];
      const sweepAngle = 2 * Math.PI - maxGap;

      return { startAngle, endAngle, sweepAngle };
    }

    const { startAngle, sweepAngle } = isCovered
      ? { startAngle: 0, sweepAngle: 2 * Math.PI }
      : minimalSweepInterval(
          this.centerPosition,
          this.polygon.getExteriorRing().getCoordinates(),
        );
    const sagitta = 0.5 * rowSpacing + (sampleSpacing * sampleSpacing) / (8 * rowSpacing);

    const segments = [];
    if (isCovered) {
      const leftArm = [];
      const rightArm = [];
      for (
        let r = Math.max(minRadius, sagitta), i = 0;
        r < maxRadius;
        r += 2 * rowSpacing, i++
      ) {
        // const countSamples = Math.max(
        //   Math.round(sweepAngle * (r + 2 * rowSpacing) / sampleSpacing),
        //   Math.ceil(2 * Math.PI / Math.acos(-rowSpacing / (r + 2 * rowSpacing) + 1))
        // );
        const countSamples = Math.round(
          (sweepAngle * (r + 2 * rowSpacing)) / sampleSpacing,
        );
        for (let i = 0; i < countSamples; i++) {
          const a = Utils.map(i, 0, countSamples, 0, sweepAngle);
          const w = a / (2 * Math.PI);
          const v1 = Vector.fromAngle(startAngle + a).multiply((1 - w) * r);
          const v2 = Vector.fromAngle(startAngle + a).multiply(w * (r + 2 * rowSpacing));
          const v = v1.copy().add(v2);
          leftArm.push(
            new Coordinate(v.x + this.centerPosition.x, v.y + this.centerPosition.y),
          );
          rightArm.push(
            new Coordinate(-v.x + this.centerPosition.x, -v.y + this.centerPosition.y),
          );
        }
      }
      rightArm.reverse();
      const intersection = this.polygon.intersection(
        geometryFactory.createLineString([...rightArm, ...leftArm]),
      );
      for (let i = 0; i < intersection.getNumGeometries(); i++) {
        segments.push(intersection.getGeometryN(i));
      }
    } else {
      const lineMerger = new LineMerger();
      for (let r = minRadius - rowSpacing; r <= maxRadius; r += rowSpacing) {
        const countSamples = Math.max(
          Math.round((sweepAngle * (r + 2 * rowSpacing)) / sampleSpacing),
          Math.ceil((2 * Math.PI) / Math.acos(-rowSpacing / (r + 2 * rowSpacing) + 1)),
        );
        const segment = [];
        for (let i = 0; i < countSamples; i++) {
          const a = Utils.map(i, 0, countSamples - 1, 0, sweepAngle);
          const w = a / (2 * Math.PI);
          const v1 = Vector.fromAngle(startAngle + a).multiply((1 - w) * r);
          const v2 = Vector.fromAngle(startAngle + a).multiply(w * (r + 2 * rowSpacing));
          const v = v1.add(v2);
          segment.push(
            new Coordinate(v.x + this.centerPosition.x, v.y + this.centerPosition.y),
          );
        }
        // const intersection: Geometry = this.polygon.intersection(geometryFactory.createLineString(segment));
        lineMerger.add(
          OverlayOp.overlayOp(
            this.polygon,
            geometryFactory.createLineString(segment),
            OverlayOp.INTERSECTION,
          ),
        );
      }
      segments.push(...lineMerger.getMergedLineStrings().toArray());
    }
    return geometryFactory.createMultiLineString(segments);
  }

  // getSpiral(
  //   radius: number,
  //   spacing: number,
  //   sampling: number,
  //   offset: number,
  // ): LineString {
  //   let [theta, r] = [0, spacing];
  //   const points = [this.centerPosition];
  //   while (r <= radius) {
  //     const dr_dtheta = spacing / (2 * Math.PI);
  //     const dtheta = sampling / Math.sqrt(r * r + dr_dtheta * dr_dtheta);
  //     const maxDtheta = 2 * Math.acos(Math.max(Math.min(1 - (0.4 * spacing) / r, 1), -1));
  //     theta = theta + Math.min(dtheta, maxDtheta);
  //     r = (spacing * theta) / (2 * Math.PI);
  //     const xr = r * Math.cos(theta + offset) + this.centerPosition.x;
  //     const yr = r * Math.sin(theta + offset) + this.centerPosition.y;
  //     points.push(new Coordinate(xr, yr));
  //   }
  //   return geometryFactory.createLineString(points);
  // }

  getClosestShapeOutlineIndex(pos: Point) {
    let [outlineIndex, minDistance] = [
      0,
      DistanceOp.distance(this.indexedOutlines[0].geometry, pos),
    ];
    for (let i = 1; i < this.indexedOutlines.length; i++) {
      const distance = DistanceOp.distance(this.indexedOutlines[i].geometry, pos);
      if (distance < minDistance) {
        [outlineIndex, minDistance] = [i, distance];
      }
    }
    return outlineIndex;
  }

  insertNode(graph: graphlib.Graph, pos: Point) {
    const outlineIndex = this.getClosestShapeOutlineIndex(pos);
    const projection = this.indexedOutlines[outlineIndex].lengthIndexedLine.project(
      pos.getCoordinate(),
    );
    const projectedCoord =
      this.indexedOutlines[outlineIndex].lengthIndexedLine.extractPoint(projection);
    const projectedPoint = geometryFactory.createPoint(projectedCoord);

    const edges = [];
    for (const e of graph.edges()) {
      const edge = graph.edge(e.v, e.w, e.name);
      const node = graph.node(e.v);
      if (edge.type === 'outline' && node.shapeIndex === outlineIndex) {
        edges.push([graph.edge(e), e, edge]);
      }
    }

    if (edges.length > 0) {
      let [edge, minDistance] = [edges[0], edges[0][2].geometry.distance(projectedPoint)];
      for (let i = 1; i < edges.length; i++) {
        const distance = edges[i][2].geometry.distance(projectedPoint);
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

  buildFillStitchGraph(spiralSegments: MultiLineString): graphlib.Graph {
    let g = new graphlib.Graph({ directed: false, multigraph: true });

    for (let i = 0; i < spiralSegments.getNumGeometries(); i++) {
      const ls = spiralSegments.getGeometryN(i);
      let [s, t] = [ls.getPointN(0), ls.getPointN(ls.getNumPoints() - 1)];
      g.setNode(s, { geometry: s });
      g.setNode(t, { geometry: t });
      g.setEdge(s, t, { type: 'segment', geometry: ls, underpathEdges: [] });
    }

    // Tag nodes with outline and projection
    for (let node of g.nodes()) {
      const label = g.node(node);
      let check = false;
      for (let i = 0, n = this.indexedOutlines.length; i < n; i++) {
        if (label.geometry.isWithinDistance(this.indexedOutlines[i].geometry, 0.0001)) {
          label.shapeIndex = i;
          label.length = this.indexedOutlines[i].lengthIndexedLine.project(
            label.geometry.getCoordinate(),
          );
          label.projection = this.indexedOutlines[i].lengthIndexedLine.extractPoint(
            label.length,
          );
          g.setNode(node, label);
          check = true;
          break;
        }
      }
      if (!check) {
        g.removeNode(node);
      }
    }

    // Add edges between outline nodes
    for (let i = 0, n = this.indexedOutlines.length; i < n; i++) {
      const nodes = g
        .filterNodes((node) => g.node(node).shapeIndex === i)
        .nodes()
        .map((n) => [n, g.node(n)])
        .sort((a, b) => a[1].length - b[1].length);
      let n1 = nodes[0],
        n2 = null;
      for (let j = 1, m = nodes.length; j < m + 1; j++) {
        n2 = nodes[j % m];
        const geometry = geometryFactory.createLineString([
          n1[1].geometry.getCoordinate(),
          n2[1].geometry.getCoordinate(),
        ]);
        g.setEdge(n1[0], n2[0], { type: 'outline', geometry }, 'outline');
        if (j % 2 === 0) {
          g.setEdge(n1[0], n2[0], { type: 'extra', geometry }, 'extra');
        }
        n1 = n2;
      }
    }

    if (this.startPosition) {
      const startPoint = geometryFactory.createPoint(this.startPosition);
      this.insertNode(g, startPoint);
    }
    if (this.endPosition) {
      const endPoint = geometryFactory.createPoint(this.endPosition);
      this.insertNode(g, endPoint);
    }

    return g;
  }

  buildLineString(coords: Coordinate[], data: { index: number }): LineString {
    const ls = geometryFactory.createLineString(coords);
    ls.setUserData(data);
    return ls;
  }

  buildMultiLineString(
    lineStrings: LineString[],
    data: { index?: number; angle?: number; label?: string },
  ) {
    const mls = geometryFactory.createMultiLineString(lineStrings);
    mls.setUserData(data);
    return mls;
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

  buildTravelGraph(
    fillStitchGraph: graphlib.Graph,
    // spiralRadius: number,
    pixelsPerMm: number,
  ): graphlib.Graph {
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
      const center = this.polygon.getCentroid();
      const centerVec = new Vector(center.getX(), center.getY());
      const radius = DiscreteHausdorffDistance.distance(this.polygon, center);
      const rows1 = this.getRows(
        centerVec,
        0.25 * Math.PI,
        radius,
        this.travelLengthMm * pixelsPerMm,
        '+',
      );
      const rows2 = this.getRows(
        centerVec,
        -0.25 * Math.PI,
        radius,
        this.travelLengthMm * pixelsPerMm,
        '-',
      );
      const rows3 = this.getRows(
        centerVec,
        0.5 * Math.PI,
        radius,
        Math.sqrt(2) * this.travelLengthMm * pixelsPerMm,
        '90',
      );
      const segs1 = OverlayOp.intersection(this.polygon, rows1);
      const segs2 = OverlayOp.intersection(this.polygon, rows2);
      const segs3 = OverlayOp.intersection(this.polygon, rows3);
      endpoints = geometryFactory.createMultiPointFromCoords([
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
      travelEdges = LineStringExtracter.getLines(
        geometryFactory.createGeometryCollection([diagonalEdges, snappedVerticalEdges]),
      )
        .toArray()
        .filter((ls: LineString) => !ls.isEmpty());

      if (endpoints.getNumGeometries() === 0 || travelEdges.length === 0) {
        grating = false;
      } else {
        // tag nodes with outline and projection
        // This will ensure that a path traveling inside the shape can reach its
        // target on the outline, which will be one of the points added above.
        for (let i = 0, n = endpoints.getNumGeometries(); i < n; i++) {
          for (let j = 0, m = this.indexedOutlines.length; j < m; j++) {
            const point = endpoints.getGeometryN(i);
            const coord = point.getCoordinate();
            if (point.isWithinDistance(this.indexedOutlines[j].geometry, 0.0001)) {
              const length = this.indexedOutlines[j].lengthIndexedLine.project(coord);
              const projection =
                this.indexedOutlines[j].lengthIndexedLine.extractPoint(length);
              g.setNode(point, { geometry: point, shapeIndex: j, length, projection });
            }
          }
        }
      }
    }

    // add boundary travel nodes
    if (!this.underpath || !grating) {
      for (let i = 0, n = this.indexedOutlines.length; i < n; i++) {
        let prev = null;
        for (const p of this.indexedOutlines[i].geometry.getCoordinates()) {
          const pt = geometryFactory.createPoint(p);
          if (prev !== null) {
            // Subdivide long straight line segments.  Otherwise we may not
            // have a node near the user's chosen starting or ending point
            const segment = new LineSegment(prev, p);
            const length = segment.getLength();
            if (length > this.travelLengthMm * pixelsPerMm) {
              for (
                let j = this.travelLengthMm * pixelsPerMm;
                j < length;
                j += this.travelLengthMm * pixelsPerMm
              ) {
                const coord = segment.pointAlong(j / length);
                const subpoint = geometryFactory.createPoint(coord);
                const len = this.indexedOutlines[i].lengthIndexedLine.project(coord);
                const projection =
                  this.indexedOutlines[i].lengthIndexedLine.extractPoint(len);
                g.setNode(subpoint, {
                  geometry: subpoint,
                  shapeIndex: i,
                  length: len,
                  projection,
                });
              }
            }
          }
          const pLen = this.indexedOutlines[i].lengthIndexedLine.project(p);
          const pProj = this.indexedOutlines[i].lengthIndexedLine.extractPoint(pLen);
          g.setNode(pt, { geometry: pt, shapeIndex: i, length: pLen, projection: pProj });
          prev = p;
        }
      }
    }

    // add edges between outline nodes
    for (let i = 0, n = this.indexedOutlines.length; i < n; i++) {
      const nodes = g
        .filterNodes((node) => g.node(node).shapeIndex === i)
        .nodes()
        .map((n) => [n, g.node(n)])
        .sort((a, b) => a[1].length - b[1].length);
      let n1 = nodes[0],
        n2 = null;
      for (let j = 1, m = nodes.length; j < m + 1; j++) {
        n2 = nodes[j % m];
        const geometry = geometryFactory.createLineString([
          n1[1].geometry.getCoordinate(),
          n2[1].geometry.getCoordinate(),
        ]);
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
      for (const e of fillStitchGraph.edges().map((e) => [e, fillStitchGraph.edge(e)])) {
        if (e[1].type === 'segment') {
          strTree.insert(e[1].geometry.getEnvelopeInternal(), e);
        }
      }

      const indexedFacetDistance = new IndexedFacetDistance(this.polygon);
      const centerPoint = geometryFactory.createPoint(this.centerPosition);
      for (let i = 0, n = travelEdges.length; i < n; i++) {
        const geometry = travelEdges[i];
        let p = geometry.getPointN(0),
          q = null;
        for (let j = 1, m = geometry.getNumPoints(); j < m; j++) {
          q = geometry.getPointN(j);
          // const ls = new LineSegment(p.getX(), p.getY(), q.getX(), q.getY());
          const ls = geometryFactory.createLineString([
            new Coordinate(p.getX(), p.getY()),
            new Coordinate(q.getX(), q.getY()),
          ]);
          const minDist = ls.distance(centerPoint);
          const maxDist = DiscreteHausdorffDistance.distance(ls, centerPoint);
          const length = ls.getLength();
          const dToShape = indexedFacetDistance.distance(ls);
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
            const minCurveDist = v.geometry.distance(centerPoint);
            const maxCurveDist = DiscreteHausdorffDistance.distance(
              v.geometry,
              centerPoint,
            );
            if (minDist < maxCurveDist && minCurveDist < maxDist) {
              if (v.geometry.intersects(ls)) {
                fillStitchGraph.edge(k).underpathEdges.push([p, q, 'travel']);
              }
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
      ? geometryFactory.createPoint(
          new Coordinate(this.startPosition.x, this.startPosition.y),
        )
      : this.indexedOutlines[0].geometry.getCoordinates()[0];
    const startingNode = this.getNearestNode(fillStitchGraph, startingPoint);
    const endingPoint: Point = this.endPosition
      ? geometryFactory.createPoint(
          new Coordinate(this.endPosition.x, this.endPosition.y),
        )
      : startingPoint;
    const endingNode = this.endPosition
      ? this.getNearestNode(fillStitchGraph, endingPoint)
      : startingNode;

    const path: [string, string, string | null][] = [];
    const vertexStack: [string, string | null][] = [[endingNode, null]];
    let prevVertex: [string, string | null] = ['', null];

    while (vertexStack.length > 0) {
      const currVertex = vertexStack[vertexStack.length - 1];
      const neighbors = g.neighbors(currVertex[0]);
      if (neighbors?.length === 0) {
        if (prevVertex[1] !== null) {
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
          } else {
            collapsedPath.push([runStart, edge[0], 'outline']);
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
      stitches.push(travelGraph.node(path[0][0]).geometry.getCoordinate());
    }

    for (let i = 0, n = collapsedPath.length; i < n; i++) {
      const edge = collapsedPath[i];
      if (edge[2] === 'segment') {
        const startCoord = fillStitchGraph.node(edge[0]).geometry.getCoordinate();
        const rowStart = Vector.fromObject(startCoord);
        const endCoord = fillStitchGraph.node(edge[1]).geometry.getCoordinate();
        const rowEnd = Vector.fromObject(endCoord);
        if (fillStitchGraph.hasEdge(edge[0], edge[1])) {
          const edgeLabel = fillStitchGraph.edge(edge[0], edge[1]);
          const lineString = edgeLabel.geometry;
          if (
            rowStart.distance(lineString.getCoordinateN(0)) <
            rowEnd.distance(lineString.getCoordinateN(0))
          ) {
            for (let i = 0; i < lineString.getNumPoints(); i++) {
              stitches.push(lineString.getCoordinateN(i));
            }
          } else {
            for (let i = lineString.getNumPoints() - 1; i >= 0; i--) {
              stitches.push(lineString.getCoordinateN(i));
            }
          }
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
        const shortestPath = this.aStar(travelGraph, edge[0], edge[1]);
        // const shortestPath = this.shortestPath(travelGraph, edge[0], edge[1])
        const travelSequence: Coordinate[] = [];
        if (shortestPath) {
          for (let j = 1, m = shortestPath.length; j < m; j++) {
            travelSequence.push(
              travelGraph.node(shortestPath[j]).geometry.getCoordinate(),
            );
          }
        }
        if (travelSequence.length > 1) {
          const travelLine = geometryFactory.createLineString(travelSequence);
          const travelSimplified = VWSimplifier.simplify(travelLine, 0.5 * pixelsPerMm);
          const travel = new Polyline(false);
          for (let j = 0; j < travelSimplified.getNumPoints(); j++) {
            const c = travelSimplified.getCoordinateN(j);
            travel.addVertex(c.x, c.y);
          }
          if (travel.vertices.length > 1) {
            const resamp = resample(
              geometryFactory.createLineString(
                travel.vertices.map((v) => new Coordinate(v.x, v.y)),
              ),
              pixelsPerMm * this.travelLengthMm,
              pixelsPerMm,
            );
            for (let i = 0, n = resamp.getNumPoints(); i < n; i++) {
              stitches.push(resamp.getCoordinateN(i));
            }
          }
        }
      }
    }
    return stitches;
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
