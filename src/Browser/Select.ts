export class Select {
  container: HTMLDivElement;
  select: HTMLSelectElement;
  constructor(options: string[]) {
    this.container = document.createElement('div');
    this.select = document.createElement('select');
    for (const o of options) {
      const option = document.createElement('option');
      option.innerHTML = o;
      this.select.appendChild(option);
    }
    this.container.appendChild(this.select);
  }
  getValue(): string {
    return this.select.value;
  }
}
