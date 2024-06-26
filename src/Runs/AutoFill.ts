import { BoundingBox } from '../Math/BoundingBox';
import { Graph } from '../Math/Graph';
import { Polyline } from '../Math/Polyline';
import { Utils } from '../Math/Utils';
import { Vector } from '../Math/Vector';

interface IIntersection {
  shapeIndex: number;
  position: Vector;
  rowIndex: number;
  rowStart: Vector;
  rowEnd: Vector;
  rowDistance: number;
  polylineDistance: number;
}

interface IPathStep {
  from: string;
  to: string;
  key: string;
}

export class AutoFill {
  shape: Polyline[];
  angle: number;
  rowSpacingMm: number;
  stitchSpacingMm: number;
  startPosition?: Vector;
  endPosition?: Vector;
  direction: Vector;
  normal: Vector;
  bounds: BoundingBox;
  center: Vector;
  distance: number;
  constructor(shape, angle, rowSpacingMm, stitchSpacingMm, startPosition, endPosition) {
    this.shape = shape;
    this.angle = angle;
    this.rowSpacingMm = rowSpacingMm;
    this.stitchSpacingMm = stitchSpacingMm;
    this.startPosition = startPosition;
    this.endPosition = endPosition;
    this.direction = Vector.fromAngle(this.angle);
    this.normal = Vector.fromAngle(this.angle + 0.5 * Math.PI);
    this.bounds = new BoundingBox(
      new Vector(Infinity, Infinity),
      new Vector(-Infinity, -Infinity),
    );
    for (const polyline of this.shape) {
      const bounds = polyline.getBoundingBox();
      if (bounds.min.x < this.bounds.min.x) this.bounds.min.x = bounds.min.x;
      if (bounds.max.x > this.bounds.max.x) this.bounds.max.x = bounds.max.x;
      if (bounds.min.y < this.bounds.min.y) this.bounds.min.y = bounds.min.y;
      if (bounds.max.y > this.bounds.max.y) this.bounds.max.y = bounds.max.y;
    }
    this.center = this.bounds.min.add(this.bounds.max).multiply(0.5);
    this.distance = this.center.distance(this.bounds.min);
  }
  getStitches(pixelsPerMm) {
    const rows = this.getRows(pixelsPerMm);
    const fillStitchGraph = this.getFillStitchGraph(rows);
    const travelGraph = this.getTravelGraph(fillStitchGraph);
    const stitchPath = this.getStitchPath(fillStitchGraph, travelGraph);
    return this.getStitchesFromPath(stitchPath, fillStitchGraph, pixelsPerMm);
  }
  getRows(pixelsPerMm) {
    const rows = [] as IIntersection[][][];
    for (
      let offset = -this.distance;
      offset <= this.distance;
      offset += this.rowSpacingMm * pixelsPerMm
    ) {
      const intersections = [] as IIntersection[];
      const c = this.center.add(this.normal.multiply(offset));
      const dc = this.direction.multiply(this.distance);
      const [p, q] = [c.add(dc), c.subtract(dc)];
      for (const [shapeIndex, polyline] of this.shape.entries()) {
        let sumPolylineDistance = 0;
        for (let i = 0; i < polyline.vertices.length; i++) {
          const s = polyline.vertices[i];
          const t = polyline.vertices[(i + 1) % polyline.vertices.length];
          const intersection = Utils.lineSegmentIntersection(p, q, s, t);
          if (intersection) {
            intersections.push({
              shapeIndex: shapeIndex,
              position: intersection,
              rowIndex: rows.length,
              rowStart: p,
              rowEnd: q,
              rowDistance: intersection.distance(p),
              polylineDistance: sumPolylineDistance + s.distance(intersection),
            });
          }
          sumPolylineDistance += s.distance(t);
        }
      }
      if (intersections.length > 0 && intersections.length % 2 === 0) {
        intersections.sort((a, b) => {
          return a.rowDistance > b.rowDistance ? 1 : -1;
        });
        const row = [] as IIntersection[][];
        for (let i = 0; i < intersections.length; i += 2)
          row.push([intersections[i], intersections[i + 1]]);
        rows.push(row);
      }
    }
    return rows;
  }
  getFillStitchGraph(rows) {
    const fillStitchGraph = new Graph<IIntersection, { key: string }>();
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < rows[i].length; j++) {
        fillStitchGraph.addVertex(`${i},${j},0`, rows[i][j][0]);
        fillStitchGraph.addVertex(`${i},${j},1`, rows[i][j][1]);
        fillStitchGraph.addEdge(`${i},${j},0`, `${i},${j},1`, { key: 'segment' });
      }
    }
    for (let i = 0; i < this.shape.length; i++) {
      const nodes = Object.entries(fillStitchGraph.vertices)
        .filter(([key, value]) => value.shapeIndex === i)
        .sort((a, b) => (a[1].polylineDistance > b[1].polylineDistance ? 1 : -1));
      for (let j = 0; j < nodes.length; j++) {
        fillStitchGraph.addEdge(nodes[j][0], nodes[(j + 1) % nodes.length][0], {
          key: 'outline',
        });
        if (j % 2 === 0) {
          fillStitchGraph.addEdge(nodes[j][0], nodes[(j + 1) % nodes.length][0], {
            key: 'extra',
          });
        }
      }
    }
    return fillStitchGraph;
  }
  getTravelGraph(fillStitchGraph: Graph<IIntersection, { key: string }>) {
    const travelGraph = new Graph<IIntersection, { key: string }>();
    for (const [id, properties] of Object.entries(fillStitchGraph.vertices)) {
      travelGraph.addVertex(id, properties);
    }

    for (const [edgeId, edge] of Object.entries(fillStitchGraph.edges)) {
      if (edge.properties.key === 'outline') {
        travelGraph.addEdge(edge.vertexId1, edge.vertexId2, { key: 'outline' });
      }
    }

    return travelGraph;
  }
  getStitchPath(
    fillStitchGraph: Graph<IIntersection, { key: string }>,
    travelGraph: Graph<IIntersection, { key: string }>,
  ) {
    const g = fillStitchGraph.copy();
    let startId = Object.keys(g.vertices)[0];
    let endId = startId;
    if (this.startPosition !== null || this.endPosition !== null) {
      let [minStartDistance, minEndDistance] = [Infinity, Infinity];
      for (const [id, v] of Object.entries(g.vertices)) {
        const dStart =
          this.startPosition === undefined
            ? Infinity
            : this.startPosition.distance(v.position);
        const dEnd =
          this.endPosition === undefined
            ? Infinity
            : this.endPosition.distance(v.position);
        if (this.startPosition !== null && dStart < minStartDistance) {
          minStartDistance = dStart;
          startId = id;
        }
        if (this.endPosition !== null && dEnd < minEndDistance) {
          minEndDistance = dEnd;
          endId = id;
        }
      }
    }
    const path = [] as IPathStep[];
    const vertexStack: string[][] = [[endId, '']];
    let lastVertexId = '';
    let lastVertexKey = '';
    while (vertexStack.length > 0) {
      const [currentVertexId, currentVertexKey] = vertexStack[vertexStack.length - 1];
      if (g.adjacency[currentVertexId].length === 0) {
        if (lastVertexId) {
          path.push({ from: lastVertexId, to: currentVertexId, key: lastVertexKey });
        }
        [lastVertexId, lastVertexKey] = [currentVertexId, currentVertexKey];
        vertexStack.pop();
      } else {
        const edges = g.adjacency[currentVertexId];
        let [edgeId, nextVertexId, nextVertexKey] = [
          edges[0].edgeId,
          edges[0].vertexId,
          g.edges[edges[0].edgeId].properties.key,
        ];
        for (const edge of edges) {
          if (g.edges[edge.edgeId].properties.key === 'segment') {
            [edgeId, nextVertexId, nextVertexKey] = [
              edge.edgeId,
              edge.vertexId,
              g.edges[edge.edgeId].properties.key,
            ];
            break;
          }
        }
        vertexStack.push([nextVertexId, nextVertexKey]);
        g.removeEdge(edgeId);
      }
    }
    if (startId !== endId) {
      path.unshift({ from: startId, to: endId, key: 'initial' });
    }

    // collapse sequential edges that fall on the same outline
    const newPath = [] as IPathStep[];
    let startRunId: string | undefined = undefined;
    for (const edge of path) {
      if (edge.key === 'segment') {
        if (startRunId !== undefined) {
          let graphHasEdge = false;
          for (const e of fillStitchGraph.adjacency[startRunId]) {
            if (e.vertexId === edge.from) {
              graphHasEdge = true;
              break;
            }
          }
          if (graphHasEdge) {
            newPath.push({ from: startRunId, to: edge.from, key: 'outline' });
          } else {
            newPath.push({ from: startRunId, to: edge.from, key: 'collapsed' });
          }
          startRunId = undefined;
        }
        newPath.push(edge);
      } else {
        if (startRunId === undefined) {
          startRunId = edge.from;
        }
      }
    }
    if (startRunId !== undefined && startRunId !== path[path.length - 1].to) {
      newPath.push({ from: startRunId, to: path[path.length - 1].to, key: 'collapsed' });
    }

    return newPath;
  }
  getStitchesFromPath(stitchPath, fillStitchGraph, pixelsPerMm) {
    let stitches = [] as Vector[];
    if (stitchPath[0].key !== 'segment') {
      stitches.push(fillStitchGraph.vertices[stitchPath[0].from].position);
    }
    for (const [i, edge] of stitchPath.entries()) {
      const [from, to] = [
        fillStitchGraph.vertices[edge.from],
        fillStitchGraph.vertices[edge.to],
      ];
      if (edge.key === 'segment') {
        stitches = stitches.concat(this.stitchRow(from, to, pixelsPerMm));
      } else {
        stitches = stitches.concat(
          this.findPath(
            from.position,
            to.position,
            this.stitchSpacingMm * pixelsPerMm,
            0.1 * this.stitchSpacingMm * pixelsPerMm,
          ),
        );
      }
    }
    return stitches;
  }
  stitchRow(from, to, pixelsPerMm) {
    const rowStitches = [] as Vector[];
    const offset = Utils.map(
      from.rowIndex % 2,
      0,
      2,
      0,
      this.stitchSpacingMm * pixelsPerMm,
    );
    const maxDist = to.rowStart.distance(to.rowEnd);
    const spacing = this.stitchSpacingMm * pixelsPerMm;
    const minD = Math.min(from.rowDistance, to.rowDistance);
    const maxD = Math.max(from.rowDistance, to.rowDistance);
    for (let d = offset; d < maxDist; d += spacing) {
      if (d > minD && d < maxD) {
        const lerp = to.rowStart.lerp(to.rowEnd, d / maxDist);
        if (
          from.position.distance(lerp) >= 0.25 * this.stitchSpacingMm * pixelsPerMm &&
          to.position.distance(lerp) >= 0.25 * this.stitchSpacingMm * pixelsPerMm
        ) {
          rowStitches.push(lerp);
        }
      }
    }
    if (from.rowDistance > to.rowDistance) {
      rowStitches.reverse();
    }
    return rowStitches;
  }
  findPath(
    from: Vector,
    to: Vector,
    maxStepSize,
    minStepSize,
    nLayer = 0,
    originalStepSize = null,
  ) {
    if (originalStepSize === null) originalStepSize = maxStepSize;
    const queue: Vector[][] = [[from]];
    const visited = new Set();
    while (queue.length > 0) {
      const next = queue.shift();
      const path = next === undefined ? [new Vector(0, 0)] : next;
      const current = path[path.length - 1];
      if (current.distance(to) < 2 * maxStepSize) return path;
      if (!visited.has(current.x + ',' + current.y)) {
        visited.add(current.x + ',' + current.y);
        let neighbors = [] as Vector[];
        if (nLayer === 0) {
          neighbors = [
            new Vector(current.x + maxStepSize, current.y),
            new Vector(current.x - maxStepSize, current.y),
            new Vector(current.x, current.y + maxStepSize),
            new Vector(current.x, current.y - maxStepSize),
          ];
        } else if (nLayer === 1) {
          neighbors = [
            new Vector(current.x + maxStepSize, current.y + maxStepSize),
            new Vector(current.x - maxStepSize, current.y - maxStepSize),
            new Vector(current.x + maxStepSize, current.y - maxStepSize),
            new Vector(current.x - maxStepSize, current.y + maxStepSize),
          ];
        } else if (nLayer === 2) {
          neighbors = [
            new Vector(current.x - 0.5 * maxStepSize, current.y + maxStepSize),
            new Vector(current.x + 0.5 * maxStepSize, current.y - maxStepSize),
            new Vector(current.x - 0.5 * maxStepSize, current.y - maxStepSize),
            new Vector(current.x + 0.5 * maxStepSize, current.y + maxStepSize),
            new Vector(current.x + maxStepSize, current.y - 0.5 * maxStepSize),
            new Vector(current.x - maxStepSize, current.y + 0.5 * maxStepSize),
            new Vector(current.x - maxStepSize, current.y - 0.5 * maxStepSize),
            new Vector(current.x + maxStepSize, current.y + 0.5 * maxStepSize),
          ];
        } else if (nLayer === 3) {
          neighbors = [
            new Vector(current.x - 0.25 * maxStepSize, current.y + maxStepSize),
            new Vector(current.x + 0.25 * maxStepSize, current.y - maxStepSize),
            new Vector(current.x - 0.25 * maxStepSize, current.y - maxStepSize),
            new Vector(current.x + 0.25 * maxStepSize, current.y + maxStepSize),
            new Vector(current.x + maxStepSize, current.y - 0.25 * maxStepSize),
            new Vector(current.x - maxStepSize, current.y + 0.25 * maxStepSize),
            new Vector(current.x - maxStepSize, current.y - 0.25 * maxStepSize),
            new Vector(current.x + maxStepSize, current.y + 0.25 * maxStepSize),
            new Vector(current.x - 0.75 * maxStepSize, current.y + maxStepSize),
            new Vector(current.x + 0.75 * maxStepSize, current.y - maxStepSize),
            new Vector(current.x - 0.75 * maxStepSize, current.y - maxStepSize),
            new Vector(current.x + 0.75 * maxStepSize, current.y + maxStepSize),
            new Vector(current.x + maxStepSize, current.y - 0.75 * maxStepSize),
            new Vector(current.x - maxStepSize, current.y + 0.75 * maxStepSize),
            new Vector(current.x - maxStepSize, current.y - 0.75 * maxStepSize),
            new Vector(current.x + maxStepSize, current.y + 0.75 * maxStepSize),
          ];
        }

        for (const neighbor of neighbors) {
          if (this.shape[0].containsPoint(neighbor)) {
            let checkContours = true;
            for (let i = 1; i < this.shape.length; i++) {
              const contour = this.shape[i];
              if (contour.containsPoint(neighbor)) {
                checkContours = false;
                break;
              }
            }
            const checkFilled = true;
            // for (let i = 0; i < this.filledPolylines.length; i++) {
            //   let polyline = this.filledPolylines[i];
            //   if (polyline.containsPoint(neighbor)) {
            //     checkFilled = false;
            //     break;
            //   }
            // }
            if (checkContours && checkFilled) {
              const newPath = [...path, neighbor];
              queue.push(newPath);
            }
          }
        }
      }
    }
    if (maxStepSize > minStepSize)
      return this.findPath(
        from,
        to,
        0.5 * maxStepSize,
        minStepSize,
        nLayer,
        originalStepSize,
      );
    if (nLayer < 1)
      return this.findPath(
        from,
        to,
        originalStepSize,
        minStepSize,
        nLayer + 1,
        originalStepSize,
      );
    console.log('no path found');
    return [];
  }
}
