import { registerWebSocketRoute, type RouteTable } from "@zhin.js/http-host/edge";
import type { SandboxWsHostAdapter, SandboxWsSocket } from "./sandbox-ws.js";

export type RegisterSandboxWsOptions = {
  /** 兼容旧路径，默认 `/ws` */
  legacyPaths?: string[];
};

/**
 * Deno / Edge：在 {@link RouteTable} 上注册 `/sandbox` WebSocket（http-host Fetch upgrade）。
 */
export function registerSandboxWebSocketRoutes(
  table: RouteTable,
  getAdapter: () => SandboxWsHostAdapter,
  options: RegisterSandboxWsOptions = {},
): void {
  const paths = ["/sandbox", ...(options.legacyPaths ?? ["/ws"])];
  for (const path of paths) {
    registerWebSocketRoute(table, path, (ws: unknown) => {
      getAdapter().acceptWebSocket(ws as SandboxWsSocket);
    });
  }
}
