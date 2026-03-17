/**
 * KOOK 适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin } from "zhin.js";
import { KookAdapter } from "./adapter.js";

declare module "zhin.js" {
  interface Adapters {
    kook: KookAdapter;
  }
}

export * from "./types.js";
export { KookBot } from "./bot.js";
export { KookAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide } = plugin;

provide({
  name: "kook",
  description: "KOOK Adapter",
  mounted: async (p: Plugin) => {
    const adapter = new KookAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: KookAdapter) => {
    await adapter.stop();
  },
});
