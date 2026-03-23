import * as graphlib from '@dagrejs/graphlib';
import MinPriorityQueue from './MinPriorityQueue';
import { Point } from 'jsts/org/locationtech/jts/geom';
import { DistanceOp } from 'jsts/org/locationtech/jts/operation/distance';

export function findPath(
  graph: graphlib.Graph,
  source: string,
  target: string,
  getNodePoint: (nodeLabel: any) => Point,
  getEdgeWeight: (edgeLabel: any) => number,
): string[] | undefined {
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
  fScore.set(
    source,
    DistanceOp.distance(
      getNodePoint(graph.node(source)),
      getNodePoint(graph.node(target)),
    ),
  );

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
        const weight = getEdgeWeight(graph.edge(nodeEdge[0])); // get the edge weight
        const tentativeG = gScore.get(u) + weight;
        if (tentativeG < gScore.get(v)) {
          cameFrom.set(v, u);
          gScore.set(v, tentativeG);
          const f =
            tentativeG +
            DistanceOp.distance(
              getNodePoint(graph.node(v)),
              getNodePoint(graph.node(target)),
            );
          fScore.set(v, f);
          openSet.enqueue({ node: v, priority: f });
        }
      }
    }
  }

  // no path
  return undefined;
}
