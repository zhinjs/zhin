/**
 * 无 Wrangler 时的本地 Edge 模拟：Node HTTP → bootstrapCloudflare.fetch
 */
import { config as loadEnv } from "dotenv";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const playgroundRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(playgroundRoot, ".env") });

const port = Number(process.env.EDGE_DEV_PORT ?? 8002);
const host = process.env.HOST ?? "127.0.0.1";
process.chdir(playgroundRoot);

const { bootstrapCloudflare } = await import("zhin.js/cloudflare");
const assets = await import(path.join(playgroundRoot, "src/edge-console-assets.ts"));

const { fetch } = await bootstrapCloudflare({
  projectRoot: playgroundRoot,
  getConsoleEntriesRecord: assets.getEdgeConsoleEntriesRecord,
  registerAssetRoutes: assets.registerEdgeConsoleAssetRoutes,
});

function nodeHeadersToHeaders(raw) {
  const h = new Headers();
  for (const [k, v] of Object.entries(raw)) {
    if (v == null) continue;
    if (Array.isArray(v)) for (const item of v) h.append(k, item);
    else h.set(k, v);
  }
  return h;
}

async function sendFetchResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "transfer-encoding") return;
    res.setHeader(key, value);
  });
  if (response.body) {
    await pipeline(Readable.fromWeb(response.body), res);
  } else {
    res.end();
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(url, {
      method: req.method,
      headers: nodeHeadersToHeaders(req.headers),
      body: body && req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
    });
    await sendFetchResponse(res, await fetch(request));
  } catch (err) {
    console.error("[local-fetch-server]", err);
    res.statusCode = 500;
    res.end(String(err));
  }
});

server.listen(port, host, () => {
  console.log(`[Zhin:cf-local] http://${host}:${port}/ (pub/health, sandbox-ui)`);
});
