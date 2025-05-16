import { Renderer } from '@/renderer';
import { htmlToBuffer} from 'img-generator';
export class HtmlRenderer extends Renderer {
  constructor() {
    super('html');
  }
  async rendering<T extends Renderer.OutputType>(
    input: string,
    {encoding,...options}: Renderer.Options<T>,
  ): Promise<Renderer.Output<T>> {
    const buffer = await htmlToBuffer(input, options);
    if(encoding === 'binary'){
      return buffer as Renderer.Output<T>;
    }
    return buffer.toString('base64') as Renderer.Output<T>;
  }
}
export default new HtmlRenderer();
