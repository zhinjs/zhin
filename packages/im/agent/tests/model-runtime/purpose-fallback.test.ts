/**
 * #1250 chat-purpose-no-fallback: chat, summary, agent and adapter/scene overrides answer from
 * their own fallbacks when the selected model fails with quota / billing / auth.
 */
import { ModelAvailabilityRegistry, createResilientCompletionPort, type Context } from '@zhin.js/ai';
import { normalizeProviderGraph, type ExecutionBinding, type ProviderExecution } from '@zhin.js/ai/provider';
import { assistant, graphFixture, HOST } from '../../../ai/tests/provider/fixtures.js';
import { modelRuntimeFixture } from '../helpers/model-runtime.js';
import { TurnTraceCollector } from '../../src/trace/turn-trace.js';
import { traceModelFallback, traceModelFallbackSkip, turnUsageTarget } from '../../src/model-runtime/purpose-fallback.js';

const dailyQuota = () => Object.assign(new Error('quota'), {
  statusCode: 429,
  responseBody: JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', details: [
    { violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }),
});
const unauthorized = () => Object.assign(new Error('bad key'), { statusCode: 401 });
const outage = () => Object.assign(new Error('outage'), { statusCode: 503 });
const badRequest = () => Object.assign(new Error('unsupported parameter'), { statusCode: 400 });

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
      expect(answer.content).toEqual([{ type: 'text', text: 'from cnb' }]);
      // Usage is attributed to the answering Profile's service.
      expect(answer.provider).toBe('service');
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
      await expect(adapter.chat.completion.complete(adapter.chat.model, context)).rejects.toMatchObject({ kind: 'quota_exhausted' });
      expect(adapter.modelFallbacks?.().map(event => event.to.profileId)).toEqual(['deep']);
    } finally { await adapter.release(); }
    expect(answered).toEqual([]);

    const ok = setup({ cnb: unauthorized });
    const scene = await ok.acquire({ adapterKey: 'qq', sceneKey: 'github:repo' });
    try {
      expect(scene.chat.binding.profile.id).toBe('deep');
      expect((await scene.chat.completion.complete(scene.chat.model, context)).content).toEqual([{ type: 'text', text: 'from deep' }]);
    } finally { await scene.release(); }

    const agents = setup({ account: dailyQuota });
    const agent = await agents.acquire({}, 'researcher');
    try {
      expect(agent.purpose).toBe('agent:researcher');
      expect((await agent.chat.completion.complete(agent.chat.model, context)).content).toEqual([{ type: 'text', text: 'from deep' }]);
      expect(agent.modelFallbacks?.()[0]).toMatchObject({ purpose: 'agent:researcher', to: { profileId: 'deep' } });
    } finally { await agent.release(); }
  });

  it('gives summary its own chain', async () => {
    const { acquire } = setup({ account: dailyQuota });
    const scope = await acquire();
    try {
      const summary = await scope.summary!.resolve();
      expect((await summary.completion.complete(summary.model, context)).content).toEqual([{ type: 'text', text: 'from deep' }]);
      expect(scope.modelFallbacks?.()[0]).toMatchObject({ purpose: 'summary', to: { profileId: 'deep' } });
    } finally { await scope.release(); }
  });

  it('declares the summary candidate as the Profile that will answer', async () => {
    const { acquire, registry } = setup({});
    registry.markUnavailable({ accountId: 'account', model: 'text', reason: 'quota_exhausted', until: Date.now() + 60_000 });
    const scope = await acquire();
    try {
      expect(scope.summary?.binding.profile.id).toBe('deep');
      expect((await scope.summary!.resolve()).binding.profile.id).toBe('deep');
    } finally { await scope.release(); }
  });

  it('does not switch on a plain 403', async () => {
    const forbidden = () => Object.assign(new Error('region blocked'), { statusCode: 403 });
    const { acquire, answered, registry } = setup({ account: forbidden });
    const scope = await acquire();
    try {
      await expect(scope.chat.completion.complete(scope.chat.model, context)).rejects.toMatchObject({ statusCode: 403 });
      expect(answered).toEqual([]);
      expect(registry.list()).toEqual([]);
    } finally { await scope.release(); }
  });

  it('relabels the turn usage row only for a switch of the turn’s own purpose', async () => {
    const { acquire } = setup({ account: dailyQuota });
    const scope = await acquire();
    try {
      const summary = await scope.summary!.resolve();
      await summary.completion.complete(summary.model, context);
      const [summarySwitch] = scope.modelFallbacks?.() ?? [];
      expect(summarySwitch?.purpose).toBe('summary');
      expect(turnUsageTarget(scope, summarySwitch!)).toBeUndefined();
      await scope.chat.completion.complete(scope.chat.model, context);
      const chatSwitch = scope.modelFallbacks?.().find(event => event.purpose === 'chat');
      expect(turnUsageTarget(scope, chatSwitch!)).toEqual({ provider: 'service', model: 'text' });
    } finally { await scope.release(); }
  });

  it('does not switch on errors another account cannot fix', async () => {
    const { acquire, answered, registry } = setup({ account: badRequest });
    const scope = await acquire();
    try {
      const resilient = createResilientCompletionPort(scope.chat.completion, { config: { maxRetries: 1 }, sleep: async () => undefined });
      await expect(resilient.complete(scope.chat.model, context)).rejects.toThrow();
      expect(answered).toEqual([]);
      expect(scope.modelFallbacks?.()).toEqual([]);
      expect(registry.list()).toEqual([]);
    } finally { await scope.release(); }
  });

  it('switches on a 5xx only after the same-model retries, and traces it (#1250 b40)', async () => {
    const { acquire, answered, registry } = setup({ account: outage });
    const scope = await acquire();
    const trace = new TurnTraceCollector({ turnId: 't', sessionKey: 's' });
    try {
      const resilient = createResilientCompletionPort(scope.chat.completion, { config: { maxRetries: 1 }, sleep: async () => undefined });
      const answer = await resilient.complete(scope.chat.model, context);
      expect(answer.content).toEqual([{ type: 'text', text: 'from cnb' }]);
      expect(answered).toEqual(['cnb']);
      expect(scope.modelFallbacks?.()).toEqual([expect.objectContaining({ reason: 'server', phase: 'request',
        from: expect.objectContaining({ profileId: 'text' }), to: expect.objectContaining({ profileId: 'cnb' }) })]);
      // Operation-local: one operation does not skip the model for everyone.
      expect(registry.list()).toEqual([]);
      scope.observeModelFallback?.(event => trace.note({ kind: 'model_fallback', fallback: traceModelFallback(event) }));
      trace.finalize();
      expect(trace.snapshot().model_fallbacks).toEqual([expect.objectContaining({ reason: 'server', to_profile_id: 'cnb' })]);
    } finally { await scope.release(); }
  });

  it('traces fallback_skipped with the reason when no fallback can take over (#1250 b40)', async () => {
    const { acquire } = setup({ account: outage, cnb: outage, deep: outage });
    const scope = await acquire();
    const trace = new TurnTraceCollector({ turnId: 't', sessionKey: 's' });
    try {
      const resilient = createResilientCompletionPort(scope.chat.completion, { config: { maxRetries: 0 }, sleep: async () => undefined });
      // Fallbacks run their own retries with backoff: no real waiting in the test.
      vi.useFakeTimers();
      try {
        const failed = expect(resilient.complete(scope.chat.model, context)).rejects.toThrow();
        await vi.runAllTimersAsync();
        await failed;
      } finally { vi.useRealTimers(); }
      scope.observeModelFallbackSkipped?.(event => trace.note({ kind: 'model_fallback_skipped', skip: traceModelFallbackSkip(event) }));
      trace.finalize();
      const snapshot = trace.snapshot();
      expect(snapshot.model_fallbacks?.map(entry => entry.to_profile_id)).toBeUndefined();
      expect(snapshot.model_fallback_skips).toEqual([expect.objectContaining({ purpose: 'chat', profile_id: 'deep', kind: 'server', reason: 'exhausted' })]);
      expect(snapshot.timeline.some(entry => entry.kind === 'fallback_skipped' && entry.detail.includes('(exhausted)'))).toBe(true);
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
