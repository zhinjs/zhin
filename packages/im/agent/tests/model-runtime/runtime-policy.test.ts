import { vi, describe, expect, it } from 'vitest';
import { AiHttpTransport, createUserMessage } from '@zhin.js/ai';
import { AIService } from '../../src/service.js';
import { createAiCompletion } from '../../src/plugin-runtime/ai-completion.js';
import { ModelRuntimeService, type ModelRuntimeConfig } from '../../src/model-runtime/index.js';
import { normalizeRuntimePolicyRefsOverride, type RuntimePolicySnapshot } from '../../src/model-policy/index.js';

const rootId = '/runtime-policy-host', hostOwnerId = 'host-policy';
function config(summary?: string): ModelRuntimeConfig {
  return { modelCatalog: {
    connections: { connection: { revision: 1, sdk: 'openai-compatible', baseUrl: 'https://fake-provider.test/v1', secretRef: 'env://SYNTHETIC' } },
    models: Object.fromEntries(['old', 'next', 'summary', 'personal'].map(model => [model, { connectionId: 'connection', model, capabilities: { input: ['text'] as const } }])),
    presets: Object.fromEntries(['old', 'next', 'summary', 'personal'].map(model => [model, { modelId: model }])),
  }, modelPolicy: { defaults: { chat: 'old', ...(summary ? { summary } : {}) } },
  agents: { zhin: { nickname: 'Primary', permission: { task: { '*': 'deny' } } } } };
}
function fixture(options: { summary?: string } = {}) {
  let snapshot: RuntimePolicySnapshot = { revision: 0, refsOverride: normalizeRuntimePolicyRefsOverride({}) };
  const read = vi.fn(async () => snapshot);
  const requests: string[] = [];
  const fetch = vi.fn(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const model = body.model;
    requests.push(model);
    if (!body.stream) return Response.json({ id: 'x', object: 'chat.completion', created: 1, model, choices: [{ index: 0, message: { role: 'assistant', content: model }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } });
    return new Response(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: { content: model }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const optionsForRuntime = { hostOwnerId, rootId, runtimePolicySnapshot: read, secretResolver: async () => 'synthetic-key', hostTransportFactory: () => new AiHttpTransport({ fetch }) };
  return { config: config(options.summary), options: optionsForRuntime, read, requests,
    update: (revision: number, refsOverride: unknown) => { snapshot = { revision, refsOverride: normalizeRuntimePolicyRefsOverride(refsOverride) }; } };
}
const turn = { rootId, ownerId: hostOwnerId };
async function complete(bundle: Awaited<ReturnType<ModelRuntimeService['acquireForTurn']>>['chat']) {
  return bundle.llmRuntime.complete(bundle.llmRuntime.model(bundle.provider.name, bundle.invocation.model.model), { systemPrompt: '', messages: [createUserMessage('hello')] });
}

describe('runtime deployment model policy snapshots', () => {
  it('reads once per turn and keeps leased invocations fixed while deployment summary follows dynamic chat', async () => {
    const f = fixture(); const runtime = new ModelRuntimeService({ config: f.config, ...f.options });
    const old = await runtime.acquireForTurn(turn);
    f.update(1, { defaults: { chat: 'next' } });
    const next = await runtime.acquireForTurn(turn);
    expect(f.read).toHaveBeenCalledTimes(2);
    expect([old.chat.invocation.model.model, old.summary?.invocation.model.model]).toEqual(['old', 'old']);
    expect([next.chat.invocation.model.model, next.summary?.invocation.model.model]).toEqual(['next', 'next']);
    expect([old.policyRevision, next.policyRevision]).toEqual([0, 1]);
    expect(next.summarySource).toBe('deployment-chat');
    expect(runtime.getPolicyBaseline().defaults).toEqual({ chat: 'old' });
    await complete(old.chat); await complete(next.chat);
    expect(f.requests).toEqual(['old', 'next']);
    await old.release(); await next.release(); await runtime.dispose();
  });

  it('keeps personal precedence and deployment summary separate, then restores baseline when overrides are removed', async () => {
    const f = fixture(); const runtime = new ModelRuntimeService({ config: f.config, ...f.options });
    const conversation = { endpoint: { adapter: 'adapter', id: 'canonical\0adapter\0qq' }, kind: 'group' as const, id: 'g', parent: { kind: 'channel' as const, id: 'guild' }, threadId: 't' };
    const origin = { platform: 'qq', endpoint: 'account', conversation };
    f.update(1, { defaults: { chat: 'next' }, adapters: { qq: { chat: 'old' } }, endpoints: [{ address: { rootId, platform: 'qq', endpoint: 'account', adapterId: conversation.endpoint.id }, models: { chat: 'summary' } }], scenes: [{ address: { rootId, ...origin }, models: { chat: 'next' } }] });
    const selected = await runtime.acquireForTurn({ ...turn, origin, sessionSelection: { kind: 'preset', presetId: 'personal' } });
    expect([selected.chat.invocation.model.model, selected.summary?.invocation.model.model]).toEqual(['personal', 'next']);
    f.update(2, {});
    const inherited = await runtime.acquireForTurn({ ...turn, origin, sessionSelection: { kind: 'inherit' } });
    expect([inherited.chat.invocation.model.model, inherited.summary?.invocation.model.model]).toEqual(['old', 'old']);
    await selected.release(); await inherited.release(); await runtime.dispose();
  });

  it('keeps an explicit static summary fixed and lets only a deployment summary override replace it', async () => {
    const f = fixture({ summary: 'summary' }); const runtime = new ModelRuntimeService({ config: f.config, ...f.options });
    f.update(1, { defaults: { chat: 'next' } });
    const a = await runtime.acquireForTurn(turn);
    expect(a.summary?.invocation.model.model).toBe('summary'); expect(a.summarySource).toBe('static');
    f.update(2, { defaults: { summary: 'old' } });
    const b = await runtime.acquireForTurn(turn); expect(b.summary?.invocation.model.model).toBe('old'); expect(b.summarySource).toBe('runtime');
    f.update(3, {}); const c = await runtime.acquireForTurn(turn); expect(c.summary?.invocation.model.model).toBe('summary');
    await Promise.all([a.release(), b.release(), c.release()]); await runtime.dispose();
  });

  it('propagates state errors and rejects foreign roots, unknown refs, purpose expansion and connection edits', async () => {
    const f = fixture(); const runtime = new ModelRuntimeService({ config: f.config, ...f.options });
    f.read.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(runtime.acquireForTurn(turn)).rejects.toThrow('database unavailable');
    expect(f.requests).toEqual([]);
    for (const invalid of [{ defaults: { chat: 'missing' } }, { defaults: { chat: 'next' }, connections: {} }, { scenes: [{ address: { rootId: '/another-host', platform: 'qq', endpoint: 'bot', conversation: { endpoint: { adapter: 'qq', id: 'qq' }, kind: 'group', id: 'g' } }, models: { chat: 'next' } }] }, { adapters: { qq: { summary: 'next' } } }]) {
      expect(() => runtime.validateRuntimePolicyOverride(invalid, rootId)).toThrow();
    }
    await runtime.dispose();
  });

  it('applies changed defaults to each standalone run while explicit presets remain fixed', async () => {
    const f = fixture(); const service = new AIService(f.config);
    await service.prepareModelRuntime(f.options);
    const defaultAgent = service.createAgent(), explicit = service.createAgent({ preset: 'old' });
    await defaultAgent.run('first');
    f.update(1, { defaults: { chat: 'next' } });
    await defaultAgent.run('second'); await explicit.run('explicit');
    expect(f.requests).toEqual(['old', 'next', 'old']);
    expect(f.read).toHaveBeenCalledTimes(2);
    await service.dispose();
  });

  it('applies changed defaults to the plain completion port and leaves an explicit Agent selection fixed', async () => {
    const f = fixture(); const service = new AIService(f.config); await service.prepareModelRuntime(f.options);
    const acquireDefaultModel = vi.fn(() => service.getModelRuntime().acquireForTurn(turn));
    const completion = createAiCompletion({ service, acquireDefaultModel });
    f.update(1, { defaults: { chat: 'next' } });
    const result = await completion.completeText({ purpose: 'classification', prompt: 'hello' });
    expect(result.model).toBe('next'); expect(f.requests).toEqual(['next']);
    expect(acquireDefaultModel).toHaveBeenCalledTimes(1);
    await completion.completeText({ purpose: 'classification', prompt: 'hello', agent: 'zhin' });
    expect(acquireDefaultModel).toHaveBeenCalledTimes(1); expect(f.requests).toEqual(['next', 'old']);
    await service.dispose();
  });
});

it('requires the real Host address for a runtime policy reader and keeps historical static embedders valid', async () => {
  const f = fixture(); const { rootId: _root, ...withoutRoot } = f.options;
  expect(() => new ModelRuntimeService({ config: f.config, ...withoutRoot })).toThrow('invalid-config');
  const runtime = new ModelRuntimeService({ config: f.config, hostOwnerId, secretResolver: f.options.secretResolver, hostTransportFactory: f.options.hostTransportFactory });
  const lease = await runtime.acquireDefaultForTurn();
  expect('chat' in lease).toBe(false);
  await lease.release(); await runtime.dispose();
});

it('detaches the policy revision and summary source before asynchronous personal catalog lookup', async () => {
  const refsOverride = normalizeRuntimePolicyRefsOverride({ defaults: { chat: 'next' } });
  const snapshot = { revision: 1, refsOverride };
  let finish!: () => void; const pending = new Promise<void>(resolve => { finish = resolve; });
  const f = fixture();
  const runtime = new ModelRuntimeService({ config: f.config, ...f.options, runtimePolicySnapshot: async () => snapshot,
    personalCatalogSnapshot: async () => { await pending; return undefined; } });
  const operation = runtime.resolveForTurn({ rootId, ownerId: 'alice' });
  await Promise.resolve(); await Promise.resolve(); snapshot.revision = 99; finish();
  const resolved = await operation;
  expect(resolved.policyRevision).toBe(1); expect(resolved.summarySource).toBe('deployment-chat');
  expect(resolved.summary?.model.model).toBe('next'); await runtime.dispose();
});

it('does not reserve usage or call a provider when the default policy lookup fails', async () => {
  const f = fixture(), service = new AIService(f.config); await service.prepareModelRuntime(f.options);
  const record = vi.fn();
  const completion = createAiCompletion({ service, usageQuota: { check: () => ({ allowed: true }), record },
    acquireDefaultModel: signal => service.getModelRuntime().acquireForTurn(turn, signal) });
  f.read.mockRejectedValueOnce(new Error('policy persistence unavailable'));
  try {
    await expect(completion.completeText({ purpose: 'classification', prompt: 'hello', onBehalfOf: { userId: 'alice', owner: false } })).rejects.toThrow('policy persistence unavailable');
    expect(record).not.toHaveBeenCalled(); expect(f.requests).toEqual([]);
  } finally { await service.dispose(); }
});

it('releases the default completion scope once without replacing completion success with cleanup failure', async () => {
  const f = fixture(), service = new AIService(f.config); await service.prepareModelRuntime(f.options);
  const release = vi.fn(async () => { throw new Error('synthetic-private-cleanup-cause'); });
  const completion = createAiCompletion({ service, acquireDefaultModel: async signal => {
    const scope = await service.getModelRuntime().acquireForTurn(turn, signal);
    return Object.freeze({ ...scope, release: async () => { await scope.release(); await release(); } });
  } });
  try {
    expect((await completion.completeText({ purpose: 'classification', prompt: 'hello' })).model).toBe('old');
    expect(release).toHaveBeenCalledOnce(); expect(f.read).toHaveBeenCalledOnce();
    const aborted = new AbortController(); aborted.abort();
    await expect(completion.completeText({ purpose: 'classification', prompt: 'hello', signal: aborted.signal })).rejects.toThrow();
    expect(f.read).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
  } finally { await service.dispose(); }
});
