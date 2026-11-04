import { SubagentSystem } from "../../src/subagent/index.js";
import { createSpawnTaskTool } from "../../src/spawn/spawn-task-tool.js";
import { runWithAgentTurnConfiguration } from "../../src/turn/agent-turn-context.js";
import { DEFAULT_CONFIG } from "../../src/config/index.js";
import { shouldSuppressReplyForSpawnDelegation } from "../../src/core/spawn-delegation.js";
import {
  executionBundle,
  executionScope,
} from "../helpers/execution-bundle.js";
import {
  assistantTextReply,
  assistantToolCallReply,
  wireMockLlmApi,
} from "../helpers/mock-llm-api.js";
import { mockCommMessage } from "../helpers/mock-comm-message.js";

it.each(["stop", "error", "aborted"] as const)(
  "wait=true reflects the actual %s task outcome after a side effect",
  async (stopReason) => {
    let calls = 0;
    const execute = vi.fn(async () => '{"submitted":true,"outcome":"unknown"}');
    const llm = wireMockLlmApi({
      responder: () => {
        if (calls++ === 0)
          return assistantToolCallReply(
            [{ id: "effect", name: "record_outcome", arguments: {} }],
            "Observed partial answer"
          );
        const response = assistantTextReply(
          stopReason === "stop" ? "Finished" : ""
        );
        response.stopReason = stopReason;
        if (stopReason !== "stop")
          response.errorMessage = "Model response interrupted";
        return response;
      },
    });
    const chat = executionBundle({
      model: llm.runtime.model(llm.provider.name, llm.provider.models[0]),
      completion: llm.runtime,
    });
    const models = await executionScope({ chat }),
      system = new SubagentSystem(),
      sender = vi.fn();
    system.attachRuntime({
      workspace: "/synthetic",
      maxIterations: 3,
      execPolicyConfig: {
        ...DEFAULT_CONFIG,
        subagentTools: ["record_outcome"],
      },
      createTools: () => [
        {
          name: "record_outcome",
          description: "Synthetic operation",
          parameters: { type: "object", properties: {} },
          source: "builtin",
          requiresApproval: "never",
          execute,
        },
      ],
    });
    system.setSender(sender);
    const spawn = vi.spyOn(system, "spawnSync");
    const tool = createSpawnTaskTool(
      mockCommMessage({ senderId: "private-routing-marker" }),
      system
    );
    try {
      const output = await runWithAgentTurnConfiguration({ models }, () =>
        tool.execute({ task: "Record outcome", wait: true })
      );
      const outcome = await spawn.mock.results[0].value;
      expect(Object.keys(outcome).sort()).toEqual(
        ["status", "result", "toolCalls", "terminal"].sort()
      );
      expect(JSON.stringify(outcome)).not.toContain("private-routing-marker");
      expect(outcome).not.toHaveProperty("origin");
      expect(outcome).not.toHaveProperty("taskId");
      expect(outcome.status).toBe(stopReason === "stop" ? "ok" : "error");
      expect(outcome.toolCalls).toMatchObject([
        {
          tool: "record_outcome",
          result: '{"submitted":true,"outcome":"unknown"}',
        },
      ]);
      expect(outcome.terminal).toMatchObject({ stopReason });
      expect(String(output)).toContain("同步等待");
      expect(String(output)).toContain(
        stopReason === "stop" ? "已完成" : "未能完成"
      );
      expect(String(output)).toContain(
        stopReason === "stop" ? "Finished" : "Observed partial answer"
      );
      if (stopReason !== "stop") {
        expect(String(output)).not.toContain("已完成");
        expect(
          String(output).match(/Model response interrupted/g)
        ).toHaveLength(1);
      }
      expect(
        shouldSuppressReplyForSpawnDelegation([
          { tool: "spawn_task", result: output },
        ])
      ).toBe(false);
      expect(calls).toBe(2);
      expect(execute).toHaveBeenCalledOnce();
      expect(sender).not.toHaveBeenCalled();
    } finally {
      await system.dispose();
      await models.release();
    }
  }
);

it("preserves partial text and its failure reason through real async persistence and ResultSink delivery", async () => {
  const { persistSubagentResultToContext } = await import(
    "../../src/turn/persist-subagent-context.js"
  );
  let calls = 0;
  const execute = vi.fn(async () => '{"submitted":true,"outcome":"unknown"}');
  const llm = wireMockLlmApi({
    responder: () => {
      if (calls++ === 0)
        return assistantToolCallReply(
          [{ id: "effect", name: "record_outcome", arguments: {} }],
          "Observed async partial answer" + ".".repeat(800)
        );
      throw new Error("Failure after the observed side effect");
    },
  });
  const chat = executionBundle({
    model: llm.runtime.model(llm.provider.name, llm.provider.models[0]),
    completion: llm.runtime,
  });
  const models = await executionScope({ chat }),
    system = new SubagentSystem();
  const message = mockCommMessage(),
    appendMessages = vi.fn(
      async (_session: string, _messages: unknown[]) => {}
    ),
    deliver = vi.fn(async () => {});
  const host = {
    agentSessionStore: {
      findActive: async () => ({ session_id: "parent-session" }),
    },
    contextRepository: { appendMessages },
  } as unknown as import("../../src/internal/agent-host.js").ZhinAgentPrivate;
  let finish!: () => void;
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  system.attachRuntime({
    workspace: "/synthetic",
    maxIterations: 3,
    execPolicyConfig: { ...DEFAULT_CONFIG, subagentTools: ["record_outcome"] },
    createTools: () => [
      {
        name: "record_outcome",
        description: "Synthetic operation",
        parameters: { type: "object", properties: {} },
        source: "builtin",
        requiresApproval: "never",
        execute,
      },
    ],
    onSubagentComplete: async (payload) => {
      await persistSubagentResultToContext(host, message, payload);
    },
    registerSubagentTask: (done) => {
      void done.finally(finish);
    },
  });
  system.addResultSink({ deliver });
  try {
    await runWithAgentTurnConfiguration({ models }, () =>
      system.spawn({ task: "Task", origin: { message } })
    );
    await completed;
    await vi.waitFor(() => expect(appendMessages).toHaveBeenCalledOnce());
    const persisted = JSON.stringify(appendMessages.mock.calls[0][1]);
    expect(persisted).toContain("Observed async partial answer");
    expect(persisted).toContain("Failure after the observed side effect");
    expect(persisted).toContain("status: error");
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        result: expect.stringContaining(
          "Failure after the observed side effect"
        ),
      })
    );
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.stringContaining("Observed async partial answer"),
      })
    );
    expect(calls).toBe(2);
    expect(execute).toHaveBeenCalledOnce();
  } finally {
    await system.dispose();
    await models.release();
  }
});
