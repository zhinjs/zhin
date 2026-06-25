import { describe, it, expect, vi, beforeEach } from "vitest";
import { Plugin } from "zhin.js";
import { LoginAssist } from "@zhin.js/core";
import { IcqqAdapter } from "../src/adapter.js";
import { IcqqEndpoint } from "../src/endpoint.js";
import { handleIcqqLoginIpcEvent } from "../src/icqq-login-assist-bridge.js";
import { LoginIpcActions } from "../src/login-ipc-contract.js";

describe("icqq-login-assist-bridge", () => {
  let root: Plugin;
  let plugin: Plugin;
  let adapter: IcqqAdapter;
  let endpoint: IcqqEndpoint;
  let loginAssist: LoginAssist;

  beforeEach(() => {
    root = new Plugin("/test/root.ts");
    loginAssist = new LoginAssist(root);
    root.provide({ name: "loginAssist", description: "test", value: loginAssist });
    plugin = new Plugin("/plugins/adapters/icqq/index.ts", root);
    adapter = new IcqqAdapter(plugin);
    endpoint = new IcqqEndpoint(adapter, { context: "icqq", name: "10001" });
    endpoint.ipc = {
      closed: false,
      request: vi.fn(async () => ({ ok: true, data: {} })),
    } as never;
  });

  it("system.login.auth 创建 auth 待办并带上 device", async () => {
    handleIcqqLoginIpcEvent(endpoint, "system.login.auth", {
      url: "https://example.com/verify",
      device: { brand: "Xiaomi", model: "MI 10", guid: "abc" },
    });

    const pending = loginAssist.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.type).toBe("auth");
    expect(pending[0]?.payload?.url).toBe("https://example.com/verify");
    expect(pending[0]?.payload?.device).toMatchObject({ brand: "Xiaomi" });

    loginAssist.submit(pending[0]!.id, { done: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(endpoint.ipc.request).toHaveBeenCalledWith(LoginIpcActions.LOGIN, {});
  });
});
