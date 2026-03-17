/**
 * 微信公众号适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin, type Context } from "zhin.js";
import type { Router } from "@zhin.js/http";
import { WeChatMPAdapter } from "./adapter.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      router: import("@zhin.js/http").Router;
    }
  }
  interface Adapters {
    "wechat-mp": WeChatMPAdapter;
  }
}

export * from "./types.js";
export { WeChatMPBot } from "./bot.js";
export { WeChatMPAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext } = plugin;

(useContext as (key: string, fn: (router: Router) => void) => void)("router", (router: Router) => {
  provide({
    name: "wechat-mp",
    description: "WeChat MP Bot Adapter",
    mounted: async (p: Plugin) => {
      const adapter = new WeChatMPAdapter(p, router);
      await adapter.start();
      return adapter;
    },
    dispose: async (adapter: WeChatMPAdapter) => {
      await adapter.stop();
    },
  } as Context<"wechat-mp">);
});
