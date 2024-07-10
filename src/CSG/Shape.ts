import { Segment } from './Segment';
import { Node } from './Node';
import { Polyline } from '../Math/Polyline';
import { Vector } from '../Math/Vector';

export interface NestedPolyline {
  polyline: Polyline;
  area: number;
  parent?: NestedPolyline;
  children: NestedPolyline[];
}

export interface StructuredPolyline {
  polyline: Polyline;
  contours: Polyline[];
}

export class Shape {
  segments: Segment[];
  constructor(segments?: Segment[]) {
    this.segments = segments ?? [];
  }
  static fromPolylines(polylines: Polyline[]): Shape {
    const shape = new Shape();
    for (let polyline of polylines) {
      for (let i = 0; i < polyline.vertices.length; i++) {
        shape.segments.push(
          new Segment([
            polyline.vertices[i].copy(),
            polyline.vertices[(i + 1) % polyline.vertices.length].copy(),
          ]),
        );
      }
    }
    return shape;
  }
  clone(): Shape {
    return new Shape(this.segments.map((s) => s.clone()));
  }
  toPolylines(epsilon = 0.1): StructuredPolyline[] {
    let polylines = [];
    let list = this.segments.slice();

    const findNext = function (extremum: Vector): Segment | undefined {
      const minVertex = { index: -1, distance: Infinity };
      for (let i = 0; i < list.length; i++) {
        const distance = list[i].vertices[0].squaredDistance(extremum);
        if (distance < minVertex.distance) {
          [minVertex.index, minVertex.distance] = [i, distance];
        }
      }
      if (minVertex.distance < epsilon) {
        const result = list[minVertex.index].clone();
        list.splice(minVertex.index, 1);
        return result;
      }
      return undefined;
    };

    let currentIndex = 0;
    while (list.length > 0) {
      if (!polylines[currentIndex]) polylines[currentIndex] = new Polyline(true);
      if (polylines[currentIndex].vertices.length === 0) {
        polylines[currentIndex].vertices.push(list[0].vertices[0]);
        polylines[currentIndex].vertices.push(list[0].vertices[1]);
        list.splice(0, 1);
      }
      let next = findNext(
        polylines[currentIndex].vertices[polylines[currentIndex].vertices.length - 1],
      );
      if (next) polylines[currentIndex].vertices.push(next.vertices[1]);
      else currentIndex++;
    }

    let nestedPolylines: NestedPolyline[] = [];
    for (let i = 0; i < polylines.length; i++) {
      nestedPolylines.push({
        polyline: polylines[i],
        area: polylines[i].getArea(),
        parent: undefined,
        children: [],
      });
    }
    nestedPolylines.sort((a, b) => (a.area > b.area ? 1 : -1));
    for (let i = 0; i < nestedPolylines.length; i++) {
      let minParentArea = Infinity;
      let minParent = null;
      for (let j = i + 1; j < nestedPolylines.length; j++) {
        if (
          nestedPolylines[j].polyline.containsPoint(
            nestedPolylines[i].polyline.vertices[0],
          )
        ) {
          if (nestedPolylines[j].area < minParentArea) {
            minParentArea = nestedPolylines[j].area;
            minParent = nestedPolylines[j];
            nestedPolylines[i].parent = nestedPolylines[j];
          }
        }
      }
      if (minParent !== null) minParent.children.push(nestedPolylines[i]);
    }

    const structuredPolylines: StructuredPolyline[] = [];
    while (nestedPolylines.length > 0) {
      let shapes = nestedPolylines.filter((x) => !x.parent);
      for (let shape of shapes) {
        structuredPolylines.push({
          polyline: shape.polyline,
          contours: shape.children.map((x) => x.polyline),
        });
        nestedPolylines = nestedPolylines.filter(
          (x) => x !== shape && x.parent !== shape,
        );
        for (let nestedPolyline of nestedPolylines) {
          for (let child of shape.children) {
            if (nestedPolyline.parent === child) {
              nestedPolyline.parent = undefined;
            }
          }
        }
      }
    }
    return structuredPolylines;
  }
  inverse(): Shape {
    const shape = this.clone();
    shape.segments.map((p) => p.flip());
    return shape;
  }
  union(shape: Shape): Shape {
    const a = new Node(this.clone().segments);
    const b = new Node(shape.clone().segments);
    a.invert();
    b.clipTo(a);
    b.invert();
    a.clipTo(b);
    b.clipTo(a);
    a.build(b.allSegments());
    a.invert();
    return new Shape(a.allSegments());
  }
  subtract(shape: Shape): Shape {
    const b = new Node(this.clone().segments);
    const a = new Node(shape.clone().segments);
    a.invert();
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allSegments());
    a.invert();
    return new Shape(a.allSegments()).inverse();
  }
  intersect(shape: Shape): Shape {
    const a = new Node(this.clone().segments);
    const b = new Node(shape.clone().segments);
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allSegments());
    return new Shape(a.allSegments());
  }
}
