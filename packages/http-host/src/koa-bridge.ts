import type Koa from "koa";
import http from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

function incomingMessageToResponse(msg: IncomingMessage): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(msg.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  const body = msg.readable
    ? (Readable.toWeb(msg) as ReadableStream<Uint8Array>)
    : null;
  return new Response(body, {
    status: msg.statusCode ?? 502,
    statusText: msg.statusMessage,
    headers,
  });
}

function proxyToSidecar(port: number, webReq: Request): Promise<Response> {
  return new Promise((resolve, reject) => {
    const url = new URL(webReq.url);
    const headers: http.OutgoingHttpHeaders = {};
    webReq.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const proxyReq = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: `${url.pathname}${url.search}`,
        method: webReq.method,
        headers,
      },
      (proxyRes) => resolve(incomingMessageToResponse(proxyRes)),
    );

    proxyReq.on("error", reject);

    const hasBody =
      webReq.method !== "GET" &&
      webReq.method !== "HEAD" &&
      webReq.body != null;

    if (hasBody) {
      Readable.fromWeb(webReq.body as import("node:stream/web").ReadableStream)
        .on("error", reject)
        .pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  });
}

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

/** Close the loopback sidecar for a Koa app (tests / graceful shutdown). */
export function closeKoaSidecar(koa: Koa): Promise<void> {
  const entry = sidecars.get(koa);
  if (!entry) return Promise.resolve();
  sidecars.delete(koa);
  return new Promise((resolve, reject) => {
    entry.server.close((err) => (err ? reject(err) : resolve()));
  });
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
    return proxyToSidecar(port, webReq);
  };
}
