/**
 * #1250 chat-purpose-no-fallback: chat, summary, agent and adapter/scene overrides answer from
 * their own fallbacks when the selected model fails with quota / billing / auth.
 */
import { ModelAvailabilityRegistry, createResilientCompletionPort, type Context } from '@zhin.js/ai';
import { normalizeProviderGraph, type ExecutionBinding, type ProviderExecution } from '@zhin.js/ai/provider';
import { assistant, graphFixture, HOST } from '../../../ai/tests/provider/fixtures.js';
import { modelRuntimeFixture } from '../helpers/model-runtime.js';
import { TurnTraceCollector } from '../../src/trace/turn-trace.js';
import { traceModelFallback } from '../../src/model-runtime/purpose-fallback.js';

const dailyQuota = () => Object.assign(new Error('quota'), {
  statusCode: 429,
  responseBody: JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', details: [
    { violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }),
});
const unauthorized = () => Object.assign(new Error('bad key'), { statusCode: 401 });
const outage = () => Object.assign(new Error('outage'), { statusCode: 503 });

function graph() {
  const base = graphFixture();
  const owner = { rootId: 'root', ownerId: HOST, revision: 1 };
  const account = (id: string) => ({ ...owner, id, serviceId: 'service', incarnation: id, authentication: { method: 'none' } });
  const profile = (id: string, accountId: string) => ({ ...owner, id, accountId, model: 'text', parameters: {} });
  return normalizeProviderGraph({ ...base,
    accounts: { ...base.accounts, cnb: account('cnb'), deep: account('deep') },
    profiles: { ...base.profiles, cnb: profile('cnb', 'cnb'), deep: profile('deep', 'deep') },
    purposes: { defaults: { chat: 'text', chatFallbacks: ['cnb', 'deep'], summary: 'text', summaryFallbacks: ['deep'] },
      agents: { researcher: 'text' }, agentFallbacks: { researcher: ['deep'] },
      adapters: { qq: { chat: 'cnb', chatFallbacks: ['deep'] } },
      scenes: { 'github:repo': { chat: 'deep', chatFallbacks: ['cnb'] } } } });
}

/** Accounts listed in `failing` throw the given error; others answer with their account id. */
function setup(failing: Record<string, () => Error>) {
  const registry = new ModelAvailabilityRegistry();
  const answered: string[] = [];
  const executionFor = (binding: ExecutionBinding): ProviderExecution => ({ language: {
    generate: async () => {
      const fail = failing[binding.account.id];
      if (fail) throw fail();
      answered.push(binding.account.id);
      return { ...assistant(`from ${binding.account.id}`), provider: binding.account.id };
    },
    stream: async () => (async function* () { yield { type: 'done' as const, message: assistant() }; })(),
  } });
  const fixture = modelRuntimeFixture({ graph: graph(), executionFor, modelAvailability: registry });
  return { ...fixture, registry, answered };
}
const context = { messages: [] } as unknown as Context;

describe('purpose fallbacks in the model runtime (#1250)', () => {
  it('answers chat from the first fallback when the primary quota is exhausted, and records the switch', async () => {
    const { acquire, answered, registry } = setup({ account: dailyQuota });
    const scope = await acquire();
    try {
      const answer = await scope.chat.completion.complete(scope.chat.model, context);
      expect(answer.provider).toBe('cnb');
      expect(answered).toEqual(['cnb']);
      expect(scope.modelFallbacks?.()).toEqual([expect.objectContaining({ purpose: 'chat', reason: 'quota_exhausted', phase: 'request',
        from: expect.objectContaining({ profileId: 'text' }), to: expect.objectContaining({ profileId: 'cnb' }), notice: '本轮由备用模型回答' })]);
      expect(registry.unavailable('account', 'text')?.reason).toBe('quota_exhausted');
    } finally { await scope.release(); }
  });

  it('selects the fallback up front while the primary is skipped, until its reset', async () => {
    const { acquire, registry, answered } = setup({});
    registry.markUnavailable({ accountId: 'account', model: 'text', reason: 'quota_exhausted', until: Date.now() + 60_000 });
    const scope = await acquire();
    try {
      expect(scope.chat.binding.profile.id).toBe('cnb');
      expect(scope.modelFallbacks?.()).toEqual([expect.objectContaining({ phase: 'selection', to: expect.objectContaining({ profileId: 'cnb' }) })]);
      await scope.chat.completion.complete(scope.chat.model, context);
      expect(answered).toEqual(['cnb']);
    } finally { await scope.release(); }
    registry.markUnavailable({ accountId: 'account', model: 'text', reason: 'quota_exhausted', until: Date.now() - 1 });
    registry.clear();
    const later = await acquire();
    try { expect(later.chat.binding.profile.id).toBe('text'); } finally { await later.release(); }
  });

  it('honours the adapter override chain, the scene override chain and the agent chain', async () => {
    const { acquire, answered } = setup({ cnb: unauthorized, deep: dailyQuota, account: dailyQuota });
    const adapter = await acquire({ adapterKey: 'qq' });
    try {
      // qq: cnb (auth) → deep (quota): nothing left, the last error stands.
      await expect(adapter.chat.completion.complete(adapter.chat.model, context)).rejects.toMatchObject({ statusCode: 429 });
      expect(adapter.modelFallbacks?.().map(event => event.to.profileId)).toEqual(['deep']);
    } finally { await adapter.release(); }
    expect(answered).toEqual([]);

    const ok = setup({ cnb: unauthorized });
    const scene = await ok.acquire({ adapterKey: 'qq', sceneKey: 'github:repo' });
    try {
      expect(scene.chat.binding.profile.id).toBe('deep');
      expect((await scene.chat.completion.complete(scene.chat.model, context)).provider).toBe('deep');
    } finally { await scene.release(); }

    const agents = setup({ account: dailyQuota });
    const agent = await agents.acquire({}, 'researcher');
    try {
      expect(agent.purpose).toBe('agent:researcher');
      expect((await agent.chat.completion.complete(agent.chat.model, context)).provider).toBe('deep');
      expect(agent.modelFallbacks?.()[0]).toMatchObject({ purpose: 'agent:researcher', to: { profileId: 'deep' } });
    } finally { await agent.release(); }
  });

  it('gives summary its own chain', async () => {
    const { acquire } = setup({ account: dailyQuota });
    const scope = await acquire();
    try {
      const summary = await scope.summary!.resolve();
      expect((await summary.completion.complete(summary.model, context)).provider).toBe('deep');
      expect(scope.modelFallbacks?.()[0]).toMatchObject({ purpose: 'summary', to: { profileId: 'deep' } });
    } finally { await scope.release(); }
  });

  it('does not switch on errors another account cannot fix', async () => {
    const { acquire, answered, registry } = setup({ account: outage });
    const scope = await acquire();
    try {
      const resilient = createResilientCompletionPort(scope.chat.completion, { config: { maxRetries: 1 }, sleep: async () => undefined });
      await expect(resilient.complete(scope.chat.model, context)).rejects.toThrow();
      expect(answered).toEqual([]);
      expect(scope.modelFallbacks?.()).toEqual([]);
      expect(registry.list()).toEqual([]);
    } finally { await scope.release(); }
  });

  it('notes 「本轮由备用模型回答」 in the turn trace', async () => {
    const { acquire } = setup({ account: dailyQuota });
    const scope = await acquire();
    const trace = new TurnTraceCollector({ turnId: 't', sessionKey: 's' });
    try {
      await scope.chat.completion.complete(scope.chat.model, context);
      scope.observeModelFallback?.(event => trace.note({ kind: 'model_fallback', fallback: traceModelFallback(event) }));
      trace.finalize();
      const snapshot = trace.snapshot();
      expect(snapshot.model_fallbacks).toEqual([expect.objectContaining({ purpose: 'chat', from_profile_id: 'text', to_profile_id: 'cnb',
        reason: 'quota_exhausted', phase: 'request', notice: '本轮由备用模型回答' })]);
      expect(snapshot.timeline.some(entry => entry.kind === 'model_fallback' && entry.detail.startsWith('本轮由备用模型回答'))).toBe(true);
    } finally { await scope.release(); }
  });
});
