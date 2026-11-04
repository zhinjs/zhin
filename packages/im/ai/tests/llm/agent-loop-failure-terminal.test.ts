import {
  agentLoop,
  agentContextFrom,
  createUserMessage,
  z,
  type AssistantMessage,
} from "../../src/llm/index.js";
import { assistant } from "../provider/fixtures.js";
import type { Model } from "../../src/llm/types/model.js";

const model: Model = {
  id: "text",
  api: "fixture",
  provider: "fixture",
  input: ["text"],
  contextWindow: 0,
  maxTokens: 0,
};
function toolReply(id: string, name: string): AssistantMessage {
  return {
    ...assistant(),
    stopReason: "toolCalls",
    content: [{ type: "toolCall", id, name, arguments: {} }],
  };
}
function transport(responder: () => AssistantMessage) {
  const complete = async () => responder();
  return { complete, completeSimple: complete };
}

it("does not classify a follow-up tool executor failure as a model response failure", async () => {
  let calls = 0;
  const completion = transport(() =>
    ++calls === 1
      ? toolReply("load", "load_tool")
      : toolReply("tool", "follow_tool")
  );
  const tools = ["load_tool", "follow_tool"].map((name) => ({
    name,
    description: "Synthetic tool",
    parameters: z.object({}),
  }));
  const messages: AssistantMessage[] = [];
  for await (const event of agentLoop(
    createUserMessage("Task"),
    agentContextFrom({ systemPrompt: "", messages: [], tools }),
    {
      model,
      transport: completion,
      maxIterations: 1,
      refreshTools: async () => tools,
      shouldRecompleteAfterTool: () => true,
      executeTool: async (call) => {
        if (call.name === "follow_tool")
          throw new Error("Tool executor failure");
        return {
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: "text", text: "loaded" }],
          timestamp: 1,
        };
      },
    }
  )) {
    if (event.type === "message_end" && event.message.role === "assistant")
      messages.push(event.message);
  }
  expect(calls).toBe(2);
  expect(messages.map((message) => message.stopReason)).toEqual([
    "toolCalls",
    "toolCalls",
  ]);
  expect(messages.every((message) => !message.errorMessage)).toBe(true);
});

it("publishes a failed re-completion without manufacturing successful text or discarding earlier model/tool messages", async () => {
  let calls = 0;
  const completion = transport(() => {
    if (++calls === 1) return toolReply("load", "load_tool");
    throw new Error("Actual model transport failure");
  });
  const tools = [
    {
      name: "load_tool",
      description: "Synthetic tool",
      parameters: z.object({}),
    },
  ];
  const observed: AssistantMessage[] = [];
  let final: unknown;
  for await (const event of agentLoop(
    createUserMessage("Task"),
    agentContextFrom({ systemPrompt: "", messages: [], tools }),
    {
      model,
      transport: completion,
      maxIterations: 1,
      refreshTools: async () => tools,
      shouldRecompleteAfterTool: () => true,
      executeTool: async (call) => ({
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: "loaded" }],
        timestamp: 1,
      }),
    }
  )) {
    if (event.type === "message_end" && event.message.role === "assistant")
      observed.push(event.message);
    if (event.type === "agent_end") final = event.messages;
  }
  expect(calls).toBe(2);
  expect(observed.map((message) => message.stopReason)).toEqual([
    "toolCalls",
    "error",
  ]);
  expect(observed[1]).toMatchObject({
    errorMessage: "Actual model transport failure",
    content: [{ type: "text", text: "" }],
  });
  expect(final).toEqual([
    observed[0],
    expect.objectContaining({ role: "toolResult", toolCallId: "load" }),
    observed[1],
  ]);
});
