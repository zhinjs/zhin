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

it.each([
  { profileRetries: 0, globalRetries: 1, expectedCalls: 1, master: true },
  { profileRetries: 0, globalRetries: 1, expectedCalls: 1, master: false },
  { profileRetries: 1, globalRetries: 0, expectedCalls: 2, master: true },
])(
  "honors selected Profile maxRetries=$profileRetries in the actual Agent request owner",
  async ({ profileRetries, globalRetries, expectedCalls, master }) => {
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
            selected: {
              id: "selected",
              protocol: "openai-chat",
              kinds: ["language"],
              input: ["text"],
              toolCalling: true,
            },
          },
        },
      },
      accounts: {
        account: {
          ...original.accounts.account,
          authentication: { method: "api-key" },
        },
      },
      profiles: {
        text: {
          ...original.profiles.text,
          model: "selected",
          parameters: { maxRetries: profileRetries, requestTimeoutMs: 19000 },
        },
      },
      purposes: { defaults: { chat: "text" } },
    });
    const requests: Request[] = [];
    const snapshots = new SnapshotStore({
      root,
      tree: new Map([
        [
          root,
          {
            id: root,
            instanceKey: "root",
            packageName: "fixture",
            packageRoot: "/fixture",
            children: [],
          },
        ],
      ]),
      resources: new Map(),
      config: new Map(),
      capabilities: new Map(),
      projections: new Map(),
    });
    const lease = snapshots.acquire();
    const runtime = new ModelRuntimeService({
      rootId: "root",
      hostOwnerId: context.hostOwnerId,
      context: () => context,
      inferenceFactory: () =>
        createInferenceRuntime({
          repository: { readGraph: async () => graph },
          drivers: {
            acquire: async ({ service }) => ({
              reference: service.driver,
              definition: openAiProvider,
              release() {},
            }),
          },
          credentials: () => ({
            bindRequest: (input) => input.request,
            authorize: async () => ({
              token: "synthetic-key",
              revision: "one",
              headers: {},
            }),
          }),
          fetch: () => async (url, init) => {
            requests.push(new Request(url, init));
            return requests.length === 1
              ? Response.json(
                  {
                    error: { message: "rate limit", type: "rate_limit_error" },
                  },
                  { status: 429 }
                )
              : chatReply("eventual answer");
          },
        }),
    });
    const models = await runtime.acquireForContext({
      snapshots,
      lease,
      context,
    });
    const armed: number[] = [];
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const agent = new ZhinAgent({
      config: {
        providerTimers: {
          setTimeout: (fn, ms) => {
            armed.push(ms);
            return setTimeout(fn, ms);
          },
          clearTimeout: (handle) =>
            clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
        modelHarness: {
          services: { service: { defaults: { requestTimeoutMs: 31000 } } },
        },
        outputSchema: false,
        providerResilience: {
          maxRetries: globalRetries,
          baseDelayMs: 0,
          maxDelayMs: 0,
          requestTimeoutMs: 0,
        },
      },
    });
    try {
      const result = await agent.processTurn({
        content: "Synthetic question",
        message: mockCommMessage({ isMaster: master }),
        configuration: { models },
        tools: [],
      });
      expect(requests).toHaveLength(expectedCalls);
      // Each attempt arms the harness request deadline and the default first-response deadline.
      expect(armed).toEqual(Array(expectedCalls).fill([31000, 30000]).flat());
      expect(timeout).not.toHaveBeenCalledWith(19000);
      expect(
        new Set(
          await Promise.all(
            requests.map(async (request) => (await request.json()).model)
          )
        )
      ).toEqual(new Set(["selected"]));
      if (expectedCalls === 1) {
        if (master) expect(JSON.stringify(result)).toContain("限流");
        else expect(result.length).toBeGreaterThan(0);
        expect(JSON.stringify(result)).not.toContain("已自动重试");
      } else expect(JSON.stringify(result)).toContain("eventual answer");
    } finally {
      timeout.mockRestore();
      await agent.dispose();
      await models.release();
      lease.release();
      runtime.dispose();
    }
  }
);
