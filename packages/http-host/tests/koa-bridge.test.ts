import Koa from "koa";
import { Readable } from "node:stream";
import { describe, it, expect } from "vitest";
import { koaFallback } from "../src/koa-bridge.js";

describe("koaFallback", () => {
  it("resolves GET with string body", async () => {
    const koa = new Koa();
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
    koa.use(async (ctx) => {
      ctx.body = Readable.from(["a", "b"]);
    });
    const fetch = koaFallback(koa);
    const res = await fetch(new Request("http://localhost/x"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ab");
  });
});
