import { describe, it, expect } from "vitest";
import { dispatchConsoleRpc } from "../src/rpc/dispatch.js";
import type { ConsoleWebServer } from "../src/websocket.js";

const webServer = (): ConsoleWebServer => ({
  ws: { clients: new Set() } as ConsoleWebServer["ws"],
  entries: {},
});

describe("dispatchConsoleRpc demo scope", () => {
  it("blocks config:save-yaml for demo scope", async () => {
    const payloads = await dispatchConsoleRpc(
      { type: "config:save-yaml", requestId: 1, yaml: "endpoints: []" },
      webServer,
      { authScope: "demo" },
    );
    const match = payloads.find((p) => p.requestId === 1);
    expect(match?.error).toMatch(/forbidden/i);
  });

  it("allows ping for demo scope", async () => {
    const payloads = await dispatchConsoleRpc(
      { type: "ping", requestId: 2 },
      webServer,
      { authScope: "demo" },
    );
    const match = payloads.find((p) => p.requestId === 2);
    expect(match?.type).toBe("pong");
  });

  it("blocks system:restart for demo scope (no websocket fallback)", async () => {
    const payloads = await dispatchConsoleRpc(
      { type: "system:restart", requestId: 3 },
      webServer,
      { authScope: "demo" },
    );
    const match = payloads.find((p) => p.requestId === 3);
    expect(match?.error).toMatch(/forbidden/i);
  });

  it("blocks config:set for demo scope", async () => {
    const payloads = await dispatchConsoleRpc(
      {
        type: "config:set",
        requestId: 4,
        pluginName: "hello",
        data: {},
      },
      webServer,
      { authScope: "demo" },
    );
    const match = payloads.find((p) => p.requestId === 4);
    expect(match?.error).toMatch(/forbidden/i);
  });
});
