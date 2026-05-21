import {
  getPlaygroundConfigPath,
  getPlaygroundEdgeConfig,
  getPlaygroundHttpConfig,
  getPlaygroundAdapter,
  zhinReady,
} from "./runtime/bootstrap.ts";
import { createEdgeHttpApp } from "./edge-http.ts";

const INDEX_URL = new URL("../static/index.html", import.meta.url);

let edgeApp: ReturnType<typeof createEdgeHttpApp> | null = null;

function getEdgeApp() {
  if (!edgeApp) {
    const http = getPlaygroundHttpConfig();
    edgeApp = createEdgeHttpApp({ ...http, edge: getPlaygroundEdgeConfig() });
  }
  return edgeApp;
}

export function handleRequest(req: Request): Response | Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "GET" && url.pathname === "/api/info") {
    const http = getPlaygroundHttpConfig();
    const apiBase = `${url.origin}${http.base}`;
    return Response.json({
      name: "Zhin Edge Playground",
      config: getPlaygroundConfigPath(),
      stack: ["zhin.js", "@zhin.js/core", "@zhin.js/agent", "MessageDispatcher", "MessageCommand"],
      websocket: `${url.origin}/ws`,
      apiBase: url.origin,
      openapi: `${url.origin}/pub/openapi.json`,
      health: `${url.origin}/pub/health`,
      consoleApi: `${apiBase}/console/request`,
      events: `${apiBase}/events`,
      queueIncoming: `${apiBase}/queue/incoming`,
      docs: "https://docs.deno.com/deploy/getting_started/",
    });
  }

  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/pub/") ||
    url.pathname === "/entries"
  ) {
    return getEdgeApp().fetch(req);
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return Deno.readTextFile(INDEX_URL).then(
      (html) => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }),
    );
  }

  if (url.pathname === "/ws") {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    return zhinReady.then(() => {
      const { socket, response } = Deno.upgradeWebSocket(req);
      getPlaygroundAdapter().acceptSocket(socket);
      return response;
    });
  }

  return new Response("Not Found", { status: 404 });
}
