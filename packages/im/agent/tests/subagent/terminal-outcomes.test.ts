import { DEFAULT_CONFIG } from "../../src/config/index.js";
import type {
  SubagentCompletePayload,
  SubagentLifecycleEvent,
} from "../../src/subagent/subagent-runtime.js";
import { createTestSubagentRuntime } from "../helpers/scoped-subagent.js";
import {
  assistantToolCallReply,
  wireMockLlmApi,
} from "../helpers/mock-llm-api.js";

it("reports a model error after two tool calls without losing their outcomes or already reported usage", async () => {
  const sideEffects: string[] = [];
  const observed: SubagentLifecycleEvent[] = [];
  const usage: unknown[] = [];
  let payload: SubagentCompletePayload | undefined;
  let finish!: () => void;
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  const llm = wireMockLlmApi({
    name: "terminal-fixture",
    models: ["explicit-model"],
    responder: () => {
      if (calls++ === 0) {
        const response = assistantToolCallReply([
          { id: "known", name: "record_known", arguments: {} },
          { id: "unknown", name: "record_unknown", arguments: {} },
        ]);
        response.usage = {
          ...response.usage,
          input: 8,
          output: 3,
          totalTokens: 11,
        };
        return response;
      }
      throw new Error("Model unavailable after the completed tool work");
    },
  });
  const manager = createTestSubagentRuntime({
    runtime: llm.runtime,
    alias: llm.provider.name,
    model: "explicit-model",
    options: {
      workspace: "/synthetic",
      maxIterations: 3,
      execPolicyConfig: {
        ...DEFAULT_CONFIG,
        subagentTools: ["record_known", "record_unknown"],
      },
      createTools: () =>
        ["known", "unknown"].map((outcome) => ({
          name: `record_${outcome}`,
          source: "builtin",
          description: "Synthetic side effect",
          parameters: { type: "object", properties: {} },
          requiresApproval: "never",
          execute: async () => {
            sideEffects.push(outcome);
            return JSON.stringify({ submitted: true, outcome });
          },
        })),
      onEvent: (event) => {
        observed.push(event);
      },
      onSubagentUsage: (value) => {
        usage.push(value);
      },
      onSubagentComplete: async (value) => {
        payload = value;
      },
      registerSubagentTask: (task) => {
        void task.finally(finish);
      },
    },
  });
  try {
    await manager.spawn({
      task: "Run the two synthetic operations",
      origin: { message: {} as import("@zhin.js/core").Message },
    });
    await completed;
    expect(sideEffects).toEqual(["known", "unknown"]);
    expect(calls).toBe(2);
    expect(observed.find((event) => event.phase === "finish")?.status).toBe(
      "error"
    );
    expect(payload?.status).toBe("error");
    expect(payload?.toolCalls.map((call) => call.tool)).toEqual([
      "record_known",
      "record_unknown",
    ]);
    expect(payload?.toolCalls[1].result).toContain('"outcome":"unknown"');
    expect(usage).toEqual([
      { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
    ]);
    expect(payload?.result).toContain("Model unavailable");
  } finally {
    await manager.dispose();
  }
});

it.each(["none", "sync", "async"] as const)(
  "retains cancellation results when usage observer mode is %s",
  async (observerMode) => {
    const { assistantTextReply } = await import("../helpers/mock-llm-api.js");
    let resolveLate!: (reply: ReturnType<typeof assistantTextReply>) => void;
    const late = new Promise<ReturnType<typeof assistantTextReply>>(
      (resolve) => {
        resolveLate = resolve;
      }
    );
    let calls = 0,
      effects = 0,
      taskId = "";
    let payload: SubagentCompletePayload | undefined;
    let finishEvent: SubagentLifecycleEvent | undefined;
    const usage: unknown[] = [];
    let finish!: () => void;
    const completed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const llm = wireMockLlmApi({
      models: ["explicit-model"],
      responder: () => {
        if (calls++ > 0) return late;
        const response = assistantToolCallReply(
          [{ id: "effect", name: "record_outcome", arguments: {} }],
          "Observed progress"
        );
        response.usage = {
          ...response.usage,
          input: 8,
          output: 3,
          totalTokens: 11,
        };
        return response;
      },
    });
    const manager = createTestSubagentRuntime({
      runtime: llm.runtime,
      alias: llm.provider.name,
      model: "explicit-model",
      options: {
        workspace: "/synthetic",
        maxIterations: 3,
        execPolicyConfig: {
          ...DEFAULT_CONFIG,
          subagentTools: ["record_outcome"],
        },
        createTools: () => [
          {
            name: "record_outcome",
            source: "builtin",
            description: "Synthetic operation",
            parameters: { type: "object", properties: {} },
            requiresApproval: "never",
            execute: async () => {
              effects++;
              return '{"submitted":true,"outcome":"unknown"}';
            },
          },
        ],
        onEvent: (event) => {
          if (event.phase === "start") taskId = event.taskId;
          if (event.phase === "finish") finishEvent = event;
        },
        onSubagentUsage: (value) => {
          usage.push(value);
          if (observerMode === "sync") throw new Error("Usage observer failed");
          if (observerMode === "async")
            return Promise.reject(new Error("Usage observer failed"));
        },
        onSubagentComplete: async (value) => {
          payload = value;
        },
        registerSubagentTask: (task) => {
          void task.finally(finish);
        },
      },
    });
    try {
      await manager.spawn({
        task: "Record outcome",
        origin: { message: {} as import("@zhin.js/core").Message },
      });
      await vi.waitFor(() => expect(llm.calls).toHaveLength(2));
      expect(manager.cancel(taskId)).toBe(true);
      await completed;
      expect(payload?.status).toBe("error");
      expect(payload?.result).toContain("Observed progress");
      expect(finishEvent?.result).toContain("Observed progress");
      expect(payload?.toolCalls).toMatchObject([
        {
          tool: "record_outcome",
          result: '{"submitted":true,"outcome":"unknown"}',
        },
      ]);
      expect(usage).toEqual([
        { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      ]);
      const before = JSON.stringify(payload);
      resolveLate(assistantTextReply("late completion"));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(JSON.stringify(payload)).toBe(before);
      expect(effects).toBe(1);
      expect(calls).toBe(2);
    } finally {
      await manager.dispose();
    }
  }
);

it.each(["error", "aborted"] as const)(
  "does not declare completion for an empty %s model response",
  async (stopReason) => {
    const { assistantTextReply } = await import("../helpers/mock-llm-api.js");
    const response = assistantTextReply("");
    response.stopReason = stopReason;
    const llm = wireMockLlmApi({ responder: () => response });
    let payload: SubagentCompletePayload | undefined;
    let finish!: () => void;
    const completed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const manager = createTestSubagentRuntime({
      runtime: llm.runtime,
      alias: llm.provider.name,
      model: llm.provider.models[0],
      options: {
        workspace: "/synthetic",
        maxIterations: 1,
        createTools: () => [],
        onSubagentComplete: async (value) => {
          payload = value;
        },
        registerSubagentTask: (task) => {
          void task.finally(finish);
        },
      },
    });
    try {
      await manager.spawn({
        task: "Task",
        origin: { message: {} as import("@zhin.js/core").Message },
      });
      await completed;
      expect(payload?.status).toBe("error");
      expect(payload?.result).not.toContain("任务已完成");
      expect(llm.calls).toHaveLength(1);
    } finally {
      await manager.dispose();
    }
  }
);

it("publishes processing.error rather than a successful processing.finish for returned model errors", async () => {
  const { assistantTextReply } = await import("../helpers/mock-llm-api.js");
  const response = assistantTextReply("Observed partial result");
  response.stopReason = "error";
  response.errorMessage = "Model incomplete";
  const llm = wireMockLlmApi({ responder: () => response });
  const names: string[] = [];
  const eventEmitter = {
    createPayload: (
      _session: string,
      _message: unknown,
      _mode: string,
      extra: unknown
    ) => extra,
    dispatch: async (name: string) => {
      names.push(name);
    },
    emit: () => undefined,
  } as unknown as import("../../src/event/event-emitter.js").ZhinAgentEventEmitter;
  const manager = createTestSubagentRuntime({
    runtime: llm.runtime,
    alias: llm.provider.name,
    model: llm.provider.models[0],
    options: {
      workspace: "/synthetic",
      createTools: () => [],
      eventEmitter,
    },
  });
  try {
    const result = await manager.spawnSync({
      task: "Task",
      origin: {
        message: {
          $adapter: "test",
          $endpoint: "bot1",
          $sender: { id: "user1" },
          $channel: { type: "private", id: "scene1" },
        } as import("@zhin.js/core").Message,
      },
    });
    expect(result.result).toContain("Observed partial result");
    expect(result.result).toContain("Model incomplete");
    expect(result.status).toBe("error");
    expect(names).toContain("ai.processing.error");
    expect(names).not.toContain("ai.processing.finish");
    expect(names).not.toContain("ai.agent.finish");
  } finally {
    await manager.dispose();
  }
});
