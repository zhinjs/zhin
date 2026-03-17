/**
 * 钉钉适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin } from "zhin.js";
import { DingTalkAdapter } from "./adapter.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      router: import("@zhin.js/http").Router;
    }
  }
  interface Adapters {
    dingtalk: DingTalkAdapter;
  }
}

export * from "./types.js";
export { DingTalkBot } from "./bot.js";
export { DingTalkAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext } = plugin;

useContext("router", (router: any) => {
  provide({
    name: "dingtalk",
    description: "DingTalk Bot Adapter",
    mounted: async (p: Plugin) => {
      const adapter = new DingTalkAdapter(p, router);
      await adapter.start();
      return adapter;
    },
    dispose: async (adapter: DingTalkAdapter) => {
      await adapter.stop();
    },
  });
});
