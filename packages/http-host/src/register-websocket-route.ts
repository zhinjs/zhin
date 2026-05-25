import type { RouteTable } from "./route-table.js";
import { registerFetchRoute } from "./register-fetch-route.js";
import type { RouterContext } from "./router-context.js";

export type WebSocketConnectHandler = (ws: unknown, req: Request) => void;

type DenoUpgrade = {
  upgradeWebSocket: (req: Request) => { socket: WebSocket; response: Response };
};

/**
 * Fetch 路由表上的 WebSocket upgrade（Deno / Deno Deploy）。
 * Node Host 长连接请继续用 compat {@link Router}.ws。
 */
export function registerWebSocketRoute(
  table: RouteTable,
  path: string,
  onConnect: WebSocketConnectHandler,
): void {
  registerFetchRoute(table, "GET", path, (ctx: RouterContext) => {
    if (ctx.get("upgrade")?.toLowerCase() !== "websocket") {
      ctx.status = 426;
      ctx.body = "Expected WebSocket";
      return;
    }
    const deno = (globalThis as { Deno?: DenoUpgrade }).Deno;
    if (!deno?.upgradeWebSocket) {
      ctx.status = 501;
      ctx.body = {
        success: false,
        error: "WebSocket upgrade requires Deno.upgradeWebSocket or Node Router.ws",
      };
      return;
    }
    const { socket, response } = deno.upgradeWebSocket(ctx.req);
    const runConnect = () => onConnect(socket, ctx.req);
    if (socket.readyState === WebSocket.OPEN) {
      runConnect();
    } else {
      socket.addEventListener("open", runConnect, { once: true });
    }
    ctx.body = response;
  });
}
