import { describe, it, expect, vi, beforeEach } from "vitest";
import { createServer } from "node:http";

// Mock @zhin.js/core so the module can be imported without a full Zhin app.
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

describe("Router WebSocket auth", () => {
  let Router: typeof import("../src/koa-router.js").Router;
  const TEST_TOKEN = "test-secret-token-abc123";

  beforeEach(async () => {
    const mod = await import("../src/koa-router.js");
    Router = mod.Router;
  });

  it("should reject WS upgrade without token when authToken is set", async () => {
    const server = createServer();
    const router = new Router(server);
    router.setAuthToken(TEST_TOKEN);

    // Create a WS endpoint (no verifyClient → should require global auth)
    router.ws("/server");

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as { port: number };

    try {
      // Attempt connection without a token — should be rejected
      const ws = new (await import("ws")).default(
        `ws://127.0.0.1:${addr.port}/server`,
      );
      const result = await new Promise<string>((resolve) => {
        ws.on("open", () => resolve("open"));
        ws.on("error", () => resolve("error"));
        ws.on("unexpected-response", () => resolve("rejected"));
      });
      expect(result).not.toBe("open");
    } finally {
      server.close();
    }
  });

  it("should accept WS upgrade with valid token in query", async () => {
    const server = createServer();
    const router = new Router(server);
    router.setAuthToken(TEST_TOKEN);
    router.ws("/server");

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as { port: number };

    try {
      const ws = new (await import("ws")).default(
        `ws://127.0.0.1:${addr.port}/server?token=${TEST_TOKEN}`,
      );
      const result = await new Promise<string>((resolve) => {
        ws.on("open", () => {
          ws.close();
          resolve("open");
        });
        ws.on("error", () => resolve("error"));
        ws.on("unexpected-response", () => resolve("rejected"));
      });
      expect(result).toBe("open");
    } finally {
      server.close();
    }
  });

  it("should accept WS upgrade with valid Bearer header", async () => {
    const server = createServer();
    const router = new Router(server);
    router.setAuthToken(TEST_TOKEN);
    router.ws("/server");

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as { port: number };

    try {
      const ws = new (await import("ws")).default(
        `ws://127.0.0.1:${addr.port}/server`,
        { headers: { Authorization: `Bearer ${TEST_TOKEN}` } },
      );
      const result = await new Promise<string>((resolve) => {
        ws.on("open", () => {
          ws.close();
          resolve("open");
        });
        ws.on("error", () => resolve("error"));
        ws.on("unexpected-response", () => resolve("rejected"));
      });
      expect(result).toBe("open");
    } finally {
      server.close();
    }
  });

  it("should exempt paths with their own verifyClient", async () => {
    const server = createServer();
    const router = new Router(server);
    router.setAuthToken(TEST_TOKEN);
    // Register a WS path with its own verifyClient (like adapter bots do)
    router.ws("/adapter-bot", {
      verifyClient: () => true,
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as { port: number };

    try {
      // Should connect even without the global auth token
      const ws = new (await import("ws")).default(
        `ws://127.0.0.1:${addr.port}/adapter-bot`,
      );
      const result = await new Promise<string>((resolve) => {
        ws.on("open", () => {
          ws.close();
          resolve("open");
        });
        ws.on("error", () => resolve("error"));
        ws.on("unexpected-response", () => resolve("rejected"));
      });
      expect(result).toBe("open");
    } finally {
      server.close();
    }
  });

  it("should reject WS upgrade with wrong token", async () => {
    const server = createServer();
    const router = new Router(server);
    router.setAuthToken(TEST_TOKEN);
    router.ws("/server");

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as { port: number };

    try {
      const ws = new (await import("ws")).default(
        `ws://127.0.0.1:${addr.port}/server?token=wrong-token`,
      );
      const result = await new Promise<string>((resolve) => {
        ws.on("open", () => resolve("open"));
        ws.on("error", () => resolve("error"));
        ws.on("unexpected-response", () => resolve("rejected"));
      });
      expect(result).not.toBe("open");
    } finally {
      server.close();
    }
  });
});
