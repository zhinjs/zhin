import Koa from "koa";
import { Readable } from "node:stream";
import { afterEach, describe, it, expect, vi } from "vitest";
import { closeKoaSidecar, koaFallback } from "../src/koa-bridge.js";

describe("koaFallback", () => {
  const apps: Koa[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => closeKoaSidecar(app)));
  });

  it("resolves GET with string body", async () => {
    const koa = new Koa();
    apps.push(koa);
    koa.use(async (ctx) => {
      ctx.body = "hello";
    });
    const fetch = koaFallback(koa);
    const res = await fetch(new Request("http://localhost/console"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("resolves GET with stream body", async () => {
    const koa = new Koa();
    apps.push(koa);
    koa.use(async (ctx) => {
      ctx.body = Readable.from(["a", "b"]);
    });
    const fetch = koaFallback(koa);
    const res = await fetch(new Request("http://localhost/x"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ab");
  });

  it("works when global fetch is stubbed by other tests", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn());
    try {
      const koa = new Koa();
      apps.push(koa);
      koa.use(async (ctx) => {
        ctx.body = "ok";
      });
      const res = await koaFallback(koa)(new Request("http://localhost/y"));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    } finally {
      globalThis.fetch = originalFetch;
      vi.unstubAllGlobals();
    }
  });
});
