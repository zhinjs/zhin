import { Renderer } from '@/renderer';
import { axios } from 'zhin';
import puppeteer, { Browser } from 'puppeteer-core';
export class HtmlRenderer extends Renderer {
  private browser: Browser | null = null;
  private maxPages: number = Number(process.env.MAX_PAGES || 10);
  constructor(private endpoint: string = process.env.ENDPOINT || '') {
    super('html');
  }
  async connect() {
    return new Promise<Browser | null>(async resolve => {
      if (this.browser) return resolve(this.browser);
      if (this.endpoint.startsWith('http')) this.endpoint = await this.getEndpointByURL(this.endpoint);
      this.browser = await puppeteer.connect({
        browserWSEndpoint: this.endpoint,
      });
      console.log('connected to', this.endpoint);
      return resolve(this.browser);
    });
  }
  async getPage() {
    const browser = await this.connect();
    if (!browser) throw new Error(`Could not connect to ${this.endpoint}`);
    browser.on('disconnected', () => {
      console.log('disconnected');
      this.browser = null;
    });
    const ctx = await browser.createBrowserContext();
    const result = await ctx.newPage();
    if (!result) throw new Error(`could not get page from ${this.endpoint}`);
    const currentPages = await browser.pages();
    if (currentPages.length > this.maxPages) {
      currentPages[0]?.close();
    }
    return result;
  }
  private async getEndpointByURL(endpoint: string) {
    const url = new URL(endpoint);
    const result = await axios.get(`${url.origin}/json/version`);
    if (!result?.data) throw new Error('getEndpoint failed');
    return result.data?.webSocketDebuggerUrl as string;
  }
  async rendering<T extends Renderer.OutputType>(
    input: string,
    options: Renderer.Options<T>,
  ): Promise<Renderer.Output<T>> {
    const page = await this.getPage();
    if (options.viewport) await page.setViewport(options.viewport);
    await page.setContent(input, options.waitFor);
    const result = await page.screenshot(options);
    page.close();
    return result as Renderer.Output<T>;
  }
}
export default new HtmlRenderer();
