import type { RouteTable, RouterContext } from "@zhin.js/http-host";
import { subscribeSse } from "./sse-hub.js";
import type { ConsoleApiOptions } from "./console-api-types.js";
import {
  buildConsoleRpcContext,
  dispatchConsoleRpc,
  pickRpcReply,
} from "./rpc/dispatch.js";
import type { ConsoleWebServer } from "./websocket.js";

export type { ConsoleApiOptions } from "./console-api-types.js";

export function registerConsoleRoutes(
  table: RouteTable,
  base: string,
  getWebServer: () => ConsoleWebServer,
  options: ConsoleApiOptions = {},
): void {
  const apiBase = `${base}/console`;

  table.post(`${apiBase}/request`, async (ctx: RouterContext) => {
    const message = (ctx.request.body ?? {}) as Record<string, unknown>;

    try {
      const payloads = await dispatchConsoleRpc(message, getWebServer, options);
      const match = pickRpcReply(message, payloads);
      if (!match) {
        ctx.status = 500;
        ctx.body = { success: false, error: "No response" };
        return;
      }
      if (match.error) {
        ctx.status = 400;
        ctx.body = { success: false, error: match.error, requestId: match.requestId };
        return;
      }
      ctx.body = { success: true, data: match.data, requestId: match.requestId };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: (err as Error).message };
    }
  });

  table.get(`${base}/events`, async (ctx: RouterContext) => {
    const webServer = getWebServer();
    const entries = Object.values(webServer.entries ?? {});
    const lastEventId = ctx.query["last-event-id"] ?? ctx.query.lastEventId;
    const { stream } = subscribeSse(
      [
        { type: "sync", data: { key: "entries", value: entries } },
        { type: "init-data", timestamp: Date.now() },
      ],
      lastEventId,
    );
    ctx.status = 200;
    ctx.set("Content-Type", "text/event-stream; charset=utf-8");
    ctx.set("Cache-Control", "no-cache, no-transform");
    ctx.set("Connection", "keep-alive");
    ctx.set("X-Accel-Buffering", "no");
    ctx.body = stream;
  });
}

export function registerConsoleApi(
  router: { table: RouteTable },
  base: string,
  getWebServer: () => ConsoleWebServer,
  options?: ConsoleApiOptions,
): void {
  registerConsoleRoutes(router.table, base, getWebServer, options);
}
