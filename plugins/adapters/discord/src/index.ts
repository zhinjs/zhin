/**
 * Discord 适配器入口：单一适配器，支持 Gateway / Interactions（connection: gateway | interactions）
 */
import { usePlugin, type Plugin, type Context } from "zhin.js";
import type { Router } from "@zhin.js/http";
import { DiscordAdapter } from "./adapter.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      router: import("@zhin.js/http").Router;
    }
  }
  interface Adapters {
    discord: DiscordAdapter;
  }
}

export * from "./types.js";
export { DiscordBot } from "./bot.js";
export { DiscordInteractionsBot } from "./bot-interactions.js";
export { DiscordAdapter, type DiscordBotLike } from "./adapter.js";

const { provide } = usePlugin();
provide({
  name: "discord",
  description: "Discord 适配器（Gateway / Interactions）",
  mounted: async (p: Plugin) => {
    const adapter = new DiscordAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: DiscordAdapter) => {
    await adapter.stop();
  },
} as unknown as Context<"discord">);
