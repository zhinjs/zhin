import { SnapshotStore, rootPluginId } from "@zhin.js/plugin-runtime";
import {
  createInferenceRuntime,
  normalizeProviderGraph,
} from "@zhin.js/ai/provider";
import { openAiProvider } from "@zhin.js/ai/providers";
import { ModelRuntimeService } from "../../src/model-runtime/service.js";
import { ZhinAgent } from "../../src/zhin-agent/index.js";
import { context, graphFixture } from "../../../ai/tests/provider/fixtures.js";
import { chatReply } from "../../../ai/tests/providers/fixtures.js";
import { mockCommMessage } from "../helpers/mock-comm-message.js";
import { getLogger } from "@zhin.js/logger";


// #1250 model-request-hangs-no-timeout: an OpenAI-compatible relay accepts the request and never
// answers. The turn must end after the first-response deadline with a clear reply through the
// normal outbound path, a warn log naming provider/model/purpose/turn, and no same-model retry.
it("ends a turn whose provider never answers with a no-response reply after the first-response deadline", async () => {
  const original = graphFixture(),
    root = rootPluginId();
  const graph = normalizeProviderGraph({
    ...original,
    services: {
      service: {
        ...original.services.service,
        driver: { id: "openai", owner: "root", contractVersion: "1" },
        options: { baseUrl: "https://api.openai.com/v1" },
        models: {
          selected: { id: "selected", protocol: "openai-chat", kinds: ["language"], input: ["text"], toolCalling: true },
        },
      },
    },
    accounts: { account: { ...original.accounts.account, authentication: { method: "api-key" } } },
    profiles: { text: { ...original.profiles.text, model: "selected", parameters: {} } },
    purposes: { defaults: { chat: "text" } },
  });
  const requests: Request[] = [];
  const snapshots = new SnapshotStore({
    root,
    tree: new Map([[root, { id: root, instanceKey: "root", packageName: "fixture", packageRoot: "/fixture", children: [] }]]),
    resources: new Map(), config: new Map(), capabilities: new Map(), projections: new Map(),
  });
  const lease = snapshots.acquire();
  const runtime = new ModelRuntimeService({
    rootId: "root",
    hostOwnerId: context.hostOwnerId,
    context: () => context,
    inferenceFactory: () =>
      createInferenceRuntime({
        repository: { readGraph: async () => graph },
        drivers: { acquire: async ({ service }) => ({ reference: service.driver, definition: openAiProvider, release() {} }) },
        credentials: () => ({
          bindRequest: (input) => input.request,
          authorize: async () => ({ token: "synthetic-key-never-logged", revision: "one", headers: {} }),
        }),
        // Never answers: settles only when the request is aborted.
        fetch: () => (url, init) => {
          const request = new Request(url, init);
          requests.push(request);
          return new Promise<Response>((_, reject) => {
            request.signal.addEventListener("abort", () => reject(request.signal.reason));
          });
        },
      }),
  });
  const models = await runtime.acquireForContext({ snapshots, lease, context });
  const warn = vi.spyOn(getLogger("ZhinAgent:AgentLoopTurn"), "warn");
  const warnings: string[] = [];
  const pending = new Map<number, { fn: () => void; ms: number }>();
  let next = 0;
  const agent = new ZhinAgent({
    config: {
      // Virtual clock for the attempt deadlines: fire the 30s first-response timer by hand.
      providerTimers: {
        setTimeout: (fn, ms) => { pending.set(++next, { fn, ms }); return next; },
        clearTimeout: (handle) => { pending.delete(handle as number); },
      },
      outputSchema: false,
      providerResilience: { baseDelayMs: 0, maxDelayMs: 0 },
    },
  });
  try {
    const turn = agent.processTurn({
      content: "Synthetic question",
      message: mockCommMessage({ isMaster: true }),
      configuration: { models },
      tools: [],
    });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const deadlines = [...pending.values()].map((timer) => timer.ms).sort((a, b) => a - b);
    expect(deadlines).toEqual([30000, 120000]);
    [...pending.values()].find((timer) => timer.ms === 30000)!.fn();
    const result = await turn;
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(result)).toContain("模型服务无响应");
    for (const call of warn.mock.calls) warnings.push(call.map(String).join(" "));
    const timeoutLog = warnings.find((line) => line.includes("provider_timeout"));
    expect(timeoutLog).toBeDefined();
    expect(timeoutLog).toContain("phase: first_response");
    expect(timeoutLog).toContain("purpose: chat");
    expect(timeoutLog).toContain("model: selected");
    expect(timeoutLog).toContain("timeout_ms: 30000");
    expect(warnings.join("\n")).not.toContain("synthetic-key-never-logged");
  } finally {
    warn.mockRestore();
    await agent.dispose();
    await models.release();
    lease.release();
    runtime.dispose();
  }
});
