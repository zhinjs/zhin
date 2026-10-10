import { childPluginId, createSnapshotView, rootPluginId, SnapshotStore, type SnapshotState } from '@zhin.js/plugin-runtime';
import type { DecisionProvider } from '@zhin.js/ai';
import { normalizeAgentDecisionConfig } from '../../src/decision/config.js';
import { agentDecisionConfigToken, decisionProviderToken, resolveAgentDecisionRuntime } from '../../src/plugin-runtime/decision-runtime.js';
import { AgentRuntime, AgentTurnCoordinator, agentTurnEngineToken, turnJournalStoreToken, type AgentTurnExecutor } from '../../src/plugin-runtime/agent-runtime.js';
import { getAgentTurnConfiguration } from '../../src/turn/agent-turn-context.js';
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
      [owner, new Map([[decisionProviderToken.id, service]])],
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
      expect(() => normalizeAgentDecisionConfig(config)).toThrow();
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
    resources.set(baseline.root, new Map([[agentDecisionConfigToken.id, normalizeAgentDecisionConfig({ provider: 'root/typesafe', skills: { mode: 'active' } })], [decisionProviderToken.id, provider]]));
    resources.set(childPluginId(baseline.root, 'typesafe'), new Map([[decisionProviderToken.id, provider]]));
    expect(() => resolveAgentDecisionRuntime(createSnapshotView(4, { ...baseline, resources }))).toThrow('does not provide');
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
      expect(getAgentTurnConfiguration()?.decision).toBe(context.decision);
      seen.push(context.decision?.provider);
      context.decision?.observe?.({ task: 'skills', mode: 'active', outcome: 'selected', candidates: 1, selected: 1, durationMs: 1 });
      yield { type: 'turn_end', output: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
    };
    const resources = new Map(old.resources);
    resources.set(old.root, new Map([...resources.get(old.root)!, [agentTurnEngineToken.id, { run: engine }], [turnJournalStoreToken.id, { append: (event: unknown) => { events.push(event); }, replay: async () => [], listRuns: async () => [] }]]));
    const store = new SnapshotStore({ ...old, resources });
    const runtime = new AgentRuntime({ coordinator: new AgentTurnCoordinator() });
    runtime.attach(store);
    const selection = { binding: { name: 'zhin', providerAlias: 'chat', model: 'model', mcpServers: [] }, mcpServers: [] };
    const request = (id: string): TurnRequest => ({ identity: { traceId: id, turnId: id }, origin: { kind: 'http', sessionId: id }, principal: { subjectId: 'user', roles: ['user'] }, intent: { kind: 'new' }, input: { text: 'private request' }, session: { key: id }, policy: { permissions: [], unattended: false }, signal: new AbortController().signal, ports: {} });
    const pending = runtime.execute(old.root, request('old'), selection);
    await entered;
    const replacement: DecisionProvider = { evaluate: async () => { throw new Error('unused new'); } };
    const nextResources = new Map(resources);
    nextResources.set(childPluginId(old.root, 'typesafe'), new Map([[decisionProviderToken.id, replacement]]));
    store.commit(0, { snapshot: { ...old, resources: nextResources }, dispose: () => undefined });
    await expect(runtime.execute(old.root, request('new'), selection)).resolves.toMatchObject({ status: 'completed' });
    release();
    await expect(pending).resolves.toMatchObject({ status: 'completed' });
    expect(seen).toEqual([replacement, provider]);
    const diagnostics = events.filter(event => (event as { type: string }).type === 'decision.evaluated');
    expect(diagnostics).toHaveLength(2);
    expect(JSON.stringify(diagnostics)).not.toContain('private request');
    for (const guarded of [
      { ...request('workroom'), session: { key: 'workroom:test' } },
      { ...request('assignment'), principal: { subjectId: 'user', roles: ['workroom_assignment'] } },
    ]) await runtime.execute(old.root, guarded, selection);
    expect(seen.slice(-2)).toEqual([undefined, undefined]);
    await store.close();
  });
});
