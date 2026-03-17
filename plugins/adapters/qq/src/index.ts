/**
 * QQ 官方适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin } from "zhin.js";
import { QQAdapter } from "./adapter.js";

declare module "zhin.js" {
  interface Adapters {
    qq: QQAdapter;
  }
}

export * from "./types.js";
export { QQBot } from "./bot.js";
export { QQAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide } = plugin;

provide({
  name: "qq",
  description: "QQ Official Bot Adapter",
  mounted: async (p: Plugin) => {
    const adapter = new QQAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: QQAdapter) => {
    await adapter.stop();
  },
});
