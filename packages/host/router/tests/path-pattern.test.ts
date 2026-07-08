import { describe, expect, it } from "vitest";
import { toKoaRouterPath } from "../src/path-pattern.js";
import { Router } from "../src/koa-router.js";
import { createServer } from "node:http";

describe("toKoaRouterPath", () => {
  it("converts :param+ to *param", () => {
    expect(toKoaRouterPath("/pub/marketplace/detail/:name+")).toBe(
      "/pub/marketplace/detail/*name",
    );
  });

  it("registers splat route without PathError", () => {
    const server = createServer();
    const router = new Router(server);
    expect(() => {
      router.get("/pub/marketplace/detail/:name+", (ctx) => {
        ctx.body = { ok: true };
      });
    }).not.toThrow();
    expect(() => {
      router.all("/mcp/:tail+", () => {});
    }).not.toThrow();
    server.close();
  });
});
