import { createSSRApp, Component, ExtractPropTypes } from 'vue';
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
  constructor() {
    super('vue');
    register();
  }

  async rendering<T extends Renderer.OutputType, C extends Component>(
    input: C,
    options: VueRenderer.Options<T, C>,
  ): Promise<Renderer.Output<T>> {
    const app = createSSRApp(input, options.props as any);
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
  export type InferComponentProps<C> = C extends Component<infer P>
    ? Omit<ExtractPropTypes<P>, '$el'>
    : Record<string, any>;
  export interface Options<T extends Renderer.OutputType, C extends Component> extends Renderer.Options<T> {
    props?: InferComponentProps<C>;
    components?: Component[];
  }
}
export default new VueRenderer();
