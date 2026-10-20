/**
 * 全局扩充 @zhin.js/core 的 Plugin.Contexts（无顶层 import/export）。
 * 适配器构建时在入口添加：`import 'zhin.js/contexts'`
 *
 * ai / agent 由 @zhin.js/agent 安装后 augment。
 * （legacy host-router / host-api 插件栈已删除，不再有 router / web / server 增强。）
 */
declare module '@zhin.js/core' {
  namespace Plugin {
    interface Contexts {
      ai: import('@zhin.js/agent').AIService;
      'html-renderer': import('@zhin.js/html-renderer').HtmlRendererService;
    }
  }
}
