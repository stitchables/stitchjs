export class Graph<VertexPropertyType, EdgePropertyType> {
  vertices: { [vertexId: string]: VertexPropertyType };
  adjacency: { [vertexId: string]: { edgeId: number; vertexId: string }[] };
  edges: {
    [edgeId: number]: {
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
  addEdge(vertexId1: string, vertexId2: string, properties: EdgePropertyType): void {
    const edgeId = Object.keys(this.edges).length;
    if (vertexId1 in this.adjacency) {
      this.adjacency[vertexId1].push({ edgeId: edgeId, vertexId: vertexId2 });
    }
    this.adjacency[vertexId2].push({ edgeId: edgeId, vertexId: vertexId1 });
    this.edges[edgeId] = { vertexId1, vertexId2, properties };
  }
  removeEdge(edgeId) {
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
}
