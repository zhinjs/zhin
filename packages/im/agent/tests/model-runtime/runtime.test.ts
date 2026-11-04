import { createUserMessage } from '@zhin.js/ai';
import { createProfileReference, persistentProfileSelection, normalizeProviderGraph } from '@zhin.js/ai/provider';
import { modelRuntimeFixture } from '../helpers/model-runtime.js';

it('does not construct request resources or read credentials during binding preparation', async () => {
  const f = modelRuntimeFixture(), scope = await f.acquire();
  expect(f.calls.factories).toBe(0); expect(scope.chat.binding.profile.id).toBe('text');
  expect(scope.summary?.binding.profile.id).toBe('text');
  expect(JSON.stringify(scope.graph)).not.toMatch(/apiKey|headers|mcpServers|permission/);
  await scope.release();
});

it('requires one explicit model, never guesses a missing deployment or Session selection', async () => {
  const f = modelRuntimeFixture(); f.update({ ...f.graph, purposes: { defaults: {} } });
  await expect(f.acquire()).rejects.toThrow('not-configured');
  expect(f.calls.factories).toBe(0);
});

it('preserves only the configured perception chain, in order, with no unrelated model discovery', async () => {
  const f = modelRuntimeFixture(), original = f.graph;
  f.update({ ...original, profiles: { ...original.profiles, vision: { ...original.profiles.text, id: 'vision' }, backup: { ...original.profiles.text, id: 'backup' }, unused: { ...original.profiles.text, id: 'unused' } },
    purposes: { defaults: { chat: 'text', perception: { profile: 'vision', fallbacks: ['backup'] } } } });
  const scope = await f.acquire();
  expect(scope.perception?.binding.profile.id).toBe('vision');
  expect(scope.perceptionFallbacks?.map(bundle => bundle.binding.profile.id)).toEqual(['backup']);
  expect(Object.isFrozen(scope.perceptionFallbacks)).toBe(true); expect(f.calls.factories).toBe(0);
  expect(scope.perception?.binding.source).toEqual({ level: 'default', purpose: 'perception' });
  expect(scope.perceptionFallbacks?.[0].binding.source).toEqual(scope.perception?.binding.source);
  await scope.release();
  f.update(original); const removed = await f.acquire(); expect(removed.perception).toBeUndefined(); await removed.release();
});

it('rejects a forged completion Model before any execution or network', async () => {
  const f = modelRuntimeFixture(), scope = await f.acquire();
  for (const patch of [{ id: 'other' }, { provider: 'other' }, { api: 'other' }, { contextWindow: 1 }, { maxTokens: 1 }]) {
    await expect(scope.chat.completion.complete({ ...scope.chat.model, ...patch }, { systemPrompt: '', messages: [] })).rejects.toThrow();
  }
  expect(f.calls.factories).toBe(0); await scope.release();
});

it('rejects a missing or foreign personal identity without trying deployment chat', async () => {
  const f = modelRuntimeFixture(), first = await f.acquire();
  const reference = persistentProfileSelection(createProfileReference({ binding: first.chat.binding, kind: 'language' }));
  await first.release();
  await expect(f.acquire({ sessionChat: { ...reference, id: 'missing' } })).rejects.toThrow('profile-not-found');
  const original = f.graph;
  f.update({ ...original, accounts: { ...original.accounts, private: { ...original.accounts.account, id: 'private', ownerId: 'alice', incarnation: 'alice' } }, profiles: { ...original.profiles, private: { ...original.profiles.text, id: 'private', ownerId: 'alice', accountId: 'private' } } });
  await expect(f.acquire({ ownerId: 'bob', sessionChat: { ...reference, id: 'private', accountId: 'private', accountIncarnation: 'alice' } })).rejects.toThrow('forbidden');
  expect(f.calls.factories).toBe(0);
});

it('uses a role Profile without transferring Host ownership to the personal caller', async () => {
  const f = modelRuntimeFixture(), original = f.graph;
  f.update({ ...original, profiles: { ...original.profiles, reviewer: { ...original.profiles.text, id: 'reviewer' } }, purposes: { ...original.purposes, agents: { reviewer: 'reviewer' } } });
  const scope = await f.acquire({ ownerId: 'alice' }, 'reviewer');
  expect(scope.context.ownerId).toBe('alice'); expect(scope.chat.binding.profile.ownerId).toBe('host:test');
  expect(scope.chat.binding.profile.id).toBe('reviewer'); await scope.release();
});

it('does not allow a deployment purpose to consume a personal Profile', () => {
  const f = modelRuntimeFixture(), original = f.graph;
  expect(() => f.update({ ...original, profiles: { ...original.profiles, text: { ...original.profiles.text, ownerId: 'alice' } } })).toThrow('invalid-graph');
  expect(f.calls.factories).toBe(0);
});

it('keeps model budget and capability snapshots fixed while later operations use updated metadata', async () => {
  const f = modelRuntimeFixture(), first = await f.acquire(), graph = f.graph;
  f.update({ ...graph, revision: 2, services: { service: { ...graph.services.service, revision: 2, models: { ...graph.services.service.models, text: { ...graph.services.service.models.text, contextWindow: 12345, maxOutputTokens: 456 } } } } });
  const next = await f.acquire(); expect(first.chat.model.contextWindow).toBe(0);
  expect(next.chat.model).toMatchObject({ contextWindow: 12345, maxTokens: 456 });
  await first.release(); await next.release();
});

it('does not reuse a removed account incarnation even when labels and model names remain equal', async () => {
  const f = modelRuntimeFixture(), first = await f.acquire();
  const selection = persistentProfileSelection(createProfileReference({ binding: first.chat.binding, kind: 'language' })); await first.release();
  f.update({ ...f.graph, revision: 2, accounts: { account: { ...f.graph.accounts.account, incarnation: 'new-account' } } });
  await expect(f.acquire({ sessionChat: selection })).rejects.toThrow('stale-reference');
  expect(f.calls.factories).toBe(0);
});

it('passes the selected fixed model through an actual completion and releases owned resources', async () => {
  const f = modelRuntimeFixture(), scope = await f.acquire();
  const result = await scope.chat.completion.complete(scope.chat.model, { systemPrompt: '', messages: [createUserMessage('hello')] });
  expect(result.content).toContainEqual({ type: 'text', text: 'done' }); expect(f.calls.factories).toBe(1);
  await scope.release(); await expect(scope.inference.list({ kind: 'language' })).rejects.toThrow('operation-closed');
});
