import { createUserMessage } from '@zhin.js/ai';
import { createProfileReference, persistentProfileSelection } from '@zhin.js/ai/provider';
import { modelRuntimeFixture } from '../helpers/model-runtime.js';
import { AIService } from '../../src/service.js';
import { createAiCompletion } from '../../src/plugin-runtime/ai-completion.js';

function withOther(f: ReturnType<typeof modelRuntimeFixture>) {
  const graph = f.graph;
  return { ...graph, profiles: { ...graph.profiles, other: { ...graph.profiles.text, id: 'other', parameters: { maxOutputTokens: 77 } } } };
}

it('reads one authoritative graph per turn and freezes in-flight chat and inherited summary', async () => {
  const f = modelRuntimeFixture(), old = await f.acquire();
  const graph = withOther(f); f.update({ ...graph, revision: 2, purposes: { ...graph.purposes, defaults: { chat: 'other' } } });
  const next = await f.acquire();
  expect(f.calls.reads).toBe(2);
  expect([old.chat.binding.profile.id, old.summary?.binding.profile.id]).toEqual(['text', 'text']);
  expect([next.chat.binding.profile.id, next.summary?.binding.profile.id]).toEqual(['other', 'other']);
  expect([old.policyRevision, next.policyRevision]).toEqual([1, 2]);
  expect(next.summarySource).toBe('deployment-chat');
  await old.release(); await next.release();
});

it('keeps a Session override independent of deployment summary, then restores hierarchy when selection is removed', async () => {
  const f = modelRuntimeFixture(), graph = withOther(f); f.update(graph);
  const initial = await f.acquire();
  const ref = await initial.resolve({ kind: 'language', profile: createProfileReference({ binding: { ...initial.chat.binding, profile: graph.profiles.other }, kind: 'language' }) });
  const selection = persistentProfileSelection(createProfileReference({ binding: ref, kind: 'language' }));
  await initial.release();
  const selected = await f.acquire({ sessionChat: selection });
  expect([selected.chat.binding.profile.id, selected.summary?.binding.profile.id]).toEqual(['other', 'text']);
  const inherited = await f.acquire(); expect(inherited.chat.binding.profile.id).toBe('text');
  await selected.release(); await inherited.release();
});

it('keeps an explicit summary fixed until that one runtime reference changes', async () => {
  const f = modelRuntimeFixture(), graph = withOther(f);
  f.update({ ...graph, purposes: { ...graph.purposes, defaults: { chat: 'other', summary: 'text' } } });
  const first = await f.acquire(); expect(first.summary?.binding.profile.id).toBe('text'); expect(first.summarySource).toBe('runtime');
  f.update({ ...graph, revision: 2, purposes: { ...graph.purposes, defaults: { chat: 'other', summary: 'other' } } });
  const second = await f.acquire(); expect(second.summary?.binding.profile.id).toBe('other');
  await first.release(); await second.release();
});

it('propagates repository errors without lookup-as-absence or a startup fallback', async () => {
  const f = modelRuntimeFixture(), failure = new Error('database unavailable'); f.failRead(failure);
  await expect(f.acquire()).rejects.toBe(failure);
  expect(f.calls.factories).toBe(0); expect(f.calls.requests).toEqual([]);
});

it('rejects unknown purpose references and excess override scope before execution', () => {
  const f = modelRuntimeFixture();
  for (const purposes of [{ defaults: { chat: 'missing' } }, { defaults: { chat: 'text' }, adapters: { adapter: { summary: 'text' } } }, { defaults: {}, scenes: { scene: { perception: { profile: 'text' } } } }]) {
    expect(() => f.update({ ...f.graph, purposes })).toThrow('invalid-graph');
  }
  expect(f.calls.requests).toEqual([]);
});

it('uses the supplied operation for standalone work while the next acquired run sees current settings', async () => {
  const f = modelRuntimeFixture(), service = new AIService();
  const old = await f.acquire();
  const standalone = service.createAgent({ models: old, maxIterations: 1 });
  const graph = withOther(f); f.update({ ...graph, revision: 2, purposes: { ...graph.purposes, defaults: { chat: 'other' } } });
  const next = await f.acquire();
  await standalone.run('explicit old selection');
  expect(old.chat.binding.profile.id).toBe('text'); expect(next.chat.binding.profile.id).toBe('other');
  await old.release(); await next.release(); await service.dispose();
});

it('plain completion acquires current scopes per call and leaves explicit role purpose selection fixed', async () => {
  const f = modelRuntimeFixture(), graph = withOther(f), service = new AIService({ agents: { reviewer: {} } });
  f.update({ ...graph, purposes: { ...graph.purposes, agents: { reviewer: 'text' } } });
  const acquired: string[] = [];
  const completion = createAiCompletion({ service, acquireDefaultModel: async (_signal, name) => {
    const scope = await f.acquire({}, name); acquired.push(scope.chat.binding.profile.id); return scope;
  } });
  await completion.completeText({ purpose: 'one', prompt: 'hello' });
  f.update({ ...graph, revision: 2, purposes: { ...graph.purposes, defaults: { chat: 'other' }, agents: { reviewer: 'text' } } });
  await completion.completeText({ purpose: 'two', prompt: 'hello' });
  await completion.completeText({ purpose: 'role', prompt: 'hello', agent: 'reviewer' });
  expect(acquired).toEqual(['text', 'other', 'text']);
  await service.dispose();
});
