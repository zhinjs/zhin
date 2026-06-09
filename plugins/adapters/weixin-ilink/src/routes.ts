/**
 * weixin-ilink HTTP 路由
 */
import type { Router } from "@zhin.js/host-router";
import type { Plugin } from "zhin.js";
import type { WeixinIlinkAdapter } from "./adapter.js";
import { registerLoginAssistRoutes } from "./login-assist-routes.js";

export function registerRoutes(
  router: Router,
  adapter: WeixinIlinkAdapter,
  root: Plugin,
): void {
  registerLoginAssistRoutes(router, root);

  router.get("/api/weixin-ilink/bots", async (ctx) => {
    try {
      const bots = Array.from(adapter.bots.values());
      const data = bots.map((bot) => ({
        name: bot.$config.name,
        connected: bot.$connected,
        status: bot.$connected ? "online" : "offline",
        hasCredentials: Boolean(bot.hasCredentials),
      }));
      ctx.body = {
        success: true,
        data,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: "WEIXIN_ILINK_API_ERROR",
        message: (error as Error).message,
      };
    }
  });
}
