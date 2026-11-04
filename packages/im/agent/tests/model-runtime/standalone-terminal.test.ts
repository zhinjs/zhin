import { AIService } from "../../src/service.js";
import { DeferredWorkerRunner } from "../../src/deferred-worker-runner.js";
import {
  executionBundle,
  executionScope,
} from "../helpers/execution-bundle.js";
import {
  assistantTextReply,
  assistantToolCallReply,
  wireMockLlmApi,
} from "../helpers/mock-llm-api.js";

it("AIService preserves a model error terminal even when the returned content is valid JSON", async () => {
  const message = assistantTextReply('{"version":1,"tasks":[]}');
  message.stopReason = "error";
  message.errorMessage = "incomplete model response";
  const llm = wireMockLlmApi({
    models: ["explicit-model"],
    responder: () => message,
  });
  const chat = executionBundle({
    model: llm.runtime.model(llm.provider.name, "explicit-model"),
    completion: llm.runtime,
  });
  const models = await executionScope({ chat });
  const service = new AIService();
  try {
    const result = await service.runAgent("Plan a task", {
      models,
      maxIterations: 1,
    });
    expect(result.content).toBe('{"version":1,"tasks":[]}');
    expect(result).toHaveProperty("terminal", {
      stopReason: "error",
      errorMessage: "incomplete model response",
    });
    expect(llm.calls).toHaveLength(1);
  } finally {
    await models.release();
    await service.dispose();
  }
});

it("Worker reports an error after a completed side effect without replacing its outcome", async () => {
  let effects = 0;
  const tool = {
    name: "record_outcome",
    description: "Synthetic operation",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      effects++;
      return '{"submitted":true,"outcome":"unknown"}';
    },
  };
  let calls = 0;
  const llm = wireMockLlmApi({
    models: ["explicit-model"],
    responder: () => {
      if (calls++ === 0) {
        const message = assistantToolCallReply([
          { id: "effect", name: tool.name, arguments: {} },
        ]);
        message.usage = {
          ...message.usage,
          input: 8,
          output: 3,
          totalTokens: 11,
        };
        return message;
      }
      throw new Error("model failed after submission");
    },
  });
  const result = await new DeferredWorkerRunner().runSync({
    goal: "Record outcome",
    workerBaseTools: [tool],
    deferredCatalog: [],
    allToolsByName: new Map([[tool.name, tool]]),
    origin: {} as import("@zhin.js/core").Message,
    maxToolResults: 1,
    maxIterations: 3,
    execution: executionBundle({
      model: llm.runtime.model(llm.provider.name, "explicit-model"),
      completion: llm.runtime,
    }),
  });
  expect(effects).toBe(1);
  expect(calls).toBe(2);
  expect.soft(result.status).toBe("error");
  expect.soft(JSON.parse(result.summary).status).toBe("error");
  expect(result.toolCalls).toMatchObject([
    { tool: tool.name, result: '{"submitted":true,"outcome":"unknown"}' },
  ]);
});

it.each(["error", "aborted"] as const)(
  "Worker keeps partial %s response text and usage at the existing iteration cap",
  async (stopReason) => {
    const response = assistantTextReply("Observed partial output");
    response.stopReason = stopReason;
    response.usage = {
      ...response.usage,
      input: 8,
      output: 3,
      totalTokens: 11,
    };
    const llm = wireMockLlmApi({ responder: () => response });
    const tool = {
      name: "read_observation",
      description: "Synthetic read",
      parameters: { type: "object", properties: {} },
      execute: vi.fn(async () => "unused"),
    };
    const result = await new DeferredWorkerRunner().runSync({
      goal: "Read observation",
      workerBaseTools: [tool],
      deferredCatalog: [],
      allToolsByName: new Map([[tool.name, tool]]),
      origin: {} as import("@zhin.js/core").Message,
      maxToolResults: 1,
      maxIterations: 1,
      execution: executionBundle({
        model: llm.runtime.model(llm.provider.name, llm.provider.models[0]),
        completion: llm.runtime,
      }),
    });
    expect(result.status).toBe("error");
    expect(JSON.parse(result.summary).summary).not.toContain(
      "已达 Worker 最大轮次"
    );
    expect(JSON.parse(result.summary).summary).toContain(
      "Observed partial output"
    );
    expect(result.terminal).toEqual({ stopReason });
    expect(result.usage).toEqual({
      prompt_tokens: 8,
      completion_tokens: 3,
      total_tokens: 11,
    });
    expect(tool.execute).not.toHaveBeenCalled();
    expect(llm.calls).toHaveLength(1);
  }
);

it.each(["stop", "length", "toolCalls"] as const)(
  "keeps the existing Worker partial policy for a %s at the iteration cap",
  async (stopReason) => {
    const tool = {
      name: "read_observation",
      description: "Synthetic read",
      parameters: { type: "object", properties: {} },
      execute: vi.fn(async () => "observed"),
    };
    const response =
      stopReason === "toolCalls"
        ? assistantToolCallReply([
            { id: "read", name: tool.name, arguments: {} },
          ])
        : assistantTextReply("");
    response.stopReason = stopReason;
    const llm = wireMockLlmApi({ responder: () => response });
    const result = await new DeferredWorkerRunner().runSync({
      goal: "Read observation",
      workerBaseTools: [tool],
      deferredCatalog: [],
      allToolsByName: new Map([[tool.name, tool]]),
      origin: {} as import("@zhin.js/core").Message,
      maxToolResults: 1,
      maxIterations: 1,
      execution: executionBundle({
        model: llm.runtime.model(llm.provider.name, llm.provider.models[0]),
        completion: llm.runtime,
      }),
    });
    expect(result.status).toBe("partial");
    expect(JSON.parse(result.summary).summary).toContain(
      "已达 Worker 最大轮次"
    );
    expect(result.terminal).toEqual({ stopReason });
    expect(llm.calls).toHaveLength(1);
    expect(tool.execute).toHaveBeenCalledTimes(
      stopReason === "toolCalls" ? 1 : 0
    );
  }
);

it.each([false, true])("keeps the error reason within the Worker summary limit when it already appears at the tail: %s", async (reasonAtTail) => {
  const response = assistantTextReply(
    "Observed partial output " + ".".repeat(200) + (reasonAtTail ? ' Necessary failure reason' : '')
  );
  response.stopReason = "error";
  response.errorMessage = "Necessary failure reason";
  const llm = wireMockLlmApi({ responder: () => response });
  const tool = {
    name: "read_observation",
    description: "Synthetic read",
    parameters: { type: "object", properties: {} },
    execute: vi.fn(async () => "unused"),
  };
  const result = await new DeferredWorkerRunner().runSync({
    goal: "Task",
    workerBaseTools: [tool],
    deferredCatalog: [],
    allToolsByName: new Map([[tool.name, tool]]),
    origin: {} as import("@zhin.js/core").Message,
    maxToolResults: 1,
    maxIterations: 1,
    summaryMaxChars: 80,
    execution: executionBundle({
      model: llm.runtime.model(llm.provider.name, llm.provider.models[0]),
      completion: llm.runtime,
    }),
  });
  expect(result.status).toBe("error");
  const summary = JSON.parse(result.summary).summary;
  expect(summary).toContain("Necessary failure reason");
  expect(summary).toContain("Observed partial output");
  expect(tool.execute).not.toHaveBeenCalled();
  expect(llm.calls).toHaveLength(1);
});
