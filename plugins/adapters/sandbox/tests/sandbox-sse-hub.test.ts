import { describe, it, expect } from "vitest";
import {
  broadcastSandboxSse,
  resetSandboxSseHubForTests,
  subscribeSandboxSse,
} from "../src/sandbox-sse-hub.js";

describe("sandbox-sse-hub", () => {
  it("broadcasts JSON payloads to SSE stream", async () => {
    resetSandboxSseHubForTests();
    const sessionId = "test-session";
    const stream = subscribeSandboxSse(sessionId);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    broadcastSandboxSse(sessionId, JSON.stringify({ type: "ready", id: "u1" }));
    const { value } = await reader.read();
    const text = decoder.decode(value!);
    expect(text).toContain("data: ");
    expect(text).toContain('"type":"ready"');
    await reader.cancel();
    resetSandboxSseHubForTests();
  });
});
