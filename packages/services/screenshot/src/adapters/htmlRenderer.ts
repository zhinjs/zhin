import { Renderer } from '@/renderer';
export class HtmlRenderer extends Renderer {
  constructor(endpoint: string = process.env.ENDPOINT || '') {
    super('html', endpoint);
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
