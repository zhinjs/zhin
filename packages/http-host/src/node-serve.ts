import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type ServeOptions = {
  host?: string;
  port: number;
  fetch: (req: Request) => Promise<Response>;
};

function nodeRequestToWebRequest(req: import("node:http").IncomingMessage): Request {
  const host = req.headers.host ?? "localhost";
  const url = `http://${host}${req.url ?? "/"}`;
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  if (method === "GET" || method === "HEAD") {
    return new Request(url, { method, headers });
  }
  return new Request(url, {
    method,
    headers,
    body: req as unknown as BodyInit,
    duplex: "half",
  } as RequestInit);
}

import { writeWebResponse } from "./node-response.js";
import { INTERNAL_ERROR_JSON } from "./safe-json-error.js";

export function serveFetch(options: ServeOptions): Server {
  const server = createServer(async (nodeReq, nodeRes) => {
    try {
      const webReq = nodeRequestToWebRequest(nodeReq);
      const webRes = await options.fetch(webReq);
      await writeWebResponse(nodeRes, webRes);
    } catch (err) {
      nodeRes.statusCode = 500;
      nodeRes.end(INTERNAL_ERROR_JSON);
    }
  });
  server.listen(options.port, options.host ?? "127.0.0.1");
  return server;
}

export function getListenAddress(server: Server): AddressInfo | null {
  const addr = server.address();
  if (addr && typeof addr === "object") return addr;
  return null;
}
