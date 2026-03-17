/**
 * Email 适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin, type Context } from "zhin.js";
import { EmailAdapter } from "./adapter.js";

declare module "zhin.js" {
  interface Adapters {
    email: EmailAdapter;
  }
}

export * from "./types.js";
export { EmailBot } from "./bot.js";
export { EmailAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide } = plugin;

provide({
  name: "email",
  description: "Email Bot Adapter",
  mounted: async (p: Plugin) => {
    const adapter = new EmailAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: EmailAdapter) => {
    await adapter.stop();
  },
} as Context<"email">);
