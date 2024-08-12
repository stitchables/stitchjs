import { Graph } from '../Math/Graph';

enum CoverPathJoinType {
  'none' = 0,
  'beginning' = 1,
  'middle' = 2,
  'end' = 3,
}

// https://arxiv.org/pdf/2101.08947#:~:text=In%20graph%20theory%2C%20the%20path,edge%20weights%20of%20the%20graph.
// export function getPathCovering(
//   graph: Graph<any, { [key: string]: any }>,
//   edgeWeightPropertyName: string,
// ): {
//   edgeSequence: string[];
//   startVertexId: string;
//   endVertexId: string;
// }[] {
//   const sortedEdgeIds = Object.keys(graph.edges).sort(
//     (a, b) =>
//       graph.edges[a].properties[edgeWeightPropertyName] -
//       graph.edges[b].properties[edgeWeightPropertyName],
//   );
//
//   const pathCovering: {
//     edgeSequence: string[];
//     startVertexId: string;
//     endVertexId: string;
//   }[] = [];
//   const usedVertexIds = new Set<string>();
//   for (const edgeId of sortedEdgeIds) {
//     const edge = graph.edges[edgeId];
//     const [u, v] = [edge.vertexId1, edge.vertexId2];
//     const [uUsed, vUsed] = [usedVertexIds.has(u), usedVertexIds.has(v)];
//     if (!uUsed && !vUsed) {
//       pathCovering.push({ edgeSequence: [edgeId], startVertexId: u, endVertexId: v });
//       usedVertexIds.add(u);
//       usedVertexIds.add(v);
//     } else {
//       let [uPathCoverIndex, vPathCoverIndex] = [-1, -1];
//       let [uIsPathStart, vIsPathStart] = [true, true];
//       for (let i = 0; i < pathCovering.length; i++) {
//         if (u === pathCovering[i].startVertexId || u === pathCovering[i].endVertexId) {
//           uPathCoverIndex = i;
//           uIsPathStart = u === pathCovering[i].startVertexId;
//         }
//         if (v === pathCovering[i].startVertexId || v === pathCovering[i].endVertexId) {
//           vPathCoverIndex = i;
//           vIsPathStart = v === pathCovering[i].startVertexId;
//         }
//         if (uPathCoverIndex > -1 && vPathCoverIndex > -1) {
//           break;
//         }
//       }
//
//       if (uPathCoverIndex > -1 && !vUsed) {
//         if (uIsPathStart) {
//           pathCovering[uPathCoverIndex].edgeSequence.unshift(edgeId);
//           pathCovering[uPathCoverIndex].startVertexId = v;
//         } else {
//           pathCovering[uPathCoverIndex].edgeSequence.push(edgeId);
//           pathCovering[uPathCoverIndex].endVertexId = v;
//         }
//         usedVertexIds.add(v);
//       } else if (!uUsed && vPathCoverIndex > -1) {
//         if (vIsPathStart) {
//           pathCovering[vPathCoverIndex].edgeSequence.unshift(edgeId);
//           pathCovering[vPathCoverIndex].startVertexId = u;
//         } else {
//           pathCovering[vPathCoverIndex].edgeSequence.push(edgeId);
//           pathCovering[vPathCoverIndex].endVertexId = u;
//         }
//         usedVertexIds.add(u);
//       } else if (
//         uPathCoverIndex > -1 &&
//         vPathCoverIndex > -1 &&
//         uPathCoverIndex !== vPathCoverIndex
//       ) {
//         if (uIsPathStart) {
//           pathCovering[uPathCoverIndex].edgeSequence.reverse();
//           [
//             pathCovering[uPathCoverIndex].startVertexId,
//             pathCovering[uPathCoverIndex].endVertexId,
//           ] = [
//             pathCovering[uPathCoverIndex].endVertexId,
//             pathCovering[uPathCoverIndex].startVertexId,
//           ];
//         }
//         if (!vIsPathStart) {
//           pathCovering[vPathCoverIndex].edgeSequence.reverse();
//           [
//             pathCovering[vPathCoverIndex].startVertexId,
//             pathCovering[vPathCoverIndex].endVertexId,
//           ] = [
//             pathCovering[vPathCoverIndex].endVertexId,
//             pathCovering[vPathCoverIndex].startVertexId,
//           ];
//         }
//         pathCovering[uPathCoverIndex].edgeSequence.push(edgeId);
//         pathCovering[uPathCoverIndex].edgeSequence = pathCovering[
//           uPathCoverIndex
//         ].edgeSequence.concat(pathCovering[vPathCoverIndex].edgeSequence);
//         pathCovering[uPathCoverIndex].endVertexId =
//           pathCovering[vPathCoverIndex].endVertexId;
//         pathCovering.splice(vPathCoverIndex, 1);
//       }
//     }
//   }
//   return pathCovering;
// }

// export function nearestNeighborTSP(graph: Graph<any, any>, startNode: string, getEdgeWeight: (properties: any) => number = () => 1) {
//
//   const shortestPaths = graph.findShortestPaths(getEdgeWeight);
//
//   const queue: { [vertexId: string]: }
//   const visited = new Set();
//   const path = [startNode];
//   let currentNode = startNode;
//   visited.add(startNode);
//
//   while (path.length < Object.keys(graph.vertices).length) {
//     let shortestPath = Object.keys(shortestPaths.distances).sort((a, b) => shortestPaths.distances[a] - shortestPaths.distances[b])
//     let nearestNode = undefined;
//     let shortestDistance = Infinity;
//
//     for (let neighbor in graph[currentNode]) {
//       if (!visited.has(neighbor) && graph[currentNode][neighbor] < shortestDistance) {
//         shortestDistance = graph[currentNode][neighbor];
//         nearestNode = neighbor;
//       }
//     }
//
//     if (nearestNode !== null) {
//       visited.add(nearestNode);
//       path.push(nearestNode);
//       currentNode = nearestNode;
//     }
//   }
//
//   // Optionally return to the startNode to complete the circuit
//   // if (graph[currentNode][startNode] !== undefined) {
//   //   path.push(startNode);
//   // }
//
//   return path;
// }
