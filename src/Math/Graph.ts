export class Graph<VertexPropertyType, EdgePropertyType> {
  vertices: { [vertexId: string]: VertexPropertyType };
  adjacency: { [vertexId: string]: { edgeId: number; vertexId: string }[] };
  edges: {
    [edgeId: string]: {
      vertexId1: string;
      vertexId2: string;
      properties: EdgePropertyType;
    };
  };
  constructor() {
    this.vertices = {};
    this.adjacency = {};
    this.edges = {};
  }
  copy() {
    const copy = new Graph<VertexPropertyType, EdgePropertyType>();
    copy.vertices = structuredClone(this.vertices);
    copy.adjacency = structuredClone(this.adjacency);
    copy.edges = structuredClone(this.edges);
    return copy;
  }
  addVertex(vertexId: string, properties: VertexPropertyType) {
    this.vertices[vertexId] = properties;
    this.adjacency[vertexId] = [];
  }
  addEdge(vertexId1: string, vertexId2: string, properties: EdgePropertyType) {
    const edgeId = Object.keys(this.edges).length;
    this.adjacency[vertexId1].push({ edgeId: edgeId, vertexId: vertexId2 });
    this.adjacency[vertexId2].push({ edgeId: edgeId, vertexId: vertexId1 });
    this.edges[edgeId] = { vertexId1, vertexId2, properties };
  }
  removeEdge(edgeId: number) {
    const edge = this.edges[edgeId];
    for (let i = 0; i < this.adjacency[edge.vertexId1].length; i++) {
      if (this.adjacency[edge.vertexId1][i].edgeId === edgeId) {
        this.adjacency[edge.vertexId1].splice(i, 1);
        break;
      }
    }
    for (let i = 0; i < this.adjacency[edge.vertexId2].length; i++) {
      if (this.adjacency[edge.vertexId2][i].edgeId === edgeId) {
        this.adjacency[edge.vertexId2].splice(i, 1);
        break;
      }
    }
    delete this.edges[edgeId];
  }

  // Method to compute the TSP using nearest neighbor
  tsp(getEdgeWeight: (properties: EdgePropertyType) => number = () => 1) {
    let tspPath: string[] = [];
    const shortestPaths = this.findShortestPaths(getEdgeWeight);
    console.log(shortestPaths);
    const vertexIds = Object.keys(this.vertices);

    // Initialize all vertices as unvisited.
    const queue = new Set<string>(vertexIds);

    // Select an arbitrary vertex, set it as the current vertex u. Mark u as visited.
    let current = vertexIds[Math.floor(Math.random() * vertexIds.length)];
    tspPath.push(current);
    queue.delete(current);

    while (queue.size > 0) {
      // Find out the shortest edge connecting the current vertex u and an unvisited vertex v.
      let next: {
        vertexId: string | undefined;
        isFront: boolean;
        distance: number;
        path: string[];
      } = {
        vertexId: undefined,
        isFront: false,
        distance: Infinity,
        path: [],
      };
      for (const v of queue.values()) {
        const currentFront = tspPath[0];
        const currentBack = tspPath[tspPath.length - 1];
        const distanceFront = shortestPaths.distances[currentFront][v];
        const distanceBack = shortestPaths.distances[currentBack][v];
        if (distanceBack < next.distance) {
          next.vertexId = v;
          next.isFront = false;
          next.distance = distanceBack;
          next.path = shortestPaths.paths[current][v];
        }
        if (tspPath.length > 1 && distanceFront < next.distance) {
          next.vertexId = v;
          next.isFront = true;
          next.distance = distanceFront;
          next.path = shortestPaths.paths[v][current];
        }
      }

      if (next.vertexId === undefined) {
        break;
      }

      // Set v as the current vertex u. Mark v as visited.
      for (const v of next.path) {
        queue.delete(v);
      }
      if (next.isFront) {
        next.path.pop();
        tspPath = next.path.concat(tspPath);
      } else {
        next.path.shift();
        tspPath = tspPath.concat(next.path);
      }
    }
    console.log(tspPath);
  }

  // Floyd-Warshall Algorithm for finding the shortest paths between all pairs of vertices
  findShortestPaths(getEdgeWeight: (properties: EdgePropertyType) => number = () => 1) {
    const dist: { [vertexId: string]: { [vertexId: string]: number } } = {};
    const next: { [vertexId: string]: { [vertexId: string]: string | undefined } } = {};
    const vertices = Object.keys(this.vertices);

    // Initialize distances and next vertices
    for (const v1 of vertices) {
      dist[v1] = {};
      next[v1] = {};
      for (const v2 of vertices) {
        if (v1 === v2) {
          dist[v1][v2] = 0;
          next[v1][v2] = undefined;
        } else {
          dist[v1][v2] = Infinity;
          next[v1][v2] = undefined;
        }
      }
    }

    // Set initial distances and next based on direct edges
    for (const edgeId in this.edges) {
      const edge = this.edges[edgeId];
      const v1 = edge.vertexId1;
      const v2 = edge.vertexId2;
      const weight = getEdgeWeight(edge.properties);

      dist[v1][v2] = weight;
      dist[v2][v1] = weight;
      next[v1][v2] = v2;
      next[v2][v1] = v1;
    }

    // Floyd-Warshall Algorithm
    for (const k of vertices) {
      for (const i of vertices) {
        for (const j of vertices) {
          if (dist[i][j] > dist[i][k] + dist[k][j]) {
            dist[i][j] = dist[i][k] + dist[k][j];
            next[i][j] = next[i][k];
          }
        }
      }
    }

    // Reconstruct paths
    const paths: { [vertexId: string]: { [vertexId: string]: string[] } } = {};
    for (const i of vertices) {
      paths[i] = {};
      for (const j of vertices) {
        if (next[i][j] !== undefined) {
          paths[i][j] = this.constructPath(i, j, next);
        } else {
          paths[i][j] = [];
        }
      }
    }

    return { distances: dist, paths };
  }

  // Helper function to construct the path from i to j
  private constructPath(
    i: string,
    j: string,
    next: { [vertexId: string]: { [vertexId: string]: string | undefined } },
  ): string[] {
    const path = [];
    let current: string | undefined = i;
    while (current !== j) {
      path.push(current);
      current = next[current][j];
      if (current === undefined) {
        return []; // If there's no path, return an empty array
      }
    }
    path.push(j);
    return path;
  }
}
