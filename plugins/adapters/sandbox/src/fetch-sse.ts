import { registerFetchRoute, type RouteTable } from "@zhin.js/http-host/edge";
import type { RouterContext } from "@zhin.js/http-host/edge";
import type { SandboxWsHostAdapter } from "./sandbox-ws.js";
import { subscribeSandboxSse } from "./sandbox-sse-hub.js";

export type RegisterSandboxSseOptions = {
  eventsPath?: string;
  messagePath?: string;
};

function resolveSessionId(ctx: RouterContext): string | undefined {
  const q = ctx.query.session?.trim();
  if (q) return q;
  const h = ctx.get("x-sandbox-session")?.trim();
  if (h) return h;
  const body = ctx.request.body as { session?: string } | undefined;
  if (body && typeof body.session === "string" && body.session.trim()) {
    return body.session.trim();
  }
  return undefined;
}

/**
 * Edge / Vercel 等：Sandbox 使用 HTTP POST 上行 + SSE 下行（无 WebSocket upgrade）。
 */
export function registerSandboxSseRoutes(
  table: RouteTable,
  getAdapter: () => SandboxWsHostAdapter,
  options: RegisterSandboxSseOptions = {},
): void {
  const eventsPath = options.eventsPath ?? "/sandbox/events";
  const messagePath = options.messagePath ?? "/sandbox/message";

  registerFetchRoute(table, "GET", eventsPath, (ctx: RouterContext) => {
    const sessionId = resolveSessionId(ctx);
    if (!sessionId) {
      ctx.status = 400;
      ctx.body = { success: false, error: "Missing session (query ?session= or X-Sandbox-Session)" };
      return;
    }
    const adapter = getAdapter();
    if (!adapter.hasSseSession(sessionId)) {
      adapter.acceptSseSession(sessionId);
    }
    const lastEventId = ctx.query["last-event-id"] ?? ctx.query.lastEventId;
    const stream = subscribeSandboxSse(sessionId, lastEventId);
    ctx.status = 200;
    ctx.set("Content-Type", "text/event-stream; charset=utf-8");
    ctx.set("Cache-Control", "no-cache, no-transform");
    ctx.set("Connection", "keep-alive");
    ctx.set("X-Accel-Buffering", "no");
    ctx.body = stream;
  });

  registerFetchRoute(table, "POST", messagePath, async (ctx: RouterContext) => {
    const sessionId = resolveSessionId(ctx);
    if (!sessionId) {
      ctx.status = 400;
      ctx.body = { success: false, error: "Missing session (X-Sandbox-Session or body.session)" };
      return;
    }
    const adapter = getAdapter();
    if (!adapter.hasSseSession(sessionId)) {
      ctx.status = 404;
      ctx.body = { success: false, error: "No sandbox session; open GET /sandbox/events first" };
      return;
    }
    const body = ctx.request.body;
    const raw = typeof body === "string"
      ? body
      : body === undefined || body === null
      ? ""
      : JSON.stringify(body);
    if (!raw) {
      ctx.status = 400;
      ctx.body = { success: false, error: "Empty message body" };
      return;
    }
    try {
      adapter.ingestSseClientMessage(sessionId, raw);
      ctx.body = { success: true };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: (err as Error).message };
    }
  });
}
