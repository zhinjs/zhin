// 保留内部 import 的原因：该 coordinator 只在 Host 内部构造；aborted 准入与实际规划模型回调需单独触达，上层 module 会先安装其他 coordinator，无法隔离这些路径。
import { Scope, rootPluginId } from "@zhin.js/plugin-runtime";
import { describe, expect, it, vi } from "vitest";
import { AIService } from "../../../../../packages/im/agent/src/service.js";
import {
  executionBundle,
  executionScope,
} from "../../../../../packages/im/agent/tests/helpers/execution-bundle.js";
import {
  assistantTextReply,
  wireMockLlmApi,
} from "../../../../../packages/im/agent/tests/helpers/mock-llm-api.js";
import {
  workroomAssignmentAuthorityGrantRepositoryToken,
  workroomProjectProfileRegistryToken,
  type WorkroomStructuredDagModelInput,
  type WorkroomStructuredDagModelPort,
} from "@zhin.js/workroom";
import {
  WorkroomAssignmentCoordinator,
  type WorkroomAssignmentCoordinatorOptions,
} from "../../../src/plugin-runtime/workroom/assignment-coordinator.js";

const captured = vi.hoisted(() => ({
  model: undefined as WorkroomStructuredDagModelPort | undefined,
  sentinel: new Error("planning port captured"),
}));
// Capture the actual Host callback before unrelated Assignment executors are installed.
vi.mock("@zhin.js/workroom", async (original) => ({
  ...(await original<typeof import("@zhin.js/workroom")>()),
  createGenerationOwnedDynamicPlanningProvider: (options: {
    model: WorkroomStructuredDagModelPort;
  }) => {
    captured.model = options.model;
    throw captured.sentinel;
  },
}));
vi.mock("@zhin.js/workroom/scheduler", async (original) => ({
  ...(await original<typeof import("@zhin.js/workroom/scheduler")>()),
  installWorkroomSchedulerPortfolioDispatchResources: () => ({}),
}));

it.each(["error", "aborted", "stop", "length"] as const)(
  "checks %s before accepting planning JSON",
  async (stopReason) => {
    const response = assistantTextReply('{"version":1,"tasks":[]}');
    response.stopReason = stopReason;
    response.errorMessage = "response incomplete";
    const llm = wireMockLlmApi({
      models: ["explicit-model"],
      responder: () => response,
    });
    const chat = executionBundle({
      model: llm.runtime.model(llm.provider.name, "explicit-model"),
      completion: llm.runtime,
    });
    const models = await executionScope({ chat });
    const service = new AIService();
    const resources = new Scope(rootPluginId());
    resources.provide(workroomProjectProfileRegistryToken, {} as never);
    const release = vi.fn();
    const options = {
      generation: 1,
      projectRoot: "/synthetic",
      signal: new AbortController().signal,
      resources,
      snapshots: { acquire: () => ({ value: { generation: 1 }, release }) },
      agent: {
        service,
        composition: {},
        listBindings: () => [],
        withModels: async (
          _input: unknown,
          run: (scope: typeof models) => Promise<unknown>
        ) => run(models),
      },
      runtime: { journal: {}, catalog: {}, kernel: {} },
      profiles: { profiles: {} },
      persistence: { assignmentAuthorityGrants: {} },
      acceptance: {},
      lifecycle: {},
      handoff: {},
      ingress: {},
    } as unknown as WorkroomAssignmentCoordinatorOptions;
    expect(() => new WorkroomAssignmentCoordinator(options)).toThrow(
      captured.sentinel
    );
    try {
      const pending = captured.model!.generate(
        {
          binding: { generation: 1, agentDefinitionId: "zhin" },
          prompt: {},
        } as WorkroomStructuredDagModelInput,
        new AbortController().signal
      );
      if (stopReason === "error" || stopReason === "aborted") {
        await expect(pending).rejects.toThrow("planning_unavailable");
      } else {
        await expect(pending).resolves.toEqual({ version: 1, tasks: [] });
      }
      expect(llm.calls).toHaveLength(1);
      expect(release).toHaveBeenCalledOnce();
    } finally {
      await models.release();
      await service.dispose();
    }
  }
);

describe("WorkroomAssignmentCoordinator", () => {
  it("rejects an aborted generation before publishing Assignment resources", () => {
    const controller = new AbortController();
    controller.abort(new Error("generation replaced"));
    const resources = new Scope(rootPluginId());

    expect(
      () =>
        new WorkroomAssignmentCoordinator({
          projectRoot: process.cwd(),
          generation: 1,
          signal: controller.signal,
          resources,
          lifecycle: { add: vi.fn() } as never,
          handoff: { add: vi.fn() } as never,
          snapshots: {} as never,
          ingress: {} as never,
          agent: {} as never,
          runtime: {} as never,
          profiles: {} as never,
          persistence: {} as never,
          acceptance: {} as never,
        })
    ).toThrow("generation replaced");
    expect(resources.has(workroomAssignmentAuthorityGrantRepositoryToken)).toBe(
      false
    );
  });
});
