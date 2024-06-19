import * as process from 'process';
import { axios } from 'zhin';
import puppeteer, { Browser, ScreenshotOptions, Viewport, WaitForOptions } from 'puppeteer-core';

export class Renderer {
  browser: Browser | null = null;

  constructor(
    public type: string,
    public endpoint: string = process.env.ENDPOINT || '',
    private maxPages: number = Number(process.env.MAX_PAGES || 10),
  ) {}

  async connect() {
    return new Promise<Browser | null>(async resolve => {
      if (this.browser) return resolve(this.browser);
      if (this.endpoint.startsWith('http')) this.endpoint = await this.getEndpointByURL(this.endpoint);
      this.browser = await puppeteer.connect({
        browserWSEndpoint: this.endpoint,
      });
      return resolve(this.browser);
    });
  }
  private async getEndpointByURL(endpoint: string) {
    const url = new URL(endpoint);
    const result = await axios.get(`${url.origin}/json/version`);
    if (!result?.data) throw new Error('getEndpoint failed');
    return result.data?.webSocketDebuggerUrl as string;
  }
  async getPage() {
    const browser = await this.connect();
    if (!browser) throw new Error(`Could not connect to ${this.endpoint}`);
    const result = await browser.newPage();
    if (!result) throw new Error(`could not get page from ${this.endpoint}`);
    const currentPages = await browser.pages();
    if (currentPages.length > this.maxPages) {
      currentPages[0]?.close();
    }
    return result;
  }
}

export namespace Renderer {
  export interface OutputTypeMap {
    base64: string;
    binary: Buffer;
  }

  export type Output<T extends OutputType> = OutputTypeMap[T];
  export type OutputType = keyof OutputTypeMap;

  export interface Options<T extends OutputType> extends ScreenshotOptions {
    encoding: T;
    viewport?: Viewport;
    waitFor?: WaitForOptions;
  }
}
