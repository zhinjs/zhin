import type Koa from "koa";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Sidecar = {
  server: http.Server;
  port: Promise<number>;
};

const sidecars = new WeakMap<Koa, Sidecar>();

function ensureSidecar(koa: Koa): Promise<number> {
  let entry = sidecars.get(koa);
  if (!entry) {
    const server = http.createServer(koa.callback());
    const port = new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("koa sidecar: invalid listen address"));
          return;
        }
        resolve((addr as AddressInfo).port);
      });
    });
    entry = { server, port };
    sidecars.set(koa, entry);
  }
  return entry.port;
}

/**
 * Delegate unmatched requests to a Koa app via a loopback sidecar server.
 *
 * Detached `ServerResponse` instances stall streamed bodies (~64 KiB backpressure);
 * proxying through a real socket avoids hung static assets under concurrent load.
 */
export function koaFallback(koa: Koa): (req: Request) => Promise<Response> {
  return async (webReq: Request) => {
    const port = await ensureSidecar(koa);
    const url = new URL(webReq.url);
    const target = `http://127.0.0.1:${port}${url.pathname}${url.search}`;
    const headers = new Headers(webReq.headers);
    const init: RequestInit = { method: webReq.method, headers, redirect: "manual" };
    if (webReq.method !== "GET" && webReq.method !== "HEAD" && webReq.body) {
      init.body = webReq.body;
      (init as RequestInit & { duplex: string }).duplex = "half";
    }
    return fetch(target, init);
  };
}
