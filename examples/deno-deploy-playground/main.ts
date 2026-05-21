import { zhinReady } from "./src/runtime/bootstrap.ts";
import { handleRequest } from "./src/server.ts";

const port = Number(Deno.env.get("PORT") ?? "8000");
const hostname = Deno.env.get("HOSTNAME") ?? "0.0.0.0";

await zhinReady;

Deno.serve({ port, hostname, onListen({ hostname: h, port: p }) {
  console.log(`[Zhin:playground] http://${h}:${p} (zhin.js runtime)`);
}}, handleRequest);
