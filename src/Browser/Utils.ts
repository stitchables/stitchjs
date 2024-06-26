export const Utils = {
  serializeToString: function (element: HTMLElement): string {
    return new XMLSerializer().serializeToString(element);
  },
  setAttributes: function (
    element: HTMLElement,
    attributes: { [name: string]: string },
  ): void {
    for (const [name, value] of Object.entries(attributes))
      element.setAttribute(name, value);
  },
  setStyles: function (element: HTMLElement, styles: { [key: string]: string }): void {
    for (const [key, value] of Object.entries(styles))
      element.style.setProperty(key, value);
  },
  setProperties: function (
    element: HTMLElement,
    properties: { [key: string]: any },
  ): void {
    for (const [key, value] of Object.entries(properties)) {
      (element as any)[key] = value;
    }
  },
  createElement: function (
    elementName: string,
    styles?: { [name: string]: string },
    attributes?: { [name: string]: string },
    properties?: { [name: string]: string },
  ): HTMLElement {
    const element = document.createElement(elementName);
    if (styles) this.setStyles(element, styles);
    if (attributes) this.setAttributes(element, attributes);
    if (properties) this.setProperties(element, properties);
    return element;
  },
  debounce: function (func: TimerHandler, time = 0): (event: Event) => void {
    let timer: number;
    return function (event) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(func, time, event);
    };
  },
};
