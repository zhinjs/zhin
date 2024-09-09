import { createSSRApp, Component } from 'vue';
import { renderToString, SSRContext } from '@vue/server-renderer';
import register from './register';
import { Renderer } from '@/renderer';
import htmlRenderer from '@/adapters/htmlRenderer';
export type IComponent = Component & { __CSS__?: string[]; children?: IComponent[] };
function getCss(component: IComponent): string {
  let result: string = '';
  if (component.__CSS__) {
    result = component.__CSS__.join('\n');
  }
  return `<style>${result}\n${component.children?.map(getCss).join('\n')}</style>`;
}
export class VueRenderer extends Renderer {
  constructor(endpoint: string = process.env.ENDPOINT || '') {
    super(endpoint);
    register();
  }

  async rendering<T extends Renderer.OutputType>(
    input: IComponent,
    options: VueRenderer.Options<T>,
  ): Promise<Renderer.Output<T>> {
    const app = createSSRApp(input, options.props);
    const css = getCss(input);
    if (options.components) {
      for (const component of options.components) {
        if (!component.name) continue;
        app.component(component.name, component);
      }
    }
    const ctx: SSRContext = {};
    const html = await renderToString(app, ctx);
    const entryHTMLContent = `<!DOCTYPE html>
    <html>
    <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${css}
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
