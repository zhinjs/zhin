/**
 * 全局扩充 @zhin.js/core 的 Plugin.Contexts（无顶层 import/export）。
 * 适配器构建时在入口添加：`import 'zhin.js/contexts'`
 *
 * router / web / server 由 @zhin.js/host-router、@zhin.js/host-api 安装后 augment。
 * ai / agent 由 @zhin.js/agent 安装后 augment。
 */
declare module '@zhin.js/core' {
  namespace Plugin {
    interface Contexts {
      ai: import('@zhin.js/agent').AIService;
      'html-renderer': import('@zhin.js/html-renderer').HtmlRendererService;
    }
  }
}
