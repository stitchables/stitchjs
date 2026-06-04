import * as graphlib from '@dagrejs/graphlib';
import DisjointSet from './DisjointSet';

// https://en.wikipedia.org/wiki/Kruskal%27s_algorithm
export default function MinimumSpanningTree<TNode, TEdge>(
  graph: graphlib.Graph<any, TNode, TEdge>,
  getWeight: (edgeLabel: TEdge, edge: graphlib.Edge) => number,
): graphlib.Graph<any, TNode, TEdge> {
  if (graph.isDirected()) {
    throw new Error('Kruskal MST requires an undirected graph.');
  }

  const mst = new graphlib.Graph<any, TNode, TEdge>({
    directed: false,
    multigraph: true,
  });

  // Copy graph-level label if present
  mst.setGraph(graph.graph());

  // Copy nodes and node labels
  for (const node of graph.nodes()) {
    mst.setNode(node, graph.node(node));
  }

  const uf = new DisjointSet(graph.nodes());

  const edges = graph.edges().sort((a, b) => {
    const wa = getWeight(graph.edge(a) as TEdge, a);
    const wb = getWeight(graph.edge(b) as TEdge, b);
    return wa - wb;
  });

  for (const edge of edges) {
    if (uf.union(edge.v, edge.w)) {
      mst.setEdge(edge.v, edge.w, graph.edge(edge) as TEdge, edge.name);
      if (mst.edgeCount() === graph.nodeCount() - 1) {
        break;
      }
    }
  }

  return mst;
}
