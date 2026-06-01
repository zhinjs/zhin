import type { RouteTable } from "./route-table.js";
import { registerFetchRoute } from "./register-fetch-route.js";
import type { RouterContext } from "./router-context.js";

export type WebSocketConnectHandler = (ws: unknown, req: Request) => void;

/**
 * Node-only 模式下，Fetch 路由不支持 WebSocket upgrade。
 * 长连接请使用 `Router.ws()`。
 */
export function registerWebSocketRoute(
  table: RouteTable,
  path: string,
  _onConnect: WebSocketConnectHandler,
): void {
  registerFetchRoute(table, "GET", path, (ctx: RouterContext) => {
    if (ctx.get("upgrade")?.toLowerCase() !== "websocket") {
      ctx.status = 426;
      ctx.body = "Expected WebSocket";
      return;
    }
    ctx.status = 501;
    ctx.body = {
      success: false,
      error: "Node-only mode: WebSocket upgrade is not available on Fetch routes. Use Router.ws().",
    };
  });
}
