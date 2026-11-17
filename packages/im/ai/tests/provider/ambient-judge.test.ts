/**
 * ADR 0066 P1: one interjection judge `purposes.ambient` — graph shape and validation, plan import
 * (string / object / null, deprecated `purposes.decisions.ambient`), the D5 conversion table and
 * selection of its chain.
 */
import { createEmptyProviderGraph, normalizeProviderGraph } from '../../src/provider/graph.js';
import { changedPurposeProfileIds, reviewProviderPlan } from '../../src/provider/plan.js';
import { providerPurposeSelections } from '../../src/provider/selection.js';
import {
  ambientJudgeChain, ambientJudgeWouldSpeak, convertLegacyAmbientJudge, effectiveAmbientJudgePolicy, hasLegacyAmbientJudgeFields,
  legacyAmbientTriggerKeys, withoutLegacyAmbientJudge,
} from '../../src/provider/ambient-judge.js';
import { ProviderError } from '../../src/provider/types.js';
import { context, HOST } from './fixtures.js';

const base = { rootId: 'root', ownerId: HOST, revision: 1 };
function graph(purposes: Record<string, unknown> = { defaults: {} }) {
  const profile = (id: string, model: string) => ({ ...base, id, accountId: 'account', model, parameters: {} });
  return normalizeProviderGraph({ rootId: 'root', revision: 1,
    services: { service: { ...base, id: 'service', driver: { id: 'fixture', owner: 'root/providers', contractVersion: '1' }, options: {}, models: {
      text: { id: 'text', kinds: ['language'], protocol: 'fixture' },
      jev: { id: 'jev', kinds: ['decision'], protocol: 'native' },
      picture: { id: 'picture', kinds: ['image'], protocol: 'fixture' },
    } } },
    accounts: { account: { ...base, id: 'account', serviceId: 'service', incarnation: 'a', authentication: { method: 'none' } } },
    profiles: { chat: profile('chat', 'text'), spare: profile('spare', 'text'), small: profile('small', 'text'), jev: profile('jev', 'jev'), image: profile('image', 'picture') },
    purposes,
  });
}
function pathOf(run: () => unknown): string | undefined {
  try { run(); } catch (error) { return error instanceof ProviderError ? error.path ?? error.code : String(error); }
  return undefined;
}

function reviewer(source = graph({ defaults: { chat: 'chat' } }), options: { legacyAmbientDecisions?: 'convert' | 'reject' } = {}) {
  return (purposes: unknown) => reviewProviderPlan({ input: { version: 1, purposes }, graph: source, ownerId: HOST, hostOwnerId: HOST,
    bindings: { profiles: { chat: 'chat', spare: 'spare', small: 'small', jev: 'jev', image: 'image' } }, createId: kind => `${kind}:new`,
    resolveService: () => { throw new Error('no services'); }, ...options });
}

describe('purposes.ambient in the stored graph (D1)', () => {
  it('stores a mixed chain, compare, threshold, mode and timeout', () => {
    const value = graph({ defaults: { chat: 'chat' }, ambient: { profile: 'jev', fallbacks: ['chat'], compare: 'small', minConfidence: 0.8, mode: 'shadow', timeoutMs: 2000 } });
    expect(value.purposes.ambient).toEqual({ profile: 'jev', fallbacks: ['chat'], compare: 'small', minConfidence: 0.8, mode: 'shadow', timeoutMs: 2000 });
  });

  it.each([
    [{ profile: 'chat', extra: 1 }, 'purposes.ambient.extra'],
    [{ profile: 'chat', fallbacks: ['spare', 'spare'] }, 'purposes.ambient.fallbacks[1]'],
    [{ profile: 'chat', fallbacks: ['chat'] }, 'purposes.ambient.fallbacks[0]'],
    [{ fallbacks: ['spare'] }, 'purposes.ambient.fallbacks'],
    [{ profile: 'chat', fallbacks: ['spare'], compare: 'spare' }, 'purposes.ambient.compare'],
    [{ profile: 'chat', compare: 'chat' }, 'purposes.ambient.compare'],
    [{ profile: 'image' }, 'purposes.ambient.profile'],
    [{ profile: 'chat', fallbacks: ['image'] }, 'purposes.ambient.fallbacks[0]'],
    [{ compare: 'image' }, 'purposes.ambient.compare'],
    [{ profile: 'missing' }, 'purposes.ambient.profile'],
    [{ minConfidence: 1.2 }, 'purposes.ambient.minConfidence'],
    [{ mode: 'off' }, 'purposes.ambient.mode'],
    [{ timeoutMs: 0 }, 'purposes.ambient.timeoutMs'],
  ])('rejects %j at %s', (ambient, path) => {
    expect(pathOf(() => graph({ defaults: {}, ambient }))).toBe(path);
  });

  it('allows minConfidence, mode, compare and timeoutMs without a profile (the chain follows chat)', () => {
    const value = graph({ defaults: { chat: 'chat', chatFallbacks: ['spare'] }, ambient: { minConfidence: 0.5, mode: 'shadow', compare: 'jev', timeoutMs: 500 } });
    expect(ambientJudgeChain(value.purposes)).toEqual({ ids: ['chat', 'spare'], inheritedFrom: 'chat' });
    expect(providerPurposeSelections({ graph: value, context, purpose: 'ambient' }).map(entry => [entry.id, entry.source]))
      .toEqual([['chat', { level: 'default', purpose: 'ambient', inheritedFrom: 'chat' }], ['spare', { level: 'default', purpose: 'ambient', inheritedFrom: 'chat' }]]);
  });

  it('selects the configured mixed chain', () => {
    const value = graph({ defaults: { chat: 'chat' }, ambient: { profile: 'jev', fallbacks: ['spare'] } });
    expect(providerPurposeSelections({ graph: value, context, purpose: 'ambient' }).map(entry => entry.id)).toEqual(['jev', 'spare']);
  });

  it('names the path of a removed Profile still referenced by the judge', () => {
    const value = graph({ defaults: { chat: 'chat' }, ambient: { profile: 'jev', fallbacks: ['spare'], compare: 'small' } });
    const { spare: _spare, ...profiles } = value.profiles;
    expect(pathOf(() => normalizeProviderGraph({ ...value, profiles }))).toBe('purposes.ambient.fallbacks[0]');
  });

  it('still reads the legacy fields (they are migrated, D5)', () => {
    const value = graph({ defaults: { chat: 'chat', ambient: 'small', ambientFallbacks: ['spare'] }, decisions: { ambient: { profile: 'jev', mode: 'active' } } });
    expect(hasLegacyAmbientJudgeFields(value.purposes)).toBe(true);
    expect(withoutLegacyAmbientJudge(value.purposes)).toEqual({ defaults: { chat: 'chat' } });
    expect(effectiveAmbientJudgePolicy(value.purposes)).toMatchObject({ source: 'legacy', policy: { profile: 'jev', fallbacks: ['small', 'spare'] } });
    expect(providerPurposeSelections({ graph: value, context, purpose: 'ambient' }).map(entry => entry.id)).toEqual(['jev', 'small', 'spare']);
  });
});

describe('the D5 conversion table', () => {
  const legacy = (decision?: Record<string, unknown>, language = true) => graph({ defaults: { chat: 'chat', ...(language ? { ambient: 'small', ambientFallbacks: ['spare'] } : {}) },
    ...(decision ? { decisions: { ambient: decision } } : {}) }).purposes;

  it('active: the decision Profile leads, the former language judge is the first fallback, the larger threshold wins', () => {
    const result = convertLegacyAmbientJudge(legacy({ profile: 'jev', mode: 'active', minConfidence: 0.8, timeoutMs: 1500 }), { minConfidence: 0.6, mode: 'shadow' });
    expect(result.ambient).toEqual({ profile: 'jev', fallbacks: ['small', 'spare'], minConfidence: 0.8, mode: 'shadow', timeoutMs: 1500 });
    expect(convertLegacyAmbientJudge(legacy({ profile: 'jev', mode: 'active', minConfidence: 0.5 }), { minConfidence: 0.75 }).ambient.minConfidence).toBe(0.75);
    // Without either threshold set, the old default 0.7 was in force.
    expect(convertLegacyAmbientJudge(legacy({ profile: 'jev', mode: 'active' })).ambient.minConfidence).toBe(0.7);
    expect(result.notes.map(note => note.code)).toEqual(['language-judge-became-fallback', 'threshold-max']);
    expect(result.rows.find(row => row.field === 'profile')).toEqual({ field: 'profile', value: 'jev', from: 'purposes.decisions.ambient.profile' });
  });

  it('active with a language judge that followed chat: chat is not added as a fallback', () => {
    const result = convertLegacyAmbientJudge(legacy({ profile: 'jev', mode: 'active' }, false));
    expect(result.ambient).toEqual({ profile: 'jev', minConfidence: 0.7 });
    expect(result.notes.map(note => note.code)).toContain('inherited-chat-not-added');
  });

  it('shadow: the language judge stays, the decision Profile becomes the compared model, its threshold is dropped', () => {
    const result = convertLegacyAmbientJudge(legacy({ profile: 'jev', mode: 'shadow', minConfidence: 0.9, timeoutMs: 800 }), { minConfidence: 0.6 });
    expect(result.ambient).toEqual({ profile: 'small', fallbacks: ['spare'], compare: 'jev', timeoutMs: 800, minConfidence: 0.6 });
    expect(result.notes).toEqual([{ code: 'shadow-threshold-dropped', value: 0.9 }]);
  });

  it('off or absent: the language judge and the yml keys; an off decision Profile is not migrated', () => {
    expect(convertLegacyAmbientJudge(legacy({ profile: 'jev', mode: 'off' }), { mode: 'shadow' })).toMatchObject({
      ambient: { profile: 'small', fallbacks: ['spare'], mode: 'shadow' }, notes: [{ code: 'off-profile-not-migrated', value: 'jev' }] });
    expect(convertLegacyAmbientJudge(legacy()).ambient).toEqual({ profile: 'small', fallbacks: ['spare'] });
    expect(legacyAmbientTriggerKeys({ minConfidence: 0.5, mode: 'shadow', quietMs: 1 } as never)).toEqual(['minConfidence', 'mode']);
  });

  it('effective policy: stored wins and ignores the yml keys; nothing stored uses them', () => {
    expect(effectiveAmbientJudgePolicy(graph({ defaults: {}, ambient: { minConfidence: 0.9 } }).purposes, { minConfidence: 0.1, mode: 'shadow' }))
      .toEqual({ source: 'stored', policy: { minConfidence: 0.9 } });
    expect(effectiveAmbientJudgePolicy(graph().purposes, { minConfidence: 0.1, mode: 'shadow' })).toEqual({ source: 'default', policy: { minConfidence: 0.1, mode: 'shadow' } });
  });

  it('one rule for both model kinds: engage and confidence >= minConfidence', () => {
    expect(ambientJudgeWouldSpeak({ engage: true, confidence: 0.7 }, 0.7)).toBe(true);
    expect(ambientJudgeWouldSpeak({ engage: true, confidence: 0.69 }, 0.7)).toBe(false);
    expect(ambientJudgeWouldSpeak({ engage: false, confidence: 1 }, 0)).toBe(false);
  });
});

describe('importing purposes.ambient (D1.3, D5.6)', () => {
  it('accepts the string form as { profile }, the object form and null; writing it replaces the item and drops the legacy fields', async () => {
    const legacyGraph = graph({ defaults: { chat: 'chat', ambient: 'small' }, decisions: { ambient: { profile: 'jev', mode: 'shadow' }, tools: { profile: 'jev', mode: 'off' } } });
    const string = await reviewer(legacyGraph)({ ambient: 'spare' });
    expect(string.graph.purposes).toMatchObject({ ambient: { profile: 'spare' }, decisions: { tools: { profile: 'jev', mode: 'off' } } });
    expect(string.graph.purposes.defaults.ambient).toBeUndefined();
    expect(string.graph.purposes.decisions?.ambient).toBeUndefined();
    const object = await reviewer(string.graph)({ ambient: { profile: 'jev', fallbacks: ['chat'], compare: 'small', minConfidence: 0.8, mode: 'active', timeoutMs: 2000 } });
    expect(object.graph.purposes.ambient).toEqual({ profile: 'jev', fallbacks: ['chat'], compare: 'small', minConfidence: 0.8, mode: 'active', timeoutMs: 2000 });
    // Whole-item replacement: fields not written are gone.
    expect((await reviewer(object.graph)({ ambient: { minConfidence: 0.6 } })).graph.purposes.ambient).toEqual({ minConfidence: 0.6 });
    expect((await reviewer(object.graph)({ ambient: null })).graph.purposes.ambient).toBeUndefined();
    expect(changedPurposeProfileIds(string.graph.purposes, object.graph.purposes)).toEqual(expect.arrayContaining(['jev', 'chat', 'small']));
  });

  it.each([
    [{ profile: 'chat', unknown: true }, 'purposes.ambient.unknown'],
    [{ profile: 'chat', fallbacks: ['spare', 'spare'] }, 'purposes.ambient.fallbacks[1]'],
    [{ profile: 'chat', compare: 'chat' }, 'purposes.ambient.compare'],
    [{ fallbacks: ['spare'] }, 'purposes.ambient.fallbacks'],
    [{ profile: 'nope' }, 'purposes.ambient.profile'],
    [{ profile: 'chat', fallbacks: ['nope'] }, 'purposes.ambient.fallbacks[0]'],
  ])('rejects %j with invalid-plan at %s', async (ambient, path) => {
    await expect(reviewer()({ ambient })).rejects.toMatchObject({ code: 'invalid-plan', path });
  });

  it('rejects an image Profile with its path', async () => {
    await expect(reviewer()({ ambient: { profile: 'chat', compare: 'image' } })).rejects.toMatchObject({ path: 'purposes.ambient.compare' });
  });

  it('converts a deprecated purposes.decisions.ambient with a warning (active / shadow), merged with the ambient written alongside', async () => {
    const active = await reviewer()({ ambient: { profile: 'small', minConfidence: 0.6 }, decisions: { ambient: { profile: 'jev', mode: 'active', minConfidence: 0.75, timeoutMs: 900 } } });
    expect(active.graph.purposes.ambient).toEqual({ profile: 'jev', fallbacks: ['small'], minConfidence: 0.75, timeoutMs: 900 });
    expect(active.warnings).toEqual([expect.objectContaining({ path: 'purposes.decisions.ambient', code: 'deprecated-decisions-ambient' })]);
    expect(active.graph.purposes.decisions?.ambient).toBeUndefined();
    const shadow = await reviewer(graph({ defaults: { chat: 'chat' }, ambient: { profile: 'small' } }))({ decisions: { ambient: { profile: 'jev', mode: 'shadow' } } });
    expect(shadow.graph.purposes.ambient).toEqual({ profile: 'small', compare: 'jev' });
    expect(shadow.warnings).toHaveLength(1);
    const off = await reviewer(graph({ defaults: { chat: 'chat' }, ambient: { profile: 'small' } }))({ decisions: { ambient: { mode: 'off' }, tools: { profile: 'jev', mode: 'active' } } });
    expect(off.graph.purposes).toMatchObject({ ambient: { profile: 'small' }, decisions: { tools: { profile: 'jev', mode: 'active' } } });
    expect(off.graph.purposes.decisions?.ambient).toBeUndefined();
  });

  it('rejects purposes.decisions.ambient once the deprecation window has ended', async () => {
    await expect(reviewer(undefined, { legacyAmbientDecisions: 'reject' })({ decisions: { ambient: { profile: 'jev', mode: 'active' } } }))
      .rejects.toMatchObject({ code: 'invalid-plan', path: 'purposes.decisions.ambient' });
  });

  it('keeps every judge Profile the Host\'s own', async () => {
    const empty = createEmptyProviderGraph('root');
    await expect(reviewProviderPlan({ input: { version: 1, purposes: { ambient: 'x' } }, graph: empty, ownerId: 'user:1', hostOwnerId: HOST,
      createId: () => 'id', resolveService: () => { throw new Error('none'); } })).rejects.toThrow();
  });
});
