/**
 * 微信 iLink（ClawBot）适配器入口
 */
import path from "node:path";
import { usePlugin, type Plugin } from "zhin.js";
import type { Router } from "@zhin.js/host-router";
import { PageManager } from "@zhin.js/host-api";
import { WeixinIlinkAdapter } from "./adapter.js";
import { registerRoutes } from "./routes.js";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      web: PageManager;
      router: Router;
    }
  }
  interface Adapters {
    "weixin-ilink": WeixinIlinkAdapter;
  }
}

export * from "./types.js";
export { WeixinIlinkEndpoint } from "./endpoint.js";
export { WeixinIlinkAdapter } from "./adapter.js";
export {
  WeixinIlinkTypingIndicatorManager,
  enableTypingIndicator,
  type WeixinIlinkTypingIndicatorConfig,
} from "./typing-indicator.js";
export { registerLoginAssistRoutes } from "./login-assist-routes.js";

const plugin = usePlugin();
const { provide, useContext, root } = plugin;

provide({
  name: "weixin-ilink",
  description: "WeChat personal account via Tencent iLink Endpoint API (ClawBot)",
  mounted: async (p: Plugin) => {
    const adapter = new WeixinIlinkAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: WeixinIlinkAdapter) => {
    await adapter.stop();
  },
} as any);

useContext("web", (pageManager) => {
  pageManager.addEntry({
    id: "weixin-ilink",
    development: path.resolve(import.meta.dirname, "../client/index.tsx"),
    production: path.resolve(import.meta.dirname, "../dist/index.js"),
    meta: { name: "微信 iLink" },
  });
});

useContext("router", "weixin-ilink", async (router: Router, adapter: WeixinIlinkAdapter) => {
  registerRoutes(router, adapter, root);
});
