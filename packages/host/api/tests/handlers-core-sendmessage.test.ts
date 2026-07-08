import { describe, expect, it, vi } from "vitest";
import { Adapter, Plugin } from "@zhin.js/core";
import { handleCoreRpc } from "../src/rpc/handlers-core.js";
import type { ConsoleRpcContext } from "../src/rpc/context.js";

describe("handlers-core endpoint:sendMessage parent", () => {
  it("forwards parent.guild to Adapter.sendMessage", async () => {
    const sendMessage = vi.fn().mockResolvedValue("msg-1");
    const root = new Plugin("/test/root.ts");
    const plugin = new Plugin("/test/plugin.ts", root);

    class TestAdapter extends Adapter {
      constructor() {
        super(plugin, "icqq-test" as keyof Plugin.Contexts, []);
        this.endpoints.set("8596238", {} as never);
      }
    }
    const adapter = new TestAdapter();
    adapter.sendMessage = sendMessage;
    root.provide({
      name: "icqq-test" as keyof Plugin.Contexts,
      description: "test adapter",
      value: adapter,
    });

    const emitted: Record<string, unknown>[] = [];
    const ctx: ConsoleRpcContext = {
      root,
      webServer: { entries: {} },
      projectFs: {
        cwd: () => process.cwd(),
        exists: () => false,
        readText: () => "",
        writeText: () => {},
        stat: () => null,
        readDir: () => [],
        mkdirp: () => {},
      },
      emit: (payload) => { emitted.push(payload); },
    };

    const handled = await handleCoreRpc(
      {
        type: "endpoint:sendMessage",
        requestId: "req-1",
        data: {
          adapter: "icqq-test",
          endpointId: "8596238",
          id: "634415832",
          type: "channel",
          parent: { type: "guild", id: "650779094005186335" },
          content: "nihao",
        },
      },
      ctx,
    );

    expect(handled).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith({
      context: "icqq-test",
      endpoint: "8596238",
      id: "634415832",
      type: "channel",
      parent: { type: "guild", id: "650779094005186335" },
      content: "nihao",
    });
    expect(emitted[0]).toMatchObject({
      requestId: "req-1",
      data: { messageId: "msg-1" },
    });
  });
});
