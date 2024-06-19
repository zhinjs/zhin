import { Renderer } from '@/renderer';
import { Browser } from 'puppeteer-core';
export class HtmlRenderer extends Renderer {
  browser: Browser | null = null;
  constructor(endpoint: string = process.env.ENDPOINT) {
    super('html', endpoint);
  }

  rendering<T extends Renderer.OutputType>(input: string, options: Renderer.Options<T>): Renderer.Output<T> {
    return null as any;
  }
}
export default new HtmlRenderer();
