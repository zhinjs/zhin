import { beforeEach, describe, expect, it, vi } from "vitest";
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
  type LlmTool,
  type ParsedToolCall,
} from "../../src/llm/index.js";

const MODEL = { api: "ai-sdk" as const, provider: "test", id: "mock" };

function reply(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    ...MODEL,
    model: MODEL.id,
    usage: EMPTY_TOKEN_USAGE,
    stopReason,
    timestamp: Date.now(),
  };
}

function tool(name: string): LlmTool {
  return { name, description: name, parameters: z.object({}) };
}

function okResult(call: ParsedToolCall): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: "text", text: `ran ${call.name}` }],
    isError: false,
    timestamp: Date.now(),
  };
}

describe("agentLoop resolveMissingTool", () => {
  let runtime: LlmApiRuntime;
  let contexts: Context[];

  beforeEach(() => {
    contexts = [];
    runtime = new LlmApiRuntime();
    runtime.registerProvider("test", { sdk: "openai" }, ["mock"]);
    runtime.registerApiProvider({
      api: "ai-sdk",
      stream(_model: unknown, context: Context) {
        contexts.push({ ...context, tools: context.tools ? [...context.tools] : undefined });
        const answered = context.messages.some((m) => m.role === "toolResult");
        const message = answered
          ? reply([{ type: "text", text: "done" }], "stop")
          : reply([{ type: "toolCall", id: "call_1", name: "read_file", arguments: {} }], "toolCalls");
        return createAssistantMessageEventStream(async (push) => {
          push({ type: "done", message });
          return message;
        });
      },
    } as never);
  });

  async function run(options: {
    tools: LlmTool[];
    resolveMissingTool?: (name: string) => Promise<LlmTool | undefined>;
  }): Promise<{ results: AgentMessage[]; executed: string[] }> {
    const executed: string[] = [];
    const results: AgentMessage[] = [];
    for await (const event of agentLoop(
      createUserMessage("read it"),
      { systemPrompt: "", messages: [], tools: options.tools },
      {
        model: runtime.model("test", "mock"),
        transport: runtime,
        resolveMissingTool: options.resolveMissingTool,
        executeTool: async (call) => {
          executed.push(call.name);
          return okResult(call);
        },
      },
    )) {
      if (event.type === "tool_execution_end") results.push(event.result);
    }
    return { results, executed };
  }

  it("loads a deferred tool the model called directly and runs it", async () => {
    const resolveMissingTool = vi.fn(async (name: string) => (name === "read_file" ? tool("read_file") : undefined));

    const { results, executed } = await run({ tools: [tool("load_tool")], resolveMissingTool });

    expect(resolveMissingTool).toHaveBeenCalledWith("read_file", undefined);
    expect(executed).toEqual(["read_file"]);
    expect(results[0]).toMatchObject({ isError: false });
    // The loaded schema stays available for the rest of the turn.
    expect(contexts.at(-1)?.tools?.map((t) => t.name)).toContain("read_file");
  });

  it("still rejects names the resolver does not know, with a discovery hint", async () => {
    const { results, executed } = await run({
      tools: [tool("discover"), tool("load_tool")],
      resolveMissingTool: async () => undefined,
    });

    expect(executed).toEqual([]);
    const text = JSON.stringify(results[0]);
    expect(results[0]).toMatchObject({ isError: true });
    expect(text).toContain("Unknown tool: read_file");
    expect(text).toContain("discover");
    expect(text).toContain("load_tool");
  });

  it("keeps the plain unknown-tool error when no discovery tools exist", async () => {
    const { results } = await run({ tools: [] });

    expect(JSON.stringify(results[0])).toContain("Unknown tool: read_file\"");
  });
});
