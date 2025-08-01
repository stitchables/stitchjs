export default class MinPriorityQueue {
  heap: any[];
  constructor() {
    this.heap = [];
  }
  isEmpty(): boolean {
    return this.heap.length === 0;
  }
  enqueue(item: any): void {
    this.heap.push(item);
    this._siftUp(this.heap.length - 1);
  }
  dequeue(): any {
    if (this.isEmpty()) return null;
    this._swap(0, this.heap.length - 1);
    const min = this.heap.pop();
    this._siftDown(0);
    return min;
  }
  peek(): any {
    return this.heap[0];
  }
  _parent(i: any): number {
    return Math.floor((i - 1) / 2);
  }
  _left(i: any): number {
    return 2 * i + 1;
  }
  _right(i: any): number {
    return 2 * i + 2;
  }
  _swap(i: any, j: any): void {
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
  }
  _siftUp(i: any): void {
    let idx = i;
    while (idx > 0) {
      const p = this._parent(idx);
      if (this.heap[p].priority <= this.heap[idx].priority) break;
      this._swap(p, idx);
      idx = p;
    }
  }
  _siftDown(i: any): void {
    let idx = i,
      len = this.heap.length;
    while (true) {
      const l = this._left(idx),
        r = this._right(idx);
      let smallest = idx;
      if (l < len && this.heap[l].priority < this.heap[smallest].priority) smallest = l;
      if (r < len && this.heap[r].priority < this.heap[smallest].priority) smallest = r;
      if (smallest === idx) break;
      this._swap(idx, smallest);
      idx = smallest;
    }
  }
}
