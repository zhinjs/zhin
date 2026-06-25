import { describe, it, expect } from "vitest";
import {
  TokenRegistry,
  assertDemoRpcAllowed,
  isDemoHttpAllowed,
  isDemoRpcAllowed,
  isDemoWebSocketPath,
} from "../src/demo-scope.js";

describe("demo-scope", () => {
  it("resolves primary and scoped tokens", () => {
    const reg = new TokenRegistry({
      primaryToken: "admin-secret",
      scopedTokens: [{ token: "demo-public", scope: "demo" }],
    });
    expect(reg.resolve("admin-secret")).toBe("full");
    expect(reg.resolve("demo-public")).toBe("demo");
    expect(reg.resolve("wrong")).toBeNull();
  });

  it("allows sandbox chat and read-only config RPC under demo", () => {
    expect(isDemoRpcAllowed("endpoint:sendMessage")).toBe(true);
    expect(isDemoRpcAllowed("config:get-yaml")).toBe(true);
    expect(isDemoRpcAllowed("config:set")).toBe(false);
    expect(isDemoRpcAllowed("config:save-yaml")).toBe(false);
    expect(isDemoRpcAllowed("system:restart")).toBe(false);
    expect(assertDemoRpcAllowed("config:save-yaml")).toMatch(/forbidden/);
    expect(assertDemoRpcAllowed("system:restart")).toMatch(/forbidden/);
  });

  it("allows demo HTTP paths for console + entries", () => {
    expect(isDemoHttpAllowed("GET", "/entries", "/api")).toBe(true);
    expect(isDemoHttpAllowed("GET", "/@dev/sandbox.mjs", "/api")).toBe(true);
    expect(isDemoHttpAllowed("GET", "/api/events", "/api")).toBe(true);
    expect(isDemoHttpAllowed("POST", "/api/console/request", "/api")).toBe(true);
    expect(isDemoHttpAllowed("GET", "/api/plugins", "/api")).toBe(false);
    expect(isDemoHttpAllowed("POST", "/api/config", "/api")).toBe(false);
  });

  it("allows only /sandbox websocket for demo", () => {
    expect(isDemoWebSocketPath("/sandbox")).toBe(true);
    expect(isDemoWebSocketPath("/other")).toBe(false);
  });
});

describe("TokenRegistry timing-safe resolve", () => {
  it("rejects wrong token without matching", () => {
    const reg = new TokenRegistry({ primaryToken: "abc123" });
    expect(reg.resolve("abc124")).toBeNull();
  });
});
