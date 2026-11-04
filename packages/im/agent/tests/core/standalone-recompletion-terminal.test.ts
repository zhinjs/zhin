import { runAgentLoopStandaloneTurn } from "../../src/core/agent-loop-standalone.js";
import {
  createDeferredTurnController,
  runWithDeferredTurnController,
} from "../../src/tool-catalog/deferred-turn-controller.js";
import { executionBundle } from "../helpers/execution-bundle.js";
import {
  assistantTextReply,
  assistantToolCallReply,
  wireMockLlmApi,
} from "../helpers/mock-llm-api.js";

it.each([1, 2])(
  "retains a failed re-completion without adding retries at iteration cap %s",
  async (maxIterations) => {
    const execute = vi.fn(async () => "unused");
    const controller = createDeferredTurnController({
      sessionId: "parent",
      catalog: [
        {
          name: "read_observation",
          brief: "Synthetic read",
          source: "builtin",
          deferDefault: true,
          fullTool: {
            name: "read_observation",
            description: "Synthetic read",
            parameters: { type: "object", properties: {} },
            execute,
          },
        },
      ],
      skillRegistry: null,
      snapshot: { loadedTools: {}, loadedSkills: [] },
      maxLoadedPerSession: 12,
      discoverTopK: 5,
      persistSnapshot: async () => {},
      skillInstructions: {
        read: async (name) => ({ status: "missing", name }),
      },
    });
    let calls = 0;
    const llm = wireMockLlmApi({
      responder: () => {
        calls++;
        if (calls === 1) {
          const response = assistantToolCallReply([
            {
              id: "load",
              name: "load_tool",
              arguments: { name: "read_observation" },
            },
          ]);
          response.usage = {
            ...response.usage,
            input: 8,
            output: 3,
            totalTokens: 11,
          };
          return response;
        }
        if (calls === 2) throw new Error("re-completion transport failed");
        const response = assistantTextReply(
          "Recovered on the originally scheduled next iteration"
        );
        response.usage = {
          ...response.usage,
          input: 5,
          output: 2,
          totalTokens: 7,
        };
        return response;
      },
    });
    const result = await runWithDeferredTurnController(controller, () =>
      runAgentLoopStandaloneTurn({
        execution: executionBundle({
          model: llm.runtime.model(llm.provider.name, llm.provider.models[0]),
          completion: llm.runtime,
        }),
        tools: [],
        systemPrompt: "",
        userInput: "Load read observation",
        maxIterations,
      })
    );
    expect(calls).toBe(maxIterations === 1 ? 2 : 3);
    expect(execute).not.toHaveBeenCalled();
    expect(result.toolCalls).toMatchObject([{ tool: "load_tool" }]);
    if (maxIterations === 1) {
      expect(result.terminal).toEqual({
        stopReason: "error",
        errorMessage: "re-completion transport failed",
      });
      expect(result.content).toContain("re-completion transport failed");
      expect(result.usage).toEqual({
        prompt_tokens: 8,
        completion_tokens: 3,
        total_tokens: 11,
      });
    } else {
      expect(result.terminal).toEqual({ stopReason: "stop" });
      expect(result.content).toBe(
        "Recovered on the originally scheduled next iteration"
      );
      expect(result.usage).toEqual({
        prompt_tokens: 13,
        completion_tokens: 5,
        total_tokens: 18,
      });
      const messages = llm.calls[2].context.messages;
      expect(
        messages.filter((message) => message.role === "assistant")
      ).toHaveLength(1);
      expect(messages).toContainEqual(
        expect.objectContaining({
          role: "toolResult",
          toolName: "load_tool",
          toolCallId: "load",
        })
      );
    }
  }
);

it("preserves repaired tool history on the next scheduled request through the installed SDK and fixed Profile", async () => {
  const { createProviderHarness, openaiChat } = await import(
    "../../../ai/tests/helpers/provider-harness/index.js"
  );
  const h = createProviderHarness({ sdk: "openai", config: { maxRetries: 0 } });
  h.reply(
    openaiChat.reply({
      toolCalls: [
        { name: "load_tool", arguments: { name: "read_observation" } },
      ],
      usage: { prompt: 8, completion: 3 },
    }),
    openaiChat.error(500, { message: "Synthetic transport failure" }),
    openaiChat.reply({ text: "Recovered", usage: { prompt: 5, completion: 2 } })
  );
  const controller = createDeferredTurnController({
    sessionId: "parent",
    catalog: [
      {
        name: "read_observation",
        brief: "Synthetic read",
        source: "builtin",
        deferDefault: true,
        fullTool: {
          name: "read_observation",
          description: "Synthetic read",
          parameters: { type: "object", properties: {} },
          execute: async () => "unused",
        },
      },
    ],
    skillRegistry: null,
    snapshot: { loadedTools: {}, loadedSkills: [] },
    maxLoadedPerSession: 12,
    discoverTopK: 5,
    persistSnapshot: async () => {},
    skillInstructions: { read: async (name) => ({ status: "missing", name }) },
  });
  try {
    const result = await runWithDeferredTurnController(controller, () =>
      runAgentLoopStandaloneTurn({
        execution: executionBundle({ model: h.model, completion: h.runtime }),
        tools: [],
        systemPrompt: "",
        userInput: "Load the reader",
        maxIterations: 2,
      })
    );
    expect(result.terminal).toEqual({ stopReason: "stop" });
    expect(result.content).toBe("Recovered");
    expect(result.usage).toEqual({
      prompt_tokens: 13,
      completion_tokens: 5,
      total_tokens: 18,
    });
    expect(h.requests).toHaveLength(3);
    const messages = h.lastRequest().body.messages;
    expect(
      messages.filter(
        (message: { role: string }) => message.role === "assistant"
      )
    ).toEqual([
      expect.objectContaining({
        role: "assistant",
        tool_calls: [
          expect.objectContaining({
            id: "call_0",
            function: expect.objectContaining({ name: "load_tool" }),
          }),
        ],
      }),
    ]);
    expect(messages).toContainEqual(
      expect.objectContaining({ role: "tool", tool_call_id: "call_0" })
    );
    expect(result.toolCalls).toHaveLength(1);
  } finally {
    await h.runtime.dispose();
  }
});
