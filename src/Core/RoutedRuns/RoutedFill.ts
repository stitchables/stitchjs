import { IRoutedRun } from '../IRoutedRun';
import { Vector } from '../../Math/Vector';
import {
  Coordinate,
  Point,
  LineSegment,
  LineString,
  LinearRing,
  Polygon,
} from 'jsts/org/locationtech/jts/geom';
import PolygonExtracter from 'jsts/org/locationtech/jts/geom/util/PolygonExtracter';
import { LengthIndexedLine } from 'jsts/org/locationtech/jts/linearref';
import { MinimumBoundingCircle } from 'jsts/org/locationtech/jts/algorithm';
import { OverlayOp } from 'jsts/org/locationtech/jts/operation/overlay';
import { LineStringExtracter } from 'jsts/org/locationtech/jts/geom/util';
import { GeometrySnapper } from 'jsts/org/locationtech/jts/operation/overlay/snap';
import IndexedFacetDistance from 'jsts/org/locationtech/jts/operation/distance/IndexedFacetDistance';
import { STRtree } from 'jsts/org/locationtech/jts/index/strtree';
import { geometryFactory } from '../../util/jsts';
import { Stitch } from '../Stitch';
import * as graphlib from '@dagrejs/graphlib';
import { AutoFill } from '../Runs/AutoFill';
import { Polyline } from '../../Math/Polyline';

export class RoutedFill implements IRoutedRun {
  polygon: Polygon;
  indexedOutlines: { geometry: LinearRing; lengthIndexedLine: LengthIndexedLine }[];
  angle: number;
  rowSpacingMm: number;
  stitchLengthMm: number;
  travelLengthMm: number;
  travelToleranceMm: number;
  centerPoint: Point;
  fillPattern: {
    rowOffsetMm: number;
    rowPatternMm: number[];
  }[];
  underPath: boolean;
  underlays: {
    insetMm: number;
    angle: number;
    rowSpacingMm: number;
    stitchLengthMm: number;
    travelLengthMm: number;
    travelToleranceMm: number;
  }[];
  boundingRadius: number;

  constructor(
    shell: Vector[],
    holes: Vector[][],
    options?: {
      angle?: number;
      rowSpacingMm?: number;
      stitchLengthMm?: number;
      travelLengthMm?: number;
      travelToleranceMm?: number;
      centerPosition?: Vector;
      fillPattern?: {
        rowOffsetMm: number;
        rowPatternMm: number[];
      }[];
      underPath?: boolean;
      underlays?: {
        insetMm: number;
        angle: number;
        rowSpacingMm: number;
        stitchLengthMm: number;
        travelLengthMm: number;
        travelToleranceMm: number;
      }[];
    },
  ) {
    this.polygon = geometryFactory.createPolygon();
    this.indexedOutlines = [];
    this.angle = options?.angle ?? 0;
    this.rowSpacingMm = options?.rowSpacingMm ?? 0.2;
    this.stitchLengthMm = options?.stitchLengthMm ?? 3;
    this.travelLengthMm = options?.travelLengthMm ?? 4;
    this.travelToleranceMm = options?.travelToleranceMm ?? 0.1;
    this.centerPoint = geometryFactory.createPoint();
    this.fillPattern = options?.fillPattern ?? [
      { rowOffsetMm: 0, rowPatternMm: [this.stitchLengthMm] },
      { rowOffsetMm: 0.33 * this.stitchLengthMm, rowPatternMm: [this.stitchLengthMm] },
      { rowOffsetMm: 0.66 * this.stitchLengthMm, rowPatternMm: [this.stitchLengthMm] },
    ];
    this.underPath = options?.underPath ?? true;
    this.underlays = options?.underlays ?? [
      {
        insetMm: 0.7,
        angle: this.angle + 0.5 * Math.PI,
        rowSpacingMm: 1,
        stitchLengthMm: 3,
        travelLengthMm: 2.5,
        travelToleranceMm: 1,
      },
    ];

    const shellCoords = shell.map((v) => new Coordinate(v.x, v.y));
    const shellRing = geometryFactory.createLinearRing(shellCoords);
    const holeRings = holes.map((h) => {
      const holeCoords = h.map((v) => new Coordinate(v.x, v.y));
      return geometryFactory.createLinearRing(holeCoords);
    });
    this.polygon = geometryFactory.createPolygon(shellRing, holeRings);
    // `getStitches()` expects index 0 = exterior ring, 1..n = holes.
    this.indexedOutlines = [
      {
        geometry: shellRing,
        lengthIndexedLine: new LengthIndexedLine(shellRing),
      },
      ...holeRings.map((h) => ({
        geometry: h,
        lengthIndexedLine: new LengthIndexedLine(h),
      })),
    ];

    if (options?.centerPosition) {
      this.centerPoint = geometryFactory.createPoint(
        new Coordinate(options.centerPosition.x, options.centerPosition.y),
      );
    } else {
      this.centerPoint = this.polygon.getCentroid();
    }

    const minimumBoundingCircle = new MinimumBoundingCircle(this.polygon);
    this.boundingRadius = minimumBoundingCircle.getRadius();
  }

  getRows(center: Point, angle: number, radius: number, spacing: number) {
    const dir = new Coordinate(radius * Math.cos(angle), radius * Math.sin(angle));
    const p1 = new Coordinate(center.getX() + dir.x, center.getY() + dir.y);
    const p2 = new Coordinate(center.getX() - dir.x, center.getY() - dir.y);
    const n = new Coordinate(
      Math.cos(angle + 0.5 * Math.PI),
      Math.sin(angle + 0.5 * Math.PI),
    );
    const lineStrings = [geometryFactory.createLineString([p1, p2])];
    for (let r = spacing; r < radius; r += spacing) {
      const offset = new Coordinate(r * n.x, r * n.y);
      lineStrings.push(
        geometryFactory.createLineString([
          new Coordinate(p1.x + offset.x, p1.y + offset.y),
          new Coordinate(p2.x + offset.x, p2.y + offset.y),
        ]),
      );
      lineStrings.push(
        geometryFactory.createLineString([
          new Coordinate(p1.x - offset.x, p1.y - offset.y),
          new Coordinate(p2.x - offset.x, p2.y - offset.y),
        ]),
      );
    }
    return geometryFactory.createMultiLineString(lineStrings);
  }

  getPolygon() {
    return this.polygon;
  }

  getTravelData(pixelsPerMm: number): {
    graph: graphlib.Graph;
    getEdgeWeight: (label: any) => number;
    nodeTree: STRtree;
  } {
    interface NodeType {
      geometry: Point;
      outlineData?: {
        projection: Point;
        shapeIndex: number;
        lengthIndex: number;
      };
    }
    interface EdgeType {
      geometry: Point;
      weight: number;
      type: string;
    }
    const graphOptions = { directed: false, multigraph: true };
    const g = new graphlib.Graph<string, NodeType, EdgeType>(graphOptions);

    let endpoints, travelEdges;
    let grating = true;
    if (this.underPath) {
      // Build the travel edges
      const rows1 = this.getRows(
        this.centerPoint,
        this.angle + 0.25 * Math.PI,
        this.boundingRadius,
        this.travelLengthMm * pixelsPerMm,
      );
      const rows2 = this.getRows(
        this.centerPoint,
        this.angle - 0.25 * Math.PI,
        this.boundingRadius,
        this.travelLengthMm * pixelsPerMm,
      );
      const rows3 = this.getRows(
        this.centerPoint,
        this.angle + 0.5 * Math.PI,
        this.boundingRadius,
        Math.sqrt(2) * this.travelLengthMm * pixelsPerMm,
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
      const snapped = snapper.snapTo(diagonalEdges, 0.005);
      const snappedVerticalEdges = LineStringExtracter.getGeometry(snapped);
      const collection = geometryFactory.createGeometryCollection([
        diagonalEdges,
        snappedVerticalEdges,
      ]);
      travelEdges = LineStringExtracter.getLines(collection)
        .toArray()
        .filter((ls: LineString) => !ls.isEmpty());

      if (endpoints.getNumGeometries() === 0 || travelEdges.length === 0) {
        grating = false;
      } else {
        // tag nodes with outline and projection
        // This will ensure that a path traveling inside the shape can reach its
        // target on the outline, which will be one of the points added above.
        for (let i = 0, n = endpoints.getNumGeometries(); i < n; i++) {
          const geometry = endpoints.getGeometryN(i);
          const coordinate = geometry.getCoordinate();
          for (let j = 0, m = this.indexedOutlines.length; j < m; j++) {
            const outline = this.indexedOutlines[j];
            if (geometry.isWithinDistance(outline.geometry, 0.0001)) {
              const lengthIndex = outline.lengthIndexedLine.project(coordinate);
              const projection = outline.lengthIndexedLine.extractPoint(lengthIndex);
              const label = {
                geometry,
                outlineData: { projection, shapeIndex: j, lengthIndex },
              };
              g.setNode(geometry.toString(), label);
            }
          }
        }
      }
    }

    // add boundary travel nodes
    if (!this.underPath || !grating) {
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
                g.setNode(subpoint.toString(), {
                  geometry: subpoint,
                  outlineData: {
                    shapeIndex: i,
                    lengthIndex: len,
                    projection,
                  },
                });
              }
            }
          }
          const pLen = this.indexedOutlines[i].lengthIndexedLine.project(p);
          const pProj = this.indexedOutlines[i].lengthIndexedLine.extractPoint(pLen);
          g.setNode(pt.toString(), {
            geometry: pt,
            outlineData: {
              shapeIndex: i,
              lengthIndex: pLen,
              projection: pProj,
            },
          });
          prev = p;
        }
      }
    }

    // add edges between outline nodes
    for (let i = 0, n = this.indexedOutlines.length; i < n; i++) {
      const nodes = g
        .filterNodes((node) => g.node(node).outlineData?.shapeIndex === i)
        .nodes()
        .map((n) => {
          return { name: n, label: g.node(n) };
        })
        .sort(
          (a, b) =>
            (a.label.outlineData?.lengthIndex ?? 0) -
            (b.label.outlineData?.lengthIndex ?? 0),
        );
      let n1 = nodes[0],
        n2 = null;
      for (let j = 1, m = nodes.length; j < m + 1; j++) {
        n2 = nodes[j % m];
        const geometry = geometryFactory.createLineString([
          n1.label.geometry.getCoordinate(),
          n2.label.geometry.getCoordinate(),
        ]);
        const d = geometry.getLength();

        g.setEdge(
          n1.name,
          n2.name,
          { type: 'outline', geometry, weight: 3 * d },
          'outline',
        );
        if (j % 2 === 0) {
          g.setEdge(
            n1.name,
            n2.name,
            { type: 'extra', geometry, weight: 3 * d },
            'extra',
          );
        }
        n1 = n2;
      }
    }

    if (this.underPath && grating) {
      const indexedFacetDistance = new IndexedFacetDistance(this.polygon);
      for (let i = 0, n = travelEdges.length; i < n; i++) {
        const geometry = travelEdges[i];
        let p = geometry.getPointN(0),
          q = null;
        for (let j = 1, m = geometry.getNumPoints(); j < m; j++) {
          q = geometry.getPointN(j);
          const ls = geometryFactory.createLineString([
            p.getCoordinate(),
            q.getCoordinate(),
          ]);
          const length = ls.getLength();
          const dToShape = indexedFacetDistance.distance(ls);
          if (!g.hasNode(p)) g.setNode(p, { geometry: p });
          if (!g.hasNode(q)) g.setNode(q, { geometry: q });
          g.setEdge(
            p,
            q,
            {
              type: 'travel',
              geometry: ls,
              weight: length / (dToShape + 0.1),
            },
            'travel',
          );
          p = q;
        }
      }
    }

    const nodeTree = new STRtree();
    for (const name of g.nodes()) {
      const point = g.node(name).geometry;
      nodeTree.insert(point.getEnvelopeInternal(), { name, point });
    }
    nodeTree.build();

    return {
      graph: g,
      getEdgeWeight: (edgeLabel: EdgeType) => edgeLabel.weight,
      nodeTree,
    };
  }

  getUnderlay(pixelsPerMm: number, start?: Point, end?: Point): Stitch[] {
    const stitches = [];
    for (const underlay of this.underlays) {
      const insetPolygons = PolygonExtracter.getPolygons(
        this.polygon.buffer(-underlay.insetMm * pixelsPerMm),
      ).toArray();
      for (const insetPolygon of insetPolygons) {
        const shell = Polyline.fromObjects(
          insetPolygon.getExteriorRing().getCoordinates(),
          true,
        );
        const holes = [];
        for (let i = 0; i < insetPolygon.getNumInteriorRing(); i++) {
          const hole = insetPolygon.getInteriorRingN(i);
          holes.push(Polyline.fromObjects(hole.getCoordinates(), true));
        }
        const center = this.polygon.getCentroid();
        const underlayFill = new AutoFill(
          shell,
          holes,
          underlay.angle,
          underlay.rowSpacingMm,
          [
            { rowOffsetMm: 0, rowPatternMm: [this.stitchLengthMm] },
            {
              rowOffsetMm: 0.33 * this.stitchLengthMm,
              rowPatternMm: [this.stitchLengthMm],
            },
            {
              rowOffsetMm: 0.66 * this.stitchLengthMm,
              rowPatternMm: [this.stitchLengthMm],
            },
          ],
          underlay.travelLengthMm,
          new Vector(start?.getX() ?? 0, start?.getY() ?? 0),
          new Vector(end?.getX() ?? 0, end?.getY() ?? 0),
          new Vector(center.getX(), center.getY()),
          true,
        );
        stitches.push(...underlayFill.getStitches(pixelsPerMm));
      }
    }
    return stitches;
  }

  getStitches(pixelsPerMm: number, start?: Point, end?: Point): Stitch[] {
    const shell = Polyline.fromObjects(
      this.indexedOutlines[0].geometry.getCoordinates(),
      true,
    );
    const holes = [];
    for (let i = 1; i < this.indexedOutlines.length; i++) {
      holes.push(
        Polyline.fromObjects(this.indexedOutlines[i].geometry.getCoordinates(), true),
      );
    }
    const center = this.polygon.getCentroid();
    const fill = new AutoFill(
      shell,
      holes,
      this.angle,
      this.rowSpacingMm,
      this.fillPattern,
      this.travelLengthMm,
      new Vector(start?.getX() ?? 0, start?.getY() ?? 0),
      new Vector(end?.getX() ?? 0, end?.getY() ?? 0),
      new Vector(center.getX(), center.getY()),
      this.underPath,
    );
    return fill.getStitches(pixelsPerMm);
  }
}
