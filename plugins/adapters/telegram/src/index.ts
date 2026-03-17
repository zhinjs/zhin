/**
 * Telegram 适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin, type Context } from "zhin.js";
import { TelegramAdapter } from "./adapter.js";

declare module "zhin.js" {
  interface Adapters {
    telegram: TelegramAdapter;
  }
}

export * from "./types.js";
export { TelegramBot } from "./bot.js";
export { TelegramAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide } = plugin;

provide({
  name: "telegram",
  description: "Telegram Bot Adapter",
  mounted: async (p: Plugin) => {
    const adapter = new TelegramAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: TelegramAdapter) => {
    await adapter.stop();
  },
} as Context<"telegram">);
