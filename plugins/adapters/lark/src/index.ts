/**
 * 飞书/Lark 适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin, type Context } from "zhin.js";
import { LarkAdapter } from "./adapter.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      router: import("@zhin.js/http").Router;
    }
  }
  interface Adapters {
    lark: LarkAdapter;
  }
}

export * from "./types.js";
export { LarkBot } from "./bot.js";
export { LarkAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext } = plugin;

(useContext as (key: string, fn: (router: any) => void) => void)("router", (router) => {
  provide({
    name: "lark",
    description: "Lark/Feishu Bot Adapter",
    mounted: async (p: Plugin) => {
      const adapter = new LarkAdapter(p, router);
      await adapter.start();
      return adapter;
    },
    dispose: async (adapter: LarkAdapter) => {
      await adapter.stop();
    },
  } as Context<"lark">);
});
