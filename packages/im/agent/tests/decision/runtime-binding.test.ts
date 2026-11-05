import { createSnapshotView, rootPluginId, SnapshotStore, type SnapshotState, type TokenId } from '@zhin.js/plugin-runtime';
import { createInferenceRuntime, defineProvider, normalizeProviderGraph, type DecisionPurpose, type InferenceOperationScope } from '@zhin.js/ai/provider';
import type { DecisionResult } from '@zhin.js/ai';
import { normalizeAgentDecisionConfig } from '../../src/decision/config.js';
import { getAgentTurnDecisionRuntime, resolveAgentDecisionRuntime, runWithAgentDecisionTurn } from '../../src/plugin-runtime/decision-runtime.js';
import { runWithAgentTurnConfiguration } from '../../src/turn/agent-turn-context.js';
import { AgentRuntime, AgentTurnCoordinator, agentTurnEngineToken, turnJournalStoreToken, type AgentTurnExecutor } from '../../src/plugin-runtime/agent-runtime.js';
import { turnModelPortToken } from '../../src/model-runtime/turn-resource.js';
import type { ModelExecutionScope } from '../../src/model-runtime/types.js';
import type { TurnRequest } from '../../src/turn/turn-ingress.js';

const tasks = ['skills', 'tools', 'memory', 'agents', 'approval', 'ambient'] as const;
const context = { rootId: 'root', hostOwnerId: 'host:test', ownerId: 'host:test', operationId: 'operation', sessionKey: 'session' };
function snapshot() {
  const root = rootPluginId();
  const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'root', packageRoot: '/', children: [] }]]),
    config: new Map(), resources: new Map([[root, new Map()]]), capabilities: new Map(), projections: new Map() };
  return createSnapshotView(1, state);
}
async function fixture() {
  const base = { rootId: 'root', ownerId: 'host:test', revision: 1 };
  const graph = normalizeProviderGraph({ rootId: 'root', revision: 1,
    services: { service: { ...base, id: 'service', driver: { id: 'fixture', owner: 'root/providers', contractVersion: '1' }, options: {}, models: {
      first: { id: 'first', kinds: ['decision'], protocol: 'native-decision' }, second: { id: 'second', kinds: ['decision'], protocol: 'native-decision' },
    } } }, accounts: { account: { ...base, id: 'account', serviceId: 'service', incarnation: 'initial', authentication: { method: 'none' } } },
    profiles: Object.fromEntries(['first', 'second'].map(id => [id, { ...base, id, accountId: 'account', model: id, parameters: {} }])),
    purposes: { defaults: {}, decisions: Object.fromEntries(tasks.map((task, index) => [task, { profile: index % 2 ? 'second' : 'first', mode: 'active' }])) },
  });
  const models: string[] = [];
  const definition = defineProvider({ id: 'fixture', contractVersion: '1', serviceSchema: { parse: (value: unknown) => value },
    authentication: { methods: ['none'] }, targets: () => ({ authentication: [], inference: [] }), models: service => service.models,
    createExecution: input => ({ decision: { evaluate: async ({ questions }) => {
      models.push(input.binding.model.id);
      return { model: input.binding.model.id, usage: { inputTokens: 2, outputTokens: 1 },
        answers: Object.fromEntries(Object.keys(questions).map(key => [key, { type: 'noul', noul: 0.8 }])) } as DecisionResult<typeof questions>;
    } } }),
  });
  const runtime = createInferenceRuntime({ repository: { readGraph: async () => graph },
    drivers: { acquire: async () => ({ definition, reference: graph.services.service.driver, release() {} }) },
    credentials: () => ({ bindRequest: (input: { request: Request }) => input.request, authorize: async () => ({ headers: {}, revision: '1' }) }), fetch: () => async () => { throw new Error('unexpected network'); } });
  const scope = await runtime.openScope({ context });
  return { models, scope, runtime, decisionScope: { graph: scope.graph, inference: scope.client, resolve: scope.resolve } };
}

it('validates per-task Profile policies and rejects the removed global Provider selector', () => {
  expect(normalizeAgentDecisionConfig(undefined)).toBeUndefined();
  for (const input of [null, [], { provider: 'root/typesafe' }, { skills: { mode: 'active' } },
    { skills: { profile: 'first', mode: 'auto' } }, { tools: { profile: 'first', mode: 'active', timeoutMs: 0 } },
    { memory: { profile: 'first', mode: 'shadow', minConfidence: 2 } }]) expect(() => normalizeAgentDecisionConfig(input)).toThrow(TypeError);
  const policy = normalizeAgentDecisionConfig({ skills: { profile: 'first', mode: 'shadow' }, ambient: { mode: 'off' } });
  expect(policy).toEqual({ skills: { profile: 'first', mode: 'shadow' }, ambient: { mode: 'off' } });
  expect(Object.isFrozen(policy)).toBe(true); expect(Object.isFrozen(policy?.skills)).toBe(true);
});

it('selects each of six Decision task Profiles at actual use through the unified inference runtime', async () => {
  const fixture_ = await fixture();
  const runtime = resolveAgentDecisionRuntime(fixture_.decisionScope);
  try {
    for (const task of tasks) {
      const response = await runtime!.forTask(task)!.evaluate({ state: null, questions: { allowed: { type: 'noul' } } }, { signal: new AbortController().signal });
      expect(response.model).toBe(fixture_.scope.graph.purposes.decisions![task]!.profile);
      expect(response.answers.allowed.noul).toBe(0.8);
    }
    expect(fixture_.models).toEqual(['first', 'second', 'first', 'second', 'first', 'second']);
    await expect(runtime!.forTask('tools')!.evaluate({ model: 'first', state: null, questions: { allowed: { type: 'noul' } } }, { signal: new AbortController().signal })).rejects.toThrow('fixed');
    expect(fixture_.models).toHaveLength(6);
  } finally { await fixture_.scope.close(); }
});

it('keeps decision scope out of caller-supplied turn data, isolates nested contexts and observes only the active runtime', async () => {
  const fixture_ = await fixture(), held = snapshot();
  const observations: unknown[] = [];
  try {
    await runWithAgentTurnConfiguration({ bootstrapContext: 'caller data' }, async () => {
      expect(getAgentTurnDecisionRuntime()).toBeUndefined();
      await runWithAgentDecisionTurn({ snapshot: held, turnId: 'outer', models: fixture_.decisionScope, observe: value => observations.push(value) }, async outer => {
        expect(getAgentTurnDecisionRuntime()).toBe(outer);
        await runWithAgentDecisionTurn({ snapshot: held, turnId: 'inner', models: fixture_.decisionScope, disabled: true }, async disabled => {
          expect(disabled).toBeUndefined(); expect(getAgentTurnDecisionRuntime()).toBeUndefined();
        });
        expect(getAgentTurnDecisionRuntime()).toBe(outer);
        outer!.observe!({ task: 'tools', mode: 'active', outcome: 'selected', candidates: 1, selected: 1, durationMs: 1 });
      });
      expect(getAgentTurnDecisionRuntime()).toBeUndefined();
    });
    expect(observations).toHaveLength(1); expect(fixture_.models).toHaveLength(0);
  } finally { await fixture_.scope.close(); }
});

it('keeps retained and replacement turn scopes isolated and journals observations even when the engine fails', async () => {
  const old = await fixture(), replacement = await fixture();
  const held = snapshot(), events: unknown[] = [], seen: unknown[] = [];
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  function models(source: typeof old): ModelExecutionScope {
    const binding = { graphRevision: source.scope.graph.revision, profile: source.scope.graph.profiles.first,
      account: source.scope.graph.accounts.account, service: source.scope.graph.services.service, model: source.scope.graph.services.service.models.first };
    const unused = async (): Promise<never> => { throw new Error('This journal fixture must not request chat inference'); };
    return { ...source.decisionScope, context, chat: { binding,
      model: { id: 'chat-fixture', provider: 'fixture', api: 'fixture', input: ['text'], contextWindow: 100, maxTokens: 100 },
      completion: { complete: unused, completeSimple: unused } }, policyRevision: 1, summarySource: 'deployment-chat', release: async () => {} };
  }
  const oldModels = models(old), nextModels = models(replacement);
  const engine: AgentTurnExecutor = async function* (input) {
    yield { type: 'turn_start', sessionId: input.turn.session.key, turnId: input.turn.identity.turnId };
    if (input.turn.identity.turnId === 'old') { enter(); await gate; }
    expect(getAgentTurnDecisionRuntime()).toBe(input.decision);
    seen.push(input.decision?.config);
    input.decision?.observe?.({ task: 'skills', mode: 'active', outcome: 'selected', candidates: 1, selected: 1, durationMs: 1 });
    if (input.turn.identity.turnId === 'old' || input.turn.identity.turnId === 'failed') {
      input.decision?.observe?.({ task: 'approval', mode: 'active', outcome: 'selected', candidates: 3, selected: 1, durationMs: 1 });
    }
    if (input.turn.identity.turnId === 'failed') throw new Error('engine failed after approval');
    yield { type: 'turn_end', output: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
  };
  const rootResources = (selected: ModelExecutionScope) => new Map<TokenId, unknown>([
    [turnModelPortToken.id, { acquire: async () => selected }], [agentTurnEngineToken.id, { run: engine }],
    [turnJournalStoreToken.id, { append: (event: unknown) => { events.push(event); }, replay: async () => [], listRuns: async () => [] }],
  ]);
  const initial = { ...held, resources: new Map([[held.root, rootResources(oldModels)]]) };
  const store = new SnapshotStore(initial), runtime = new AgentRuntime({ coordinator: new AgentTurnCoordinator() }); runtime.attach(store);
  const request = (id: string): TurnRequest => ({ identity: { traceId: id, turnId: id }, origin: { kind: 'http', sessionId: id },
    principal: { subjectId: 'user', roles: ['user'] }, intent: { kind: 'new' }, input: { text: 'private request' }, session: { key: id },
    policy: { permissions: [], unattended: false }, signal: new AbortController().signal, ports: {} });
  const selection = { binding: { name: 'zhin', mcpServers: [] }, mcpServers: [] };
  const lease = store.acquire();
  const pending = runWithAgentDecisionTurn({ snapshot: lease.value, turnId: 'old', models: oldModels }, async decision => {
    decision?.observe?.({ task: 'agents', mode: 'active', outcome: 'selected', candidates: 1, selected: 1, durationMs: 1 });
    try { return await runtime.executeLeased(lease, held.root, request('old'), selection); } finally { lease.release(); }
  });
  await entered;
  store.commit(0, { snapshot: { ...initial, resources: new Map([[held.root, rootResources(nextModels)]]) }, dispose() {} });
  await expect(runtime.execute(held.root, request('new'), selection)).resolves.toMatchObject({ status: 'completed' });
  release(); await expect(pending).resolves.toMatchObject({ status: 'completed' });
  expect(seen[0]).toBe(nextModels.graph.purposes.decisions); expect(seen[1]).toBe(oldModels.graph.purposes.decisions);
  expect(seen[0]).not.toBe(seen[1]);
  const diagnostics = events.filter(event => (event as { type: string }).type === 'decision.evaluated');
  expect(diagnostics).toHaveLength(4); expect(JSON.stringify(diagnostics)).not.toContain('private request');
  const output: unknown[] = [];
  await expect(runtime.execute(held.root, request('failed'), selection, event => { output.push(event); })).resolves.toMatchObject({ status: 'failed' });
  expect(output).toContainEqual(expect.objectContaining({ type: 'decision_evaluation', task: 'approval' }));
  expect(events).toContainEqual(expect.objectContaining({ type: 'decision.evaluated', run: { sessionId: 'failed', turnId: 'failed' }, data: expect.objectContaining({ task: 'approval' }) }));
  for (const guarded of [
    { ...request('workroom'), session: { key: 'workroom:test' } },
    { ...request('assignment'), principal: { subjectId: 'user', roles: ['workroom_assignment'] } },
    { ...request('metadata'), input: { text: 'governed', metadata: { workroom: {} } } },
    { ...request('scheduled'), origin: { kind: 'schedule' as const, jobId: 'test-job' },
      policy: { permissions: [], unattended: true, network: { enabled: true, httpsOnly: true, allowedDomains: [] }, shell: { preset: 'readonly' as const } },
      capabilities: { tools: [], skills: [] }, execution: { kind: 'schedule' as const, security: { execPreset: 'readonly' as const, allowedDomains: [] } } },
  ]) await runtime.execute(held.root, guarded, selection);
  expect(seen.slice(-4)).toEqual([undefined, undefined, undefined, undefined]);
  await store.close(); await old.scope.close(); await replacement.scope.close();
});
