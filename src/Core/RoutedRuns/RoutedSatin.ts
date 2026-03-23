// import { IRoutedRun } from '../IRoutedRun';
// import { Vector } from '../../Math/Vector';
// import * as graphlib from '@dagrejs/graphlib';
// import { Stitch } from '../Stitch';
// import { Point, Polygon } from 'jsts/org/locationtech/jts/geom';
//
// interface UnderlayOptions {
//   stitchLengthMm?: number;
//   stitchToleranceMm?: number;
//   travelLengthMm?: number;
//   travelToleranceMm?: number;
//   densityMm?: number;
//   capInsetMm?: number;
//   sideInsetMm?: number;
// }
//
// export class RoutedSatin implements IRoutedRun {
//   quadStripVertices: Vector[];
//   isClosed: boolean;
//   densityMm: number;
//   travelLengthMm: number;
//   travelToleranceMm: number;
//   underlays: {
//     type: string;
//     options?: UnderlayOptions
//   }[];
//   constructor(
//     quadStripVertices: Vector[],
//     isClosed: boolean,
//     options?: {
//       densityMm?: number;
//       travelLengthMm?: number;
//       travelToleranceMm?: number;
//       isClosed?: boolean;
//       underlays?: {
//         type: string;
//         options?: UnderlayOptions;
//       }[];
//     },
//   ) {
//     this.quadStripVertices = quadStripVertices;
//     this.isClosed = isClosed;
//     this.densityMm = options?.densityMm ?? 0.2;
//     this.travelLengthMm = options?.travelLengthMm ?? 3;
//     this.travelToleranceMm = options?.travelToleranceMm ?? 0.1;
//     this.underlays = options?.underlays ?? [];
//   }
//
//   getPolygon(): Polygon {
//     if (this.isClosed) {
//
//     }
//   }
//
//   getTravelData: (pixelsPerMm: number) => {
//     graph: graphlib.Graph;
//     getEdgeWeight: (edgeLabel: any) => number;
//     nodeTree: STRtree;
//   };
//   getUnderlay: (pixelsPerMm: number, start?: Point, end?: Point) => Stitch[];
//   getStitches: (pixelsPerMm: number, start?: Point, end?: Point) => Stitch[];
// }
