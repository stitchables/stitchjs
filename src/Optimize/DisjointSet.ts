export default class DisjointSet {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();
  private componentCount: number;
  constructor(nodes: string[]) {
    this.componentCount = nodes.length;
    for (const node of nodes) {
      this.parent.set(node, node);
      this.rank.set(node, 0);
    }
  }
  isFullyConnected(): boolean {
    return this.componentCount <= 1;
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
    this.componentCount--;
    return true;
  }
}
