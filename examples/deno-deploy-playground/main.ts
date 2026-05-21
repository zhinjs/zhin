import { zhinReady, getPlaygroundHttpConfig } from "./src/runtime/bootstrap.ts";
import { logEdgeHttpListen } from "./src/edge-listen-log.ts";
import { handleRequest } from "./src/server.ts";

await zhinReady;

const http = getPlaygroundHttpConfig();

Deno.serve({
  port: http.port,
  hostname: http.host,
  onListen({ hostname: h, port: p }) {
    logEdgeHttpListen({
      host: h,
      port: p,
      base: http.base,
      token: http.token,
    });
  },
}, handleRequest);
