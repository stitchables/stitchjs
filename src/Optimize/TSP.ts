import * as graphlib from '@dagrejs/graphlib';
import blossom from 'edmonds-blossom';

// implementation of Christofides Algorithm
// https://en.wikipedia.org/wiki/Christofides_algorithm
export function TSP<TNode, TEdge>(
  graph: graphlib.Graph<any, TNode, TEdge>,
  getWeight: (edgeLabel: TEdge, edge: graphlib.Edge) => number,
): string[] {
  // Create a minimum spanning tree T of G.
  const t = kruskalMST<TNode, TEdge>(graph, getWeight);
  // Let O be the set of vertices with odd degree in T. By the handshaking lemma, O has an even number of vertices.
  const o = [];
  for (const node of t.nodes()) {
    if ((t.nodeEdges(node)?.length ?? 0) % 2 === 1) o.push(node);
  }
  // Get the subgraph S induced in G by O
  const s = inducedSubgraph(graph, o);
  // Find a minimum-weight perfect matching M in the subgraph
  const m = minimumWeightPerfectMatching(s, getWeight);
  // add the edges of M to T to form a connected multigraph in which each vertex has even degree.
  for (const e of m) t.setEdge(e.v, e.w, e.label, 'extra');
  // Form an Eulerian circuit E in T.
  const e = findEulerianCircuit(t);
  // Make the circuit found in previous step into a Hamiltonian circuit by skipping repeated vertices (shortcutting).
  const result = [];
  const visited = new Set<string>();
  for (const step of e) {
    // if (visited.has(step.from)) continue;
    result.push(step.from);
    // visited.add(step.from);
  }
  return result;
}

export function inducedSubgraph<TNode, TEdge>(
  g: graphlib.Graph<any, TNode, TEdge>,
  o: string[],
): graphlib.Graph<any, TNode, TEdge> {
  const nodeSet = new Set(o);

  const subgraph = new graphlib.Graph<any, TNode, TEdge>({
    directed: g.isDirected(),
    multigraph: g.isMultigraph(),
    compound: g.isCompound(),
  });

  // Copy graph label
  subgraph.setGraph(g.graph());

  // Add nodes
  for (const node of o) {
    if (!g.hasNode(node)) continue;

    subgraph.setNode(node, g.node(node));
  }

  // Add edges whose endpoints are both in the node set
  for (const edge of g.edges()) {
    if (nodeSet.has(edge.v) && nodeSet.has(edge.w)) {
      subgraph.setEdge(edge.v, edge.w, g.edge(edge), edge.name);
    }
  }

  return subgraph;
}

class UnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  constructor(nodes: string[]) {
    for (const node of nodes) {
      this.parent.set(node, node);
      this.rank.set(node, 0);
    }
  }

  find(x: string): string {
    const p = this.parent.get(x);
    if (p === undefined) throw new Error(`Unknown node: ${x}`);

    if (p !== x) {
      const root = this.find(p);
      this.parent.set(x, root);
      return root;
    }

    return x;
  }

  union(a: string, b: string): boolean {
    let rootA = this.find(a);
    let rootB = this.find(b);

    if (rootA === rootB) return false;

    const rankA = this.rank.get(rootA)!;
    const rankB = this.rank.get(rootB)!;

    if (rankA < rankB) {
      [rootA, rootB] = [rootB, rootA];
    }

    this.parent.set(rootB, rootA);

    if (rankA === rankB) {
      this.rank.set(rootA, rankA + 1);
    }

    return true;
  }
}

export function kruskalMST<TNode, TEdge>(
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

  const uf = new UnionFind(graph.nodes());

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

interface MatchingEdge<TEdge> {
  v: string;
  w: string;
  edge: graphlib.Edge;
  weight: number;
  label: TEdge;
}

// https://en.wikipedia.org/wiki/Blossom_algorithm
export function minimumWeightPerfectMatching<TNode, TEdge>(
  graph: graphlib.Graph<any, TNode, TEdge>,
  getWeight: (label: TEdge, edge: graphlib.Edge) => number,
): MatchingEdge<TEdge>[] {
  if (graph.isDirected()) {
    throw new Error('Blossom matching requires an undirected graph.');
  }

  const nodes = graph.nodes();

  if (nodes.length % 2 !== 0) {
    throw new Error('Perfect matching requires an even number of nodes.');
  }

  const nodeToIndex = new Map(nodes.map((node, i) => [node, i]));
  const bestEdgeByPair = new Map<string, MatchingEdge<TEdge>>();

  const key = (i: number, j: number) => (i < j ? `${i}|${j}` : `${j}|${i}`);

  for (const edge of graph.edges()) {
    const i = nodeToIndex.get(edge.v);
    const j = nodeToIndex.get(edge.w);

    if (i === undefined || j === undefined || i === j) continue;

    const label = graph.edge(edge) as TEdge;
    const weight = getWeight(label, edge);
    const k = key(i, j);

    const existing = bestEdgeByPair.get(k);
    if (!existing || weight < existing.weight) {
      bestEdgeByPair.set(k, {
        v: edge.v,
        w: edge.w,
        edge,
        weight,
        label,
      });
    }
  }

  if (bestEdgeByPair.size === 0 && nodes.length > 0) {
    throw new Error('No edges available for matching.');
  }

  // edmonds-blossom maximizes weight.
  // To minimize original weight, maximize transformed weight.
  const weights = [...bestEdgeByPair.values()].map((e) => e.weight);
  const maxAbs = Math.max(1, ...weights.map((w) => Math.abs(w)));

  // Large constant forces maximum-cardinality / perfect matching
  // before optimizing weight.
  const BIG = (weights.length + 1) * maxAbs + 1;

  const blossomEdges: Array<[number, number, number]> = [];

  for (const e of bestEdgeByPair.values()) {
    const i = nodeToIndex.get(e.v)!;
    const j = nodeToIndex.get(e.w)!;

    // Maximize BIG - weight === minimize weight,
    // while BIG encourages matching as many nodes as possible.
    blossomEdges.push([i, j, BIG - e.weight]);
  }

  const mate: number[] = blossom(blossomEdges);

  const result: MatchingEdge<TEdge>[] = [];
  const used = new Set<number>();

  for (let i = 0; i < mate.length; i++) {
    const j = mate[i];

    if (j == null || j < 0) continue;
    if (used.has(i) || used.has(j)) continue;

    used.add(i);
    used.add(j);

    const match = bestEdgeByPair.get(key(i, j));

    if (!match) {
      throw new Error('Internal error: Blossom returned a missing edge.');
    }

    result.push(match);
  }

  if (result.length !== nodes.length / 2) {
    throw new Error('No perfect matching exists for the given nodes.');
  }

  return result;
}

// https://en.wikipedia.org/wiki/Eulerian_path#Hierholzer's_algorithm
export function findEulerianCircuit<TNode, TEdge>(
  graph: graphlib.Graph<TNode, TEdge>,
  startNode?: string,
): { from: string; to: string }[] {
  if (graph.isDirected()) {
    throw new Error('This implementation expects an undirected graph.');
  }

  const nodes = graph.nodes();

  if (nodes.length === 0) return [];

  for (const node of nodes) {
    const degree = graph.nodeEdges(node)?.length ?? 0;

    if (degree % 2 !== 0) {
      throw new Error(`Graph is not Eulerian: node ${node} has odd degree.`);
    }
  }

  const edges = graph.edges();

  if (edges.length === 0) return [];

  const start =
    startNode ??
    nodes.find((node) => (graph.nodeEdges(node)?.length ?? 0) > 0) ??
    nodes[0];

  if (!graph.hasNode(start)) {
    throw new Error(`Start node ${start} does not exist in graph.`);
  }

  type AdjItem = {
    to: string;
    edge: graphlib.Edge;
  };

  const edgeId = (e: graphlib.Edge): string =>
    e.name === undefined ? `${e.v}|${e.w}` : `${e.v}|${e.w}|${e.name}`;

  const adjacency = new Map<string, AdjItem[]>();

  for (const node of nodes) {
    adjacency.set(node, []);
  }

  for (const edge of edges) {
    adjacency.get(edge.v)!.push({ to: edge.w, edge });
    adjacency.get(edge.w)!.push({ to: edge.v, edge });
  }

  const used = new Set<string>();

  const stack: Array<{
    node: string;
    via?: { from: string; to: string };
  }> = [{ node: start }];

  const circuit: { from: string; to: string }[] = [];

  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    const incident = adjacency.get(top.node)!;

    while (incident.length > 0 && used.has(edgeId(incident[incident.length - 1].edge))) {
      incident.pop();
    }

    if (incident.length === 0) {
      const popped = stack.pop()!;

      if (popped.via) {
        circuit.push(popped.via);
      }
    } else {
      const next = incident.pop()!;
      const id = edgeId(next.edge);

      if (used.has(id)) continue;

      used.add(id);

      stack.push({ node: next.to, via: { from: top.node, to: next.to } });
    }
  }

  if (used.size !== edges.length) {
    throw new Error(
      'Graph is not Eulerian: not all edges were reachable from the start node.',
    );
  }

  // Edges are collected during backtracking, so reverse them.
  return circuit.reverse();
}
