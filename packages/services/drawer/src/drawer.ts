import { SVG, registerWindow, Svg } from '@svgdotjs/svg.js';
import { Resvg, ResvgRenderOptions } from '@resvg/resvg-js';
import { createSVGWindow, SVGDocument, SVGWindow } from 'svgdom';
import { deepClone } from 'zhin';
export interface Drawer extends Svg {}

export class Drawer {
  private container: Svg;
  private options: Required<ResvgRenderOptions>;
  #window: SVGWindow;
  #document: SVGDocument;
  constructor(options: ResvgRenderOptions = {}) {
    this.#window = createSVGWindow();
    this.#document = this.#window.document;
    registerWindow(this.#window, this.#document);
    this.container = SVG(this.#document.documentElement) as Svg;
    this.options = Object.assign(deepClone(Drawer.defaultOptions || {}), options || {}) as Required<ResvgRenderOptions>;
    return new Proxy(this, {
      get(target: Drawer, p: string | symbol, receiver: any): any {
        if (['container', 'options', 'render'].includes(p as string)) return Reflect.get(target, p, receiver);
        return Reflect.get(target.container, p, receiver);
      },
    });
  }
  render() {
    return new Resvg(this.container.svg(), this.options).render().asPng();
  }
}
new Drawer().text('abc').size('small');
export namespace Drawer {
  export const defaultOptions: ResvgRenderOptions = {
    background: `rgb(255, 255, 255)`,
    fitTo: {
      mode: 'width',
      value: 1200,
    },
    font: {
      fontFiles: [],
      loadSystemFonts: true,
    },
    logLevel: 'off',
  };
}
