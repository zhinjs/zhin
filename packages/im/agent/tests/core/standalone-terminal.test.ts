import type { AssistantMessage } from "@zhin.js/ai";
import {
  runAgentLoopStandaloneTurn,
  type AgentLoopStandaloneResult,
} from "../../src/core/agent-loop-standalone.js";
import { AIService } from "../../src/service.js";
import { formatToolCallsForUser } from "../../src/core/tool-calls-user-format.js";
import { sanitizeAssistantReply } from "../../src/core/text-sanitize.js";
import {
  executionBundle,
  executionScope,
} from "../helpers/execution-bundle.js";
import {
  assistantTextReply,
  assistantToolCallReply,
  wireMockLlmApi,
} from "../helpers/mock-llm-api.js";

const usage = { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 };
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each(["error", "aborted"] as const)(
  "preserves already returned text and raw %s response data",
  async (stopReason) => {
    const response = assistantTextReply("Observed partial answer");
    response.stopReason = stopReason;
    response.errorMessage = "response interrupted";
    response.usage = {
      ...response.usage,
      input: 8,
      output: 3,
      totalTokens: 11,
    };
    const llm = wireMockLlmApi({ responder: () => response });
    const result = await runAgentLoopStandaloneTurn({
      execution: executionBundle({
        model: llm.runtime.model(llm.provider.name, llm.provider.models[0]),
        completion: llm.runtime,
      }),
      systemPrompt: "",
      tools: [],
      userInput: "Task",
      maxIterations: 2,
    });
    expect(result.content).toBe("Observed partial answer");
    expect(result.terminal).toEqual({
      stopReason,
      errorMessage: "response interrupted",
    });
    expect(result.usage).toEqual(usage);
    expect(llm.calls).toHaveLength(1);
  }
);

it.each(["stop", "length"] as const)(
  "does not reinterpret a valid empty %s as failure",
  async (stopReason) => {
    const response = assistantTextReply("");
    response.stopReason = stopReason;
    const llm = wireMockLlmApi({ responder: () => response });
    const result = await runAgentLoopStandaloneTurn({
      execution: executionBundle({
        model: llm.runtime.model(llm.provider.name, llm.provider.models[0]),
        completion: llm.runtime,
      }),
      systemPrompt: "",
      tools: [],
      userInput: "Task",
      maxIterations: 2,
    });
    expect(result.content).toBe(
      sanitizeAssistantReply("", { toolSummary: formatToolCallsForUser([]) })
    );
    expect(result.terminal).toEqual({ stopReason });
    expect(llm.calls).toHaveLength(1);
  }
);

it("keeps an iteration-cap tool-call terminal distinct from model failure and sums all observed usage", async () => {
  const llm = wireMockLlmApi({
    responder: () => {
      const response = assistantToolCallReply([
        { id: "read", name: "read_observation", arguments: {} },
      ]);
      response.usage = {
        ...response.usage,
        input: 8,
        output: 3,
        totalTokens: 11,
      };
      return response;
    },
  });
  const execute = vi.fn(async () => "observed");
  const result = await runAgentLoopStandaloneTurn({
    execution: executionBundle({
      model: llm.runtime.model(llm.provider.name, llm.provider.models[0]),
      completion: llm.runtime,
    }),
    systemPrompt: "",
    tools: [
      {
        name: "read_observation",
        description: "Synthetic read",
        parameters: { type: "object", properties: {} },
        execute,
      },
    ],
    userInput: "Task",
    maxIterations: 2,
  });
  expect(result.terminal).toEqual({ stopReason: "toolCalls" });
  expect(result.iterations).toBe(2);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(llm.calls).toHaveLength(2);
  expect(result.usage).toEqual({
    prompt_tokens: 16,
    completion_tokens: 6,
    total_tokens: 22,
  });
});

it.each([
  new DOMException("Caller stopped", "AbortError"),
  { reason: "exact caller object" },
])(
  "interrupts with the exact reason and a stable observed snapshot",
  async (reason) => {
    const controller = new AbortController();
    const late = gate<AssistantMessage>();
    let calls = 0;
    const llm = wireMockLlmApi({
      responder: () => {
        if (calls++ > 0) return late.promise;
        const response = assistantToolCallReply(
          [{ id: "done", name: "record_outcome", arguments: {} }],
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
    let snapshot: AgentLoopStandaloneResult | undefined;
    const execute = vi.fn(async () => '{"submitted":true,"outcome":"unknown"}');
    const pending = runAgentLoopStandaloneTurn({
      execution: executionBundle({
        model: llm.runtime.model(llm.provider.name, llm.provider.models[0]),
        completion: llm.runtime,
      }),
      systemPrompt: "",
      tools: [
        {
          name: "record_outcome",
          description: "Synthetic operation",
          parameters: { type: "object", properties: {} },
          execute,
        },
      ],
      userInput: "Task",
      maxIterations: 3,
      signal: controller.signal,
      callbacks: {
        onInterrupted: (value) => {
          snapshot = value;
          throw new Error("Observer failure");
        },
      },
    });
    await vi.waitFor(() => expect(llm.calls).toHaveLength(2));
    const rejection = expect(pending).rejects.toBe(reason);
    controller.abort(reason);
    await rejection;
    expect(snapshot?.content).toBe("Observed progress");
    expect(snapshot?.usage).toEqual(usage);
    expect(snapshot?.terminal).toEqual({ stopReason: "toolCalls" });
    expect(snapshot?.toolCalls).toMatchObject([
      {
        tool: "record_outcome",
        result: '{"submitted":true,"outcome":"unknown"}',
      },
    ]);
    const before = JSON.stringify(snapshot);
    late.resolve(assistantTextReply("Unobserved at interruption"));
    await vi.waitFor(() => expect(llm.calls).toHaveLength(2));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(execute).toHaveBeenCalledOnce();
  }
);

it("does not claim an in-flight tool was completed or not executed when cancelled", async () => {
  const controller = new AbortController(),
    tool = gate<string>();
  const llm = wireMockLlmApi({
    responder: () =>
      assistantToolCallReply([
        { id: "pending", name: "pending_outcome", arguments: {} },
      ]),
  });
  const execute = vi.fn(() => tool.promise);
  let snapshot: AgentLoopStandaloneResult | undefined;
  const pending = runAgentLoopStandaloneTurn({
    execution: executionBundle({
      model: llm.runtime.model(llm.provider.name, llm.provider.models[0]),
      completion: llm.runtime,
    }),
    systemPrompt: "",
    tools: [
      {
        name: "pending_outcome",
        description: "Synthetic operation",
        parameters: { type: "object", properties: {} },
        execute,
      },
    ],
    userInput: "Task",
    maxIterations: 3,
    signal: controller.signal,
    callbacks: {
      onInterrupted: (value) => {
        snapshot = value;
      },
    },
  });
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
  const reason = new Error("cancel during operation"),
    rejection = expect(pending).rejects.toBe(reason);
  controller.abort(reason);
  await rejection;
  expect(snapshot?.toolCalls).toEqual([]);
  expect(snapshot?.terminal?.stopReason).toBe("toolCalls");
  tool.resolve("late result");
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(snapshot?.toolCalls).toEqual([]);
  expect(execute).toHaveBeenCalledOnce();
});

it("AIService forwards interruption evidence while retaining original cancellation and borrowed scope ownership", async () => {
  const controller = new AbortController(),
    started = gate<void>(),
    late = gate<AssistantMessage>();
  const llm = wireMockLlmApi({
    responder: () => {
      started.resolve();
      return late.promise;
    },
  });
  const chat = executionBundle({
    model: llm.runtime.model(llm.provider.name, llm.provider.models[0]),
    completion: llm.runtime,
  });
  const models = await executionScope({ chat }),
    service = new AIService(),
    onInterrupted = vi.fn();
  const release = vi.spyOn(models, "release");
  try {
    const pending = service.runAgent("Task", {
      models,
      signal: controller.signal,
      onInterrupted,
    });
    await started.promise;
    const reason = new Error("stop planning"),
      rejection = expect(pending).rejects.toBe(reason);
    controller.abort(reason);
    await rejection;
    expect(onInterrupted).toHaveBeenCalledOnce();
    expect(onInterrupted.mock.calls[0][0]).toMatchObject({
      content: "",
      toolCalls: [],
      iterations: 1,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    expect(onInterrupted.mock.calls[0][0]).not.toHaveProperty("terminal");
    expect(release).not.toHaveBeenCalled();
    late.resolve(assistantTextReply("late"));
  } finally {
    await models.release();
    await service.dispose();
  }
});

it("does not turn an asynchronous interruption observer rejection into an unhandled error", async () => {
  const controller = new AbortController();
  const llm = wireMockLlmApi();
  llm.hang();
  const onInterrupted = vi.fn(async () => {
    throw new Error("Observer rejected");
  });
  const pending = runAgentLoopStandaloneTurn({
    execution: executionBundle({
      model: llm.runtime.model(llm.provider.name, llm.provider.models[0]),
      completion: llm.runtime,
    }),
    systemPrompt: "",
    tools: [],
    userInput: "Task",
    maxIterations: 1,
    signal: controller.signal,
    callbacks: { onInterrupted },
  });
  await vi.waitFor(() => expect(llm.calls).toHaveLength(1));
  const reason = new Error("Original cancellation"),
    rejected = expect(pending).rejects.toBe(reason);
  controller.abort(reason);
  await rejected;
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(onInterrupted).toHaveBeenCalledOnce();
});

it("retains the last observed nonempty response body if a later model request fails without text", async () => {
  let calls = 0;
  const llm = wireMockLlmApi({
    responder: () => {
      if (calls++ === 0)
        return assistantToolCallReply(
          [{ id: "read", name: "read_observation", arguments: {} }],
          "Observed partial answer"
        );
      throw new Error("Later model request failed");
    },
  });
  const execute = vi.fn(async () => "observed");
  const result = await runAgentLoopStandaloneTurn({
    execution: executionBundle({
      model: llm.runtime.model(llm.provider.name, llm.provider.models[0]),
      completion: llm.runtime,
    }),
    systemPrompt: "",
    userInput: "Task",
    maxIterations: 2,
    tools: [
      {
        name: "read_observation",
        description: "Synthetic read",
        parameters: { type: "object", properties: {} },
        execute,
      },
    ],
  });
  expect(result.content).toBe("Observed partial answer");
  expect(result.terminal).toEqual({
    stopReason: "error",
    errorMessage: "Later model request failed",
  });
  expect(result.toolCalls).toMatchObject([
    { tool: "read_observation", result: "observed" },
  ]);
  expect(calls).toBe(2);
  expect(execute).toHaveBeenCalledOnce();
});
