import { SVG, registerWindow, Svg } from '@svgdotjs/svg.js';
import { Resvg, ResvgRenderOptions } from '@resvg/resvg-js';
import { createSVGWindow } from 'svgdom';
import { deepClone } from 'zhin';

export interface Drawer extends Svg {}

export class Drawer {
  private container: Svg;
  private options: Required<ResvgRenderOptions>;

  constructor(options: ResvgRenderOptions = {}) {
    const window = createSVGWindow();
    const document = window.document;
    registerWindow(window, document);
    this.container = SVG(document.documentElement) as Svg;
    this.options = Object.assign(deepClone(Drawer.defaultOptions), options) as Required<ResvgRenderOptions>;
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
