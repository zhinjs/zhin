import { createSSRApp, Component } from 'vue';
import { renderToString } from '@vue/server-renderer';
import register from './register';
import { Renderer } from '@/renderer';
import htmlRenderer from '@/adapters/htmlRenderer';

export class VueRenderer extends Renderer {
  constructor(endpoint: string = process.env.ENDPOINT || '') {
    super(endpoint);
    register();
  }

  async rendering<T extends Renderer.OutputType>(
    input: Component,
    options: VueRenderer.Options<T>,
  ): Promise<Renderer.Output<T>> {
    const app = createSSRApp(input, options.props);
    if (options.components) {
      for (const component of options.components) {
        if (!component.name) continue;
        app.component(component.name, component);
      }
    }
    const html = await renderToString(app);
    const entryHTMLContent = `<!DOCTYPE html>
    <html>
    <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>${Reflect.get(input, '__CSS__')}</style>
    </head>
    <body>
    ${html}
    </body>
    </html>
    `;
    return await htmlRenderer.rendering(entryHTMLContent, options);
  }
}

export namespace VueRenderer {
  export interface Options<T extends Renderer.OutputType> extends Renderer.Options<T> {
    props?: Record<string, any>;
    components?: Component[];
  }
}
export default new VueRenderer();
