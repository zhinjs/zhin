import { describe, expect, it } from "vitest";
import {
  LlmApiRuntime,
  agentLoop,
  createAssistantMessageEventStream,
  createUserMessage,
  EMPTY_TOKEN_USAGE,
  z,
  type AgentMessage,
  type AssistantMessage,
  type Context,
  type ParsedToolCall,
} from "../../src/llm/index.js";

const MODEL = { api: "ai-sdk" as const, provider: "test", id: "mock" };
const MUTATED = "__zhin_tools_mutated__";

function reply(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
  return { role: "assistant", content, ...MODEL, model: MODEL.id, usage: EMPTY_TOKEN_USAGE, stopReason, timestamp: Date.now() };
}

function result(call: ParsedToolCall, text: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  };
}

/** Scripted transport: each request gets the next reply. */
function scripted(replies: AssistantMessage[]): { runtime: LlmApiRuntime; requests: Context[] } {
  const requests: Context[] = [];
  const runtime = new LlmApiRuntime();
  runtime.registerProvider("test", { sdk: "openai" }, ["mock"]);
  runtime.registerApiProvider({
    api: "ai-sdk",
    stream(_model: unknown, context: Context) {
      requests.push(context);
      const message = replies[requests.length - 1] ?? reply([{ type: "text", text: "extra" }], "stop");
      return createAssistantMessageEventStream(async (push) => {
        push({ type: "done", message });
        return message;
      });
    },
  } as never);
  return { runtime, requests };
}

async function run(replies: AssistantMessage[]): Promise<{ requests: number; finalText: string }> {
  const { runtime, requests } = scripted(replies);
  let finalText = "";
  for await (const event of agentLoop(
    createUserMessage("write the weekly report"),
    { systemPrompt: "", messages: [], tools: [{ name: "load_skill", description: "", parameters: z.object({}) }] },
    {
      model: runtime.model("test", "mock"),
      transport: runtime,
      refreshTools: async () => [{ name: "load_skill", description: "", parameters: z.object({}) }],
      shouldRecompleteAfterTool: (message) => JSON.stringify(message).includes(MUTATED),
      executeTool: async (call) => result(call, `instructions\n${MUTATED}`),
    },
  )) {
    if (event.type === "message_end" && event.message.role === "assistant") {
      const text = (event.message as AssistantMessage).content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("");
      if (text) finalText = text;
    }
  }
  return { requests: requests.length, finalText };
}

describe("agentLoop re-completion after a tools-mutating call", () => {
  it("ends the turn when the re-completion answers in text", async () => {
    const outcome = await run([
      reply([{ type: "toolCall", id: "call_1", name: "load_skill", arguments: {} }], "toolCalls"),
      reply([{ type: "text", text: "report ready" }], "stop"),
    ]);
    expect(outcome.requests).toBe(2);
    expect(outcome.finalText).toBe("report ready");
  });

  it("keeps looping when the re-completion calls more tools", async () => {
    const outcome = await run([
      reply([{ type: "toolCall", id: "call_1", name: "load_skill", arguments: {} }], "toolCalls"),
      reply([{ type: "toolCall", id: "call_2", name: "load_skill", arguments: {} }], "toolCalls"),
      reply([{ type: "text", text: "done" }], "stop"),
    ]);
    expect(outcome.requests).toBe(3);
    expect(outcome.finalText).toBe("done");
  });
});
