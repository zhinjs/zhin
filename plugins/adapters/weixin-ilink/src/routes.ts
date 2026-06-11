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

  router.get("/api/weixin-ilink/endpoints", async (ctx) => {
    try {
      const endpoints = Array.from(adapter.endpoints.values());
      const data = endpoints.map((endpoint) => ({
        name: endpoint.$config.name,
        connected: endpoint.$connected,
        status: endpoint.$connected ? "online" : "offline",
        hasCredentials: Boolean(endpoint.hasCredentials),
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
