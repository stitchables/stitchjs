export class Slider {
  container: HTMLDivElement;
  slider: HTMLInputElement;
  constructor(min: number, max: number, initialValue: number) {
    this.container = document.createElement('div');
    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.min = min.toString();
    this.slider.max = max.toString();
    this.slider.value = initialValue.toString();
    this.container.appendChild(this.slider);
  }
  getValue(): string {
    return this.slider.value;
  }
}
