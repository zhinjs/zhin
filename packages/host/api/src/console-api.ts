import { firstQuery, getAuthScope, type Router, type RouterContext } from "@zhin.js/host-router/router";
import { Readable } from "node:stream";
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
  router: Router,
  base: string,
  getWebServer: () => ConsoleWebServer,
  options: ConsoleApiOptions = {},
): void {
  const apiBase = `${base}/console`;

  router.post(`${apiBase}/request`, async (ctx: RouterContext) => {
    const message = (ctx.request.body ?? {}) as Record<string, unknown>;
    const authScope = getAuthScope(ctx);

    try {
      const payloads = await dispatchConsoleRpc(message, getWebServer, {
        ...options,
        authScope,
      });
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

  router.get(`${base}/events`, async (ctx: RouterContext) => {
    const webServer = getWebServer();
    const entries = Object.values(webServer.entries ?? {});
    const lastEventId =
      firstQuery(ctx, "last-event-id") ?? firstQuery(ctx, "lastEventId");
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

    const body = Readable.fromWeb(
      stream as unknown as import("node:stream/web").ReadableStream,
    );
    const onClientClose = () => {
      if (!body.destroyed) body.destroy();
    };
    ctx.req.once("close", onClientClose);
    body.once("close", () => {
      ctx.req.off("close", onClientClose);
    });
    body.on("error", () => {
      /* pipeline 在客户端断开时可能报错；destroy 会触发 sse-hub cancel */
    });
    ctx.body = body;
  });
}

export function registerConsoleApi(
  router: Router,
  base: string,
  getWebServer: () => ConsoleWebServer,
  options?: ConsoleApiOptions,
): void {
  registerConsoleRoutes(router, base, getWebServer, options);
}
