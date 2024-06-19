import { Renderer } from '@/renderer';
import htmlRenderer from '@/adapters/htmlRenderer';

export class VueRenderer extends Renderer {
  constructor(endpoint: string = process.env.ENDPOINT) {
    super(endpoint);
  }
  rendering<T extends Renderer.OutputType>(input: string, options: Renderer.Options<T>): Renderer.Output<T> {
    return htmlRenderer.rendering('', {
      encoding: 'base64',
    });
  }
}
export default new VueRenderer();
