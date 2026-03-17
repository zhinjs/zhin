/**
 * Slack 适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin } from "zhin.js";
import { SlackAdapter } from "./adapter.js";

declare module "zhin.js" {
  interface Adapters {
    slack: SlackAdapter;
  }
}

export * from "./types.js";
export { SlackBot } from "./bot.js";
export { SlackAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide } = plugin;

provide({
  name: "slack",
  description: "Slack Bot Adapter",
  mounted: async (p: Plugin) => {
    const adapter = new SlackAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: SlackAdapter) => {
    await adapter.stop();
  },
});
