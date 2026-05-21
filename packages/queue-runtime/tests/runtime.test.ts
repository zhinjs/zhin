import { describe, expect, it } from "vitest";
import { createMemoryStoragePort } from "@zhin.js/storage-port";
import { QueueRuntime } from "../src/runtime.js";

describe("QueueRuntime", () => {
  it("enqueue → claim → execute outbound", async () => {
    const storage = createMemoryStoragePort();
    const rt = new QueueRuntime(storage, { botId: "edge-demo" });

    await rt.handleIncoming({
      kind: "event",
      type: "message",
      detail: { text: "hi" },
    });

    const out = await rt.enqueueOutgoing("edge-demo", {
      context: "sandbox",
      bot: "edge-demo",
      channelId: "ch-1",
      channelType: "private",
      content: "pong",
    });

    const claimed = await rt.claimOutgoing("w1");
    expect(claimed?.id).toBe(out.id);

    let executed = false;
    const result = await rt.executeOutbound(out.id, async () => {
      executed = true;
    });
    expect(executed).toBe(true);
    expect(result.record.status).toBe("done");
  });
});
