import { Point, Polygon } from 'jsts/org/locationtech/jts/geom';
import { STRtree } from 'jsts/org/locationtech/jts/index/strtree';
import { Stitch } from './Stitch';
import * as graphlib from '@dagrejs/graphlib';
import { IRun } from './IRun';

export interface IRoutedRun extends IRun {
  getPolygon: () => Polygon;
  getTravelData: (pixelsPerMm: number) => {
    graph: graphlib.Graph;
    getEdgeWeight: (edgeLabel: any) => number;
    nodeTree: STRtree;
  };
  getUnderlay: (pixelsPerMm: number, start?: Point, end?: Point) => Stitch[];
  getStitches: (pixelsPerMm: number, start?: Point, end?: Point) => Stitch[];
}
