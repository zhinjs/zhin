import { normalizeProviderGraph } from '../../src/provider/graph.js';
import { createProfileReference, persistentProfileSelection, resolveProviderProfile } from '../../src/provider/selection.js';
import { context, graphFixture, HOST } from './fixtures.js';

describe('provider graph and scoped model selection', () => {
  it('detaches and freezes public graph data and rejects inline credentials', () => {
    const input = structuredClone(graphFixture());
    const parsed = normalizeProviderGraph(input);
    expect(Object.isFrozen(parsed.services.service.models.text)).toBe(true);
    Object.assign(input.services.service.options, { leaked: true });
    expect(parsed.services.service.options).toEqual({});
    expect(() => normalizeProviderGraph({ ...input, apiKey: 'secret' })).toThrow('invalid-graph');
    expect(() => normalizeProviderGraph({ ...input, accounts: { account: { ...input.accounts.account,
      authentication: { method: 'api-key', source: 'literal-secret' } } } })).toThrow('invalid-graph');
  });
  it('rejects missing references, invalid ownership and cyclic/non-JSON configuration', () => {
    const graph = graphFixture();
    expect(() => normalizeProviderGraph({ ...graph, profiles: { ...graph.profiles,
      text: { ...graph.profiles.text, ownerId: 'alice' } } })).toThrow('invalid-graph');
    expect(() => normalizeProviderGraph({ ...graph, accounts: {} })).toThrow('invalid-graph');
    const options: Record<string, unknown> = {}; options.self = options;
    expect(() => normalizeProviderGraph({ ...graph, services: { service: { ...graph.services.service, options } } })).toThrow('invalid-graph');
  });
  it('uses Host chat for inherited summary while session chat changes independently', () => {
    const graph = graphFixture();
    const privateAccount = { ...graph.accounts.account, id: 'personal', ownerId: 'alice', incarnation: 'alice-account' };
    const modified = normalizeProviderGraph({ ...graph, accounts: { ...graph.accounts, personal: privateAccount },
      profiles: { ...graph.profiles, personal: { ...graph.profiles.text, id: 'personal', accountId: 'personal', ownerId: 'alice' } } });
    const privateBinding = resolveProviderProfile({ graph: modified, context: { ...context, ownerId: 'alice' }, kind: 'language',
      profile: { id: 'personal', rootId: 'root', revision: 1, accountId: 'personal', accountIncarnation: 'alice-account', kind: 'language' } as never });
    const sessionChat = persistentProfileSelection(createProfileReference({ binding: privateBinding, kind: 'language' }));
    const caller = { ...context, ownerId: 'alice', sessionChat };
    expect(resolveProviderProfile({ graph: modified, context: caller, kind: 'language', purpose: 'chat' }).account.id).toBe('personal');
    expect(resolveProviderProfile({ graph: modified, context: caller, kind: 'language', purpose: 'summary' }).account.ownerId).toBe(HOST);
    expect(() => resolveProviderProfile({ graph: modified, context: { ...caller, ownerId: 'bob' }, kind: 'language', purpose: 'chat' })).toThrow('forbidden');
  });
  it('durable selection sees next-call parameter updates but a short-lived stale ref is rejected', () => {
    const graph = graphFixture();
    const ref = createProfileReference({ binding: resolveProviderProfile({ graph, context, kind: 'language', purpose: 'chat' }), kind: 'language' });
    const changed = normalizeProviderGraph({ ...graph, revision: 2, profiles: { ...graph.profiles,
      text: { ...graph.profiles.text, revision: 2, parameters: { temperature: 0.2 } } } });
    expect(resolveProviderProfile({ graph: changed, context: { ...context, sessionChat: persistentProfileSelection(ref) },
      kind: 'language', purpose: 'chat' }).profile.parameters).toEqual({ temperature: 0.2 });
    expect(() => resolveProviderProfile({ graph: changed, context, kind: 'language', profile: ref })).toThrow('stale-reference');
    const replaced = normalizeProviderGraph({ ...changed, accounts: { account: { ...changed.accounts.account, incarnation: 'replacement' } } });
    expect(() => resolveProviderProfile({ graph: replaced, context: { ...context, sessionChat: persistentProfileSelection(ref) },
      kind: 'language', purpose: 'chat' })).toThrow('stale-reference');
  });
  it('layers allowed scope fields and preserves the explicit perception chain', () => {
    const graph = graphFixture();
    const other = { ...graph.profiles.text, id: 'other' };
    const changed = normalizeProviderGraph({ ...graph, profiles: { ...graph.profiles, other }, purposes: {
      defaults: { chat: 'text', perception: { profile: 'text', fallbacks: ['other'] } }, adapters: { a: { chat: 'other' } },
      endpoints: { e: { chat: 'text' } }, scenes: { s: { chat: 'other' } },
    } });
    expect(resolveProviderProfile({ graph: changed, context: { ...context, adapterKey: 'a', endpointKey: 'e', sceneKey: 's' }, kind: 'language', purpose: 'chat' }).profile.id).toBe('other');
    expect(() => normalizeProviderGraph({ ...changed, purposes: { ...changed.purposes, scenes: { s: { summary: 'other' } } } })).toThrow('invalid-graph');
    expect(() => resolveProviderProfile({ graph: changed, context, kind: 'decision', purpose: 'chat' })).toThrow('unsupported-capability');
  });
});

it('derives ordered inheritance and per-purpose provenance from the same selection result', () => {
  const graph = graphFixture();
  const profiles = { ...graph.profiles, ...Object.fromEntries(['adapter', 'endpoint', 'scene'].map(id => [id, { ...graph.profiles.text, id }])) };
  const full = normalizeProviderGraph({ ...graph, profiles, purposes: {
    defaults: { chat: 'text', perception: { profile: 'text' } }, adapters: { a: { chat: 'adapter', perception: { profile: 'adapter' } } },
    endpoints: { e: { chat: 'endpoint', perception: { profile: 'endpoint' } } }, scenes: { s: { chat: 'scene' } },
  } });
  const caller = { ...context, adapterKey: 'a', endpointKey: 'e', sceneKey: 's' };
  const resolve = (current = full, purpose = 'chat' as 'chat' | 'perception' | 'summary') => resolveProviderProfile({ graph: current, context: caller, kind: 'language', purpose });
  expect(resolve().source).toEqual({ level: 'scene', key: 's' });
  expect(resolve(full, 'perception').source).toEqual({ level: 'endpoint', key: 'e' });
  expect(resolve(full, 'summary').source).toEqual({ level: 'default', purpose: 'summary', inheritedFrom: 'chat' });
  const noScene = normalizeProviderGraph({ ...full, purposes: { ...full.purposes, scenes: {} } });
  expect(resolve(noScene).profile.id).toBe('endpoint'); expect(resolve(noScene).source?.level).toBe('endpoint');
  const noEndpoint = normalizeProviderGraph({ ...noScene, purposes: { ...noScene.purposes, endpoints: {} } });
  expect(resolve(noEndpoint).profile.id).toBe('adapter'); expect(resolve(noEndpoint).source?.level).toBe('adapter');
  const defaults = normalizeProviderGraph({ ...noEndpoint, purposes: { defaults: full.purposes.defaults } });
  expect(resolve(defaults).profile.id).toBe('text'); expect(resolve(defaults).source).toEqual({ level: 'default', purpose: 'chat' });
  const reference = createProfileReference({ binding: resolve(full), kind: 'language' });
  expect(resolveProviderProfile({ graph: full, context: { ...caller, sessionChat: persistentProfileSelection(reference) }, kind: 'language', purpose: 'chat' }).source).toEqual({ level: 'session' });
  expect(resolveProviderProfile({ graph: full, context: caller, kind: 'language', profile: reference }).source).toEqual({ level: 'profile', profileId: 'scene' });
  expect(Object.isFrozen(resolve().source)).toBe(true);
});

it('uses a separate deployment ambient Language Profile, inherits chat only when absent, and never borrows scoped chat', () => {
  const graph = graphFixture();
  const changed = normalizeProviderGraph({ ...graph, profiles: { ...graph.profiles, ambient: { ...graph.profiles.text, id: 'ambient' } },
    purposes: { defaults: { chat: 'text', ambient: 'ambient' }, scenes: { group: { chat: 'ambient' } } } });
  expect(resolveProviderProfile({ graph: changed, context: { ...context, sceneKey: 'group' }, kind: 'language', purpose: 'ambient' }).profile.id).toBe('ambient');
  const inherited = normalizeProviderGraph({ ...changed, purposes: { defaults: { chat: 'text' }, scenes: changed.purposes.scenes } });
  expect(resolveProviderProfile({ graph: inherited, context: { ...context, sceneKey: 'group' }, kind: 'language', purpose: 'ambient' })).toMatchObject({
    profile: { id: 'text' }, source: { level: 'default', purpose: 'ambient', inheritedFrom: 'chat' },
  });
  expect(() => normalizeProviderGraph({ ...changed, purposes: { ...changed.purposes, endpoints: { e: { ambient: 'ambient' } } } })).toThrow('invalid-graph');
});
