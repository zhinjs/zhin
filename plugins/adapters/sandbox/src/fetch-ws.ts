import { registerWebSocketRoute, type RouteTable } from "@zhin.js/http-host";
import type { SandboxWsHostAdapter, SandboxWsSocket } from "./sandbox-ws.js";

/**
 * 在 {@link RouteTable} 上注册 `/sandbox` WebSocket。
 */
export function registerSandboxWebSocketRoutes(
  table: RouteTable,
  getAdapter: () => SandboxWsHostAdapter,
): void {
  registerWebSocketRoute(table, "/sandbox", (ws: unknown) => {
    getAdapter().acceptWebSocket(ws as SandboxWsSocket);
  });
}
