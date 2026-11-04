import { normalizeProviderGraph, resolveProviderProfile, createProfileReference } from '@zhin.js/ai/provider';
import { graphFixture, context } from '../../../ai/tests/provider/fixtures.js';

// The candidate registry is retired. Preserve its external invariants against
// the actual target authority instead of recreating a compatibility resolver.
describe('explicit model selection', () => {
  it('cannot select an out-of-catalog model through a forged Profile', () => {
    const original = graphFixture();
    expect(() => normalizeProviderGraph({ ...original, profiles: { text: { ...original.profiles.text, model: 'outside-allowlist' } } })).toThrow();
  });
  it('keeps chat fixed when a separate perception Profile is configured', () => {
    const original = graphFixture();
    const graph = normalizeProviderGraph({ ...original,
      services: { service: { ...original.services.service, models: { ...original.services.service.models, vision: { id: 'vision', kinds: ['language'], protocol: 'fixture', input: ['text', 'image'] } } } },
      profiles: { ...original.profiles, vision: { ...original.profiles.text, id: 'vision', model: 'vision' } },
      purposes: { defaults: { chat: 'text', perception: { profile: 'vision' } } } });
    expect(resolveProviderProfile({ graph, context, kind: 'language', purpose: 'chat' }).model.id).toBe('text');
    expect(resolveProviderProfile({ graph, context, kind: 'language', purpose: 'perception' }).model.id).toBe('vision');
  });
  it('honors an authorized explicit Profile without adding other catalog models as candidates', () => {
    const graph = graphFixture();
    const binding = resolveProviderProfile({ graph, context, kind: 'language', purpose: 'chat' });
    const selected = resolveProviderProfile({ graph, context, kind: 'language', purpose: 'chat', profile: createProfileReference({ binding, kind: 'language' }) });
    expect(selected.model.id).toBe('text');
    expect(selected.profile.id).toBe('text');
  });
  it('does not manufacture a vision fallback when none is configured', () => {
    expect(() => resolveProviderProfile({ graph: graphFixture(), context, kind: 'language', purpose: 'perception' })).toThrow('not-configured');
  });
});
