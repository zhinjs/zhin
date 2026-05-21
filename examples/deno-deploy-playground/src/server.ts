import { getPlaygroundAdapter, zhinReady } from "./runtime/bootstrap.ts";

const INDEX_URL = new URL("../static/index.html", import.meta.url);

export function handleRequest(req: Request): Response | Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true, runtime: "zhin.js" });
  }

  if (req.method === "GET" && url.pathname === "/api/info") {
    return Response.json({
      name: "Zhin Edge Playground",
      stack: ["zhin.js", "@zhin.js/core", "@zhin.js/agent", "MessageDispatcher", "MessageCommand"],
      websocket: "/ws",
      consoleApi: "Use Remote Console (GitHub Pages) with API Base pointing at Zhin Host; Edge REST/SSE subset planned.",
      docs: "https://docs.deno.com/deploy/getting_started/",
    });
  }

  if (url.pathname === "/api/events" || url.pathname === "/api/console/request") {
    return Response.json(
      {
        error: "Console REST/SSE runs on Zhin Host; point Remote Console API Base to your Host (see docs/console-remote.md).",
      },
      { status: 501 },
    );
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
