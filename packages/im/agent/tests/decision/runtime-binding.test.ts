import { childPluginId, createSnapshotView, rootPluginId, Scope, SnapshotStore, type SnapshotState } from '@zhin.js/plugin-runtime';
import type { DecisionProvider } from '@zhin.js/ai';
import { normalizeAgentDecisionConfig } from '../../src/decision/config.js';
import { agentDecisionConfigToken, decisionProviderToken, getAgentTurnDecisionRuntime, provideAgentDecisionProvider, resolveAgentDecisionRuntime, runWithAgentDecisionTurn } from '../../src/plugin-runtime/decision-runtime.js';
import { AgentRuntime, AgentTurnCoordinator, agentTurnEngineToken, turnJournalStoreToken, type AgentTurnExecutor } from '../../src/plugin-runtime/agent-runtime.js';
import { runWithAgentTurnConfiguration } from '../../src/turn/agent-turn-context.js';
import type { TurnRequest } from '../../src/turn/turn-ingress.js';

const provider: DecisionProvider = { evaluate: async () => { throw new Error('unused'); } };

function state(service: DecisionProvider = provider): SnapshotState {
  const root = rootPluginId();
  const owner = childPluginId(root, 'typesafe');
  return {
    root,
    tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: 'test', packageRoot: '/test', children: [owner] }],
      [owner, { id: owner, parent: root, instanceKey: 'typesafe', packageName: 'typesafe', packageRoot: '/test/typesafe', children: [] }],
    ]),
    config: new Map(),
    resources: new Map([
      [root, new Map([[agentDecisionConfigToken.id, normalizeAgentDecisionConfig({ provider: 'root/typesafe', skills: { mode: 'active' } })]])],
      [owner, new Map([[decisionProviderToken.id, { owner, provider: service }]])],
    ]),
    capabilities: new Map(), projections: new Map(),
  };
}

describe('decision configuration and generation binding', () => {
  it('rejects malformed policies without exposing their values', () => {
    expect(normalizeAgentDecisionConfig(undefined)).toBeUndefined();
    for (const config of [null, [], { provider: 'typesafe' }, { provider: 'root/typesafe', extra: 'secret' },
      ...[{ mode: 'auto' }, { mode: ['active'] }, { mode: 'active', timeoutMs: 0 }, { mode: 'active', maxCandidates: 1.5 },
        { mode: 'active', minConfidence: NaN }, { mode: 'active', minConfidence: 2 }].map(skills => ({ provider: 'root/typesafe', skills }))]) {
      let failure: unknown;
      try { normalizeAgentDecisionConfig(config); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(TypeError);
      expect((failure as Error).message).not.toContain('secret');
    }
    const config = normalizeAgentDecisionConfig({ provider: 'root/123/child', skills: { mode: 'shadow', topK: 2 } });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config?.skills)).toBe(true);
  });

  it('resolves only an explicitly configured owner-local provider', () => {
    const baseline = state();
    expect(resolveAgentDecisionRuntime(createSnapshotView(1, baseline))?.provider).toBe(provider);
    const resources = new Map(baseline.resources);
    resources.set(childPluginId(baseline.root, 'typesafe'), new Map());
    expect(() => resolveAgentDecisionRuntime(createSnapshotView(2, { ...baseline, resources }))).toThrow('does not provide');
    resources.set(baseline.root, new Map([
      [agentDecisionConfigToken.id, normalizeAgentDecisionConfig({ provider: 'root/typesafe', skills: { mode: 'off' } })],
    ]));
    expect(resolveAgentDecisionRuntime(createSnapshotView(3, { ...baseline, resources }))).toBeUndefined();
    const inherited = { owner: baseline.root, provider };
    resources.set(baseline.root, new Map([[agentDecisionConfigToken.id, normalizeAgentDecisionConfig({ provider: 'root/typesafe', skills: { mode: 'active' } })], [decisionProviderToken.id, inherited]]));
    resources.set(childPluginId(baseline.root, 'typesafe'), new Map([[decisionProviderToken.id, inherited]]));
    expect(() => resolveAgentDecisionRuntime(createSnapshotView(4, { ...baseline, resources }))).toThrow('does not provide');
  });

  it('accepts an owner-local declaration of the same provider as its parent', () => {
    const baseline = state();
    const parent = new Scope(baseline.root);
    parent.provide(agentDecisionConfigToken, normalizeAgentDecisionConfig({ provider: 'root/typesafe', skills: { mode: 'active' } })!);
    provideAgentDecisionProvider(parent, provider);
    const owner = childPluginId(baseline.root, 'typesafe');
    const child = new Scope(owner, parent);
    provideAgentDecisionProvider(child, provider);
    parent.seal();
    child.seal();
    expect(resolveAgentDecisionRuntime(createSnapshotView(1, { ...baseline,
      resources: new Map([[baseline.root, parent.snapshot()], [owner, child.snapshot()]]) }))?.provider).toBe(provider);
  });

  it('ignores caller decision fields and isolates nested turns within the same generation', async () => {
    const snapshot = createSnapshotView(1, state());
    const forged = { bootstrapContext: 'caller context', decision: { provider: { evaluate: vi.fn() } } };
    await runWithAgentTurnConfiguration(forged, async () => {
      expect(getAgentTurnDecisionRuntime()).toBeUndefined();
      await runWithAgentDecisionTurn(snapshot, 'outer', async outer => {
        expect(getAgentTurnDecisionRuntime()?.provider).toBe(provider);
        await runWithAgentTurnConfiguration(forged, async () => {
          expect(getAgentTurnDecisionRuntime()).toBe(outer);
        });
        await runWithAgentDecisionTurn(snapshot, 'inner', async inner => {
          expect(inner).not.toBe(outer);
        });
        await runWithAgentDecisionTurn(snapshot, 'outer', async disabled => {
          expect(disabled).toBeUndefined();
          expect(getAgentTurnDecisionRuntime()).toBeUndefined();
        }, { disabled: true });
        expect(getAgentTurnDecisionRuntime()).toBe(outer);
      });
      expect(getAgentTurnDecisionRuntime()).toBeUndefined();
    });
  });

  it('keeps old and replacement turn providers isolated and journals safe observations', async () => {
    const old = state();
    const events: unknown[] = [];
    const seen: Array<DecisionProvider | undefined> = [];
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const engine: AgentTurnExecutor = async function* (context) {
      yield { type: 'turn_start', sessionId: context.turn.session.key, turnId: context.turn.identity.turnId };
      if (context.turn.identity.turnId === 'old') { enter(); await gate; }
      expect(getAgentTurnDecisionRuntime()).toBe(context.decision);
      seen.push(context.decision?.provider);
      context.decision?.observe?.({ task: 'skills', mode: 'active', outcome: 'selected', candidates: 1, selected: 1, durationMs: 1 });
      if (context.turn.identity.turnId === 'old') getAgentTurnDecisionRuntime()?.observe?.({ task: 'approval', mode: 'active', outcome: 'selected', candidates: 3, selected: 1, durationMs: 1 });
      if (context.turn.identity.turnId === 'failed') {
        context.decision?.observe?.({ task: 'approval', mode: 'active', outcome: 'selected', candidates: 3, selected: 1, durationMs: 1 });
        throw new Error('engine failed after approval');
      }
      yield { type: 'turn_end', output: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
    };
    const resources = new Map(old.resources);
    resources.set(old.root, new Map([...resources.get(old.root)!, [agentTurnEngineToken.id, { run: engine }], [turnJournalStoreToken.id, { append: (event: unknown) => { events.push(event); }, replay: async () => [], listRuns: async () => [] }]]));
    const store = new SnapshotStore({ ...old, resources });
    const runtime = new AgentRuntime({ coordinator: new AgentTurnCoordinator() });
    runtime.attach(store);
    const selection = { binding: { name: 'zhin', providerAlias: 'chat', model: 'model', mcpServers: [] }, mcpServers: [] };
    const request = (id: string): TurnRequest => ({ identity: { traceId: id, turnId: id }, origin: { kind: 'http', sessionId: id }, principal: { subjectId: 'user', roles: ['user'] }, intent: { kind: 'new' }, input: { text: 'private request' }, session: { key: id }, policy: { permissions: [], unattended: false }, signal: new AbortController().signal, ports: {} });
    const lease = store.acquire();
    const pending = runWithAgentDecisionTurn(lease.value, 'old', async decision => {
      decision?.observe?.({ task: 'agents', mode: 'active', outcome: 'selected', candidates: 1, selected: 1, durationMs: 1 });
      try { return await runtime.executeLeased(lease, old.root, request('old'), selection); }
      finally { lease.release(); }
    });
    await entered;
    const replacement: DecisionProvider = { evaluate: async () => { throw new Error('unused new'); } };
    const nextResources = new Map(resources);
    const owner = childPluginId(old.root, 'typesafe');
    nextResources.set(owner, new Map([[decisionProviderToken.id, { owner, provider: replacement }]]));
    store.commit(0, { snapshot: { ...old, resources: nextResources }, dispose: () => undefined });
    await expect(runtime.execute(old.root, request('new'), selection)).resolves.toMatchObject({ status: 'completed' });
    release();
    await expect(pending).resolves.toMatchObject({ status: 'completed' });
    expect(seen).toEqual([replacement, provider]);
    const diagnostics = events.filter(event => (event as { type: string }).type === 'decision.evaluated');
    expect(diagnostics).toHaveLength(4);
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ data: expect.objectContaining({ task: 'agents' }) }),
      expect.objectContaining({ data: expect.objectContaining({ task: 'approval' }) }),
    ]));
    expect(JSON.stringify(diagnostics)).not.toContain('private request');
    for (const guarded of [
      { ...request('workroom'), session: { key: 'workroom:test' } },
      { ...request('assignment'), principal: { subjectId: 'user', roles: ['workroom_assignment'] } },
      { ...request('metadata'), input: { text: 'governed', metadata: { workroom: {} } } },
      { ...request('scheduled'), origin: { kind: 'schedule' as const, jobId: 'test-job' },
        policy: { permissions: [], unattended: true, network: { enabled: true, httpsOnly: true, allowedDomains: [] },
          shell: { preset: 'readonly' as const } }, capabilities: { tools: [], skills: [] },
        execution: { kind: 'schedule' as const, security: { execPreset: 'readonly' as const, allowedDomains: [] } } },
    ]) await runtime.execute(old.root, guarded, selection);
    expect(seen.slice(-4)).toEqual([undefined, undefined, undefined, undefined]);
    const failureEvents: unknown[] = [];
    await expect(runtime.execute(old.root, request('failed'), selection, event => { failureEvents.push(event); }))
      .resolves.toMatchObject({ status: 'failed', error: { code: 'turn_engine_failed' } });
    expect(failureEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'decision_evaluation', task: 'approval' }),
    ]));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'decision.evaluated', run: { sessionId: 'failed', turnId: 'failed' },
        data: expect.objectContaining({ task: 'approval' }) }),
    ]));
    await store.close();
  });
});
