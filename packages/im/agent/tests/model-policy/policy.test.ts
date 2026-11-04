import { normalizeProviderGraph, resolveProviderProfile, createProfileReference, persistentProfileSelection } from '@zhin.js/ai/provider';
import { context, graphFixture } from '../../../ai/tests/provider/fixtures.js';

function fixture() {
  const graph = graphFixture();
  return normalizeProviderGraph({ ...graph,
    profiles: { ...graph.profiles, ...Object.fromEntries(['adapter', 'endpoint', 'scene', 'session'].map(id => [id, { ...graph.profiles.text, id }])) },
    purposes: { defaults: { chat: 'text', summary: 'text', perception: { profile: 'text' } },
      adapters: { adapter: { chat: 'adapter', perception: { profile: 'adapter' } } },
      endpoints: { endpoint: { chat: 'endpoint', perception: { profile: 'endpoint' } } }, scenes: { scene: { chat: 'scene' } } } });
}
const caller = { ...context, adapterKey: 'adapter', endpointKey: 'endpoint', sceneKey: 'scene' };
it('preserves field allowlists, ordered scope overrides and per-purpose provenance through the one graph resolver', () => {
  const graph = fixture();
  const scene = resolveProviderProfile({ graph, context: caller, kind: 'language', purpose: 'chat' });
  const ref = createProfileReference({ binding: { ...scene, profile: graph.profiles.session }, kind: 'language' });
  const personal = { ...caller, sessionChat: persistentProfileSelection(ref) };
  expect(resolveProviderProfile({ graph, context: personal, kind: 'language', purpose: 'chat' })).toMatchObject({ profile: { id: 'session' }, source: { level: 'session' } });
  expect(resolveProviderProfile({ graph, context: personal, kind: 'language', purpose: 'perception' })).toMatchObject({ profile: { id: 'endpoint' }, source: { level: 'endpoint', key: 'endpoint' } });
  expect(resolveProviderProfile({ graph, context: personal, kind: 'language', purpose: 'summary' })).toMatchObject({ profile: { id: 'text' }, source: { level: 'default', purpose: 'summary' } });
});
it('restores each inherited selection when the corresponding override is removed', () => {
  const graph = fixture();
  for (const [context, expected] of [[caller, 'scene'], [{ ...caller, sceneKey: undefined }, 'endpoint'],
    [{ ...caller, sceneKey: undefined, endpointKey: undefined }, 'adapter'], [{ ...caller, sceneKey: undefined, endpointKey: undefined, adapterKey: undefined }, 'text']] as const) {
    expect(resolveProviderProfile({ graph, context, kind: 'language', purpose: 'chat' }).profile.id).toBe(expected);
  }
});
it.each(['adapters', 'endpoints', 'scenes'] as const)('rejects purpose expansion at %s scopes', level => {
  const graph = fixture();
  expect(() => normalizeProviderGraph({ ...graph, purposes: { ...graph.purposes, [level]: { name: { summary: 'text' } } } })).toThrow('invalid-graph');
});
it.each([null, '', ' ', ' padded', 42, {}])('rejects invalid explicit purpose reference %j', value => {
  const graph = fixture();
  expect(() => normalizeProviderGraph({ ...graph, purposes: { defaults: { chat: value } } })).toThrow('invalid-graph');
});
it('does not replace an explicitly unresolved selection with deployment chat', () => {
  const graph = fixture();
  const reference = createProfileReference({ binding: resolveProviderProfile({ graph, context: caller, kind: 'language', purpose: 'chat' }), kind: 'language' });
  const changed = normalizeProviderGraph({ ...graph, purposes: { defaults: { chat: 'text' } },
    profiles: Object.fromEntries(Object.entries(graph.profiles).filter(([id]) => id !== 'scene')) });
  expect(() => resolveProviderProfile({ graph: changed, context: { ...caller, sessionChat: persistentProfileSelection(reference) }, kind: 'language', purpose: 'chat' })).toThrow('profile-not-found');
});
it('accepts opaque structural scope keys including separators and NUL without joining identity components itself', () => {
  const graph = fixture(), key = JSON.stringify(['root', 'adapter\0entry', 'parent/child', 'topic']);
  const modified = normalizeProviderGraph({ ...graph, purposes: { defaults: { chat: 'text' }, scenes: { [key]: { chat: 'scene' } } } });
  expect(resolveProviderProfile({ graph: modified, context: { ...context, sceneKey: key }, kind: 'language', purpose: 'chat' }).profile.id).toBe('scene');
  expect(resolveProviderProfile({ graph: modified, context: { ...context, sceneKey: JSON.stringify(['root', 'adapter', 'entry\0parent/child', 'topic']) }, kind: 'language', purpose: 'chat' }).profile.id).toBe('text');
});
it('rejects old address-array policy contracts rather than running a second resolver', () => {
  const graph = fixture();
  expect(() => normalizeProviderGraph({ ...graph, purposes: { defaults: {}, scenes: [{ address: {}, models: { chat: 'text' } }] } })).toThrow('invalid-graph');
});
it('detaches and freezes configuration, resolved bindings and provenance without mutating the input', () => {
  const authored = structuredClone(fixture()), original = structuredClone(authored);
  const graph = normalizeProviderGraph(authored);
  const result = resolveProviderProfile({ graph, context: caller, kind: 'language', purpose: 'chat' });
  expect(Object.isFrozen(graph.purposes.scenes)).toBe(true); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.source)).toBe(true);
  expect(authored).toEqual(original);
});
