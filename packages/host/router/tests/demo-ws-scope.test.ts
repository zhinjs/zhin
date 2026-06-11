import { describe, it, expect, vi, beforeEach } from "vitest";
import { createServer } from "node:http";
import { TokenRegistry } from "../src/demo-scope.js";

vi.mock("@zhin.js/core", () => ({
  usePlugin: () => ({
    declareConfig: vi.fn(),
    provide: vi.fn(),
    root: {
      inject: vi.fn(() => null),
      adapters: [],
      children: [],
    },
    useContext: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  }),
  formatCompact: (v: unknown) => String(v),
}));

describe("Router WebSocket auth — demo scope", () => {
  let Router: typeof import("../src/koa-router.js").Router;
  const FULL_TOKEN = "full-secret-token";
  const DEMO_TOKEN = "demo-public-token";

  beforeEach(async () => {
    const mod = await import("../src/koa-router.js");
    Router = mod.Router;
  });

  function registry() {
    return new TokenRegistry({
      primaryToken: FULL_TOKEN,
      scopedTokens: [{ token: DEMO_TOKEN, scope: "demo" }],
    });
  }

  it("demo token connects to /sandbox only", async () => {
    const server = createServer();
    const router = new Router(server);
    router.setTokenRegistry(registry());
    router.ws("/sandbox");
    router.ws("/admin-ws");

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as { port: number };

    try {
      const ok = new (await import("ws")).default(
        `ws://127.0.0.1:${addr.port}/sandbox?token=${DEMO_TOKEN}`,
      );
      const okResult = await new Promise<string>((resolve) => {
        ok.on("open", () => {
          ok.close();
          resolve("open");
        });
        ok.on("unexpected-response", () => resolve("rejected"));
        ok.on("error", () => resolve("error"));
      });
      expect(okResult).toBe("open");

      const bad = new (await import("ws")).default(
        `ws://127.0.0.1:${addr.port}/admin-ws?token=${DEMO_TOKEN}`,
      );
      const badResult = await new Promise<string>((resolve) => {
        bad.on("open", () => resolve("open"));
        bad.on("unexpected-response", () => resolve("rejected"));
        bad.on("error", () => resolve("error"));
      });
      expect(badResult).not.toBe("open");
    } finally {
      server.close();
    }
  });
});
