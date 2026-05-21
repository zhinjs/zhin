import Koa from "koa";
import serve from "koa-static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { koaFallback } from "../src/koa-bridge.js";

const dist = path.resolve(
  fileURLToPath(import.meta.url),
  "../../../console-app/dist",
);

describe("koaFallback static", () => {
  it("serves large files concurrently", async () => {
    const koa = new Koa();
    koa.use(serve(dist, { index: false }));
    const fetch = koaFallback(koa);
    const files = [
      "index_319b.4d093ef0.js",
      "index_b78b.8c7cd22f.css",
      "index_5fc0.2bb5f276.js",
    ];
    const results = await Promise.all(
      files.map(async (f) => {
        const res = await fetch(new Request(`http://localhost/${f}`));
        const buf = await res.arrayBuffer();
        return { f, status: res.status, bytes: buf.byteLength };
      }),
    );
    for (const r of results) {
      expect(r.status).toBe(200);
      expect(r.bytes).toBeGreaterThan(100_000);
    }
  });
});
