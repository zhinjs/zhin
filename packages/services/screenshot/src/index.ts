import { Plugin } from 'zhin';
import { Renderer } from '@/renderer';
import htmlRenderer from '@/adapters/htmlRenderer';
import vueRenderer from '@/adapters/vueRenderer';
declare module 'zhin' {
  namespace App {
    interface Services {
      renderHtml<T extends Renderer.OutputType>(input: string, options: Renderer.Options<T>): Renderer.Output<T>;
      renderVue<T extends Renderer.OutputType>(input: string, options: Renderer.Options<T>): Renderer.Output<T>;
    }
  }
}
const plugin = new Plugin('绘图工具');
plugin.service('renderHtml', htmlRenderer.rendering);
plugin.service('renderVue', vueRenderer.rendering);
plugin.mounted(() => {
  htmlRenderer.connect();
  vueRenderer.connect();
});
export default plugin;
