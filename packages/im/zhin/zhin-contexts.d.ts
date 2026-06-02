/**
 * 全局扩充 @zhin.js/core 的 Plugin.Contexts（无顶层 import/export）。
 * 适配器构建时在入口添加：`import 'zhin.js/contexts'`
 */
declare module '@zhin.js/core' {
  namespace Plugin {
    interface Contexts {
      router: import('@zhin.js/host-router').Router;
      server: import('node:http').Server;
      web: import('@zhin.js/host-api').PageManager;
      ai: import('@zhin.js/agent').AIService;
    }
  }
}
