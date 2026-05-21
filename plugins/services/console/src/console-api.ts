import type { Router } from "@zhin.js/http";
import type { RouterContext } from "@zhin.js/http-host";
import { handleWebSocketMessage, type WebServerCompat } from "./websocket.js";
import { subscribeSse } from "./sse-hub.js";
import type WebSocket from "ws";

export function registerConsoleApi(
  router: Router,
  base: string,
  getWebServer: () => WebServerCompat,
): void {
  const apiBase = `${base}/console`;

  router.post(`${apiBase}/request`, async (ctx: RouterContext) => {
    const message = (ctx.request.body ?? {}) as Record<string, unknown>;
    const payloads: Record<string, unknown>[] = [];
    const fakeWs = {
      send(data: string) {
        try {
          payloads.push(JSON.parse(data) as Record<string, unknown>);
        } catch {
          payloads.push({ error: "invalid json response" });
        }
      },
      readyState: 1,
    } as unknown as WebSocket;

    try {
      await handleWebSocketMessage(fakeWs, message, getWebServer());
      const rid = message.requestId as number | undefined;
      const match =
        (rid != null && payloads.find((p) => p.requestId === rid)) ??
        payloads[payloads.length - 1];
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
    const { stream } = subscribeSse([
      { type: "sync", data: { key: "entries", value: entries } },
      { type: "init-data", timestamp: Date.now() },
    ]);
    ctx.status = 200;
    ctx.set("Content-Type", "text/event-stream; charset=utf-8");
    ctx.set("Cache-Control", "no-cache, no-transform");
    ctx.set("Connection", "keep-alive");
    ctx.set("X-Accel-Buffering", "no");
    ctx.body = stream;
  });
}
