import { normalizeProviderGraph, resolveProviderProfile, providerModelSupports } from '../../src/provider/index.js';
import { graphFixture, context } from '../provider/fixtures.js';

it('resolves detached, deeply frozen, secret-free binding snapshots from the sole graph', () => {
  const input = structuredClone(graphFixture()), graph = normalizeProviderGraph(input);
  const binding = resolveProviderProfile({ graph, context, kind: 'language', purpose: 'chat' });
  for (const value of [binding, binding.service, binding.account, binding.profile, binding.model, graph, graph.services]) expect(Object.isFrozen(value)).toBe(true);
  expect(binding.service).not.toBe(input.services.service);
  input.services.service.options = { baseUrl: 'https://changed.test' };
  expect(binding.service.options).toEqual({}); expect(JSON.stringify(binding)).not.toContain('apiKey');
});

it('permits Host profiles for current callers and rejects another private owner before returning a binding', () => {
  const source = graphFixture();
  const graph = normalizeProviderGraph({ ...source, accounts: { ...source.accounts, alice: { ...source.accounts.account, id: 'alice', ownerId: 'alice', incarnation: 'alice' } },
    profiles: { ...source.profiles, alice: { ...source.profiles.text, id: 'alice', ownerId: 'alice', accountId: 'alice' } } });
  expect(resolveProviderProfile({ graph, context: { ...context, ownerId: 'alice' }, kind: 'language', purpose: 'chat' }).profile.ownerId).toBe(context.hostOwnerId);
  const selection = { id: 'alice', rootId: 'root', accountId: 'alice', accountIncarnation: 'alice', kind: 'language' as const };
  expect(resolveProviderProfile({ graph, context: { ...context, ownerId: 'alice', sessionChat: selection }, kind: 'language', purpose: 'chat' }).profile.ownerId).toBe('alice');
  expect(() => resolveProviderProfile({ graph, context: { ...context, ownerId: 'bob', sessionChat: selection }, kind: 'language', purpose: 'chat' })).toThrow('forbidden');
});

it('checks unknown capabilities only when explicitly required, without guessing from a name', () => {
  const model = { id: 'sounds-like-vision-model', protocol: 'fixture', kinds: ['language'] as const };
  expect(providerModelSupports({ model, requirements: {} })).toBe(true);
  expect(providerModelSupports({ model, requirements: { streaming: false } })).toBe(true);
  expect(providerModelSupports({ model, requirements: { streaming: true } })).toBe(false);
  expect(providerModelSupports({ model, requirements: { input: ['image'] } })).toBe(false);
});

it.each(['apiKey', 'headers', 'factory', 'permission'])('rejects %s outside its approved resource role without echoing input', key => {
  const source = graphFixture();
  expect(() => normalizeProviderGraph({ ...source, accounts: { account: { ...source.accounts.account, [key]: 'synthetic-secret' } } })).toThrow('invalid-graph');
  try { normalizeProviderGraph({ ...source, [key]: 'synthetic-secret' }); } catch (error) { expect(String(error)).not.toContain('synthetic-secret'); }
});

it('rejects a missing account/model, invalid revisions and capability field expansion', () => {
  const graph = graphFixture();
  for (const patch of [
    { accounts: { account: { ...graph.accounts.account, serviceId: 'missing' } } },
    { profiles: { ...graph.profiles, text: { ...graph.profiles.text, accountId: 'missing' } } },
    { profiles: { ...graph.profiles, text: { ...graph.profiles.text, revision: 0 } } },
    { services: { service: { ...graph.services.service, models: { text: { ...graph.services.service.models.text, permission: 'admin' } } } } },
  ]) expect(() => normalizeProviderGraph({ ...graph, ...patch })).toThrow('invalid-graph');
});
