import { createEmptyProviderGraph, normalizeProviderGraph } from '../../src/provider/graph.js';
import { changedPurposeProfileIds, reviewProviderPlan } from '../../src/provider/plan.js';
import { providerPurposeProfiles, providerPurposeSelections } from '../../src/provider/selection.js';
import { context, graphFixture, HOST } from './fixtures.js';

/** #1250 chat-purpose-no-fallback: every language purpose carries an ordered fallback chain. */
function reviewer(graph = createEmptyProviderGraph('root'), ownerId = HOST) {
  let sequence = 0;
  return (input: unknown, bindings?: Parameters<typeof reviewProviderPlan>[0]['bindings']) => reviewProviderPlan({
    input, graph, ownerId, hostOwnerId: HOST, bindings, createId: kind => `${kind}:${++sequence}`,
    resolveService: options => ({ driver: typeof options.driver === 'string' ? { id: options.driver, owner: 'root/providers', contractVersion: '1' } : options.driver,
      options: options.options, models: options.models }),
  });
}
const document = {
  version: 1,
  services: { products: { driver: 'fixture', models: {
    text: { id: 'text', kinds: ['language'], protocol: 'fixture' },
    image: { id: 'image', kinds: ['image'], protocol: 'fixture' },
  } } },
  accounts: { gemini: { service: 'products', auth: { method: 'none' } }, cnb: { service: 'products', auth: { method: 'none' } },
    deepseek: { service: 'products', auth: { method: 'none' } } },
  profiles: { free: { account: 'gemini', model: 'text' }, cnb: { account: 'cnb', model: 'text' }, deep: { account: 'deepseek', model: 'text' },
    picture: { account: 'gemini', model: 'image' } },
  purposes: {
    chat: { profile: 'free', fallbacks: ['cnb', 'deep'] },
    summary: { profile: 'free', fallbacks: ['deep'] },
    ambient: 'free',
    agents: { researcher: { profile: 'free', fallbacks: ['cnb'] } },
    adapters: { qq: { chat: { profile: 'free', fallbacks: ['deep'] } } },
    scenes: { 'sandbox:group': { chat: { profile: 'cnb', fallbacks: ['deep'] } } },
  },
};

function withChains() {
  const graph = graphFixture();
  const base = { rootId: 'root', ownerId: HOST, revision: 1, accountId: 'account', model: 'text', parameters: {} };
  return normalizeProviderGraph({ ...graph, profiles: { ...graph.profiles, b: { ...base, id: 'b' }, c: { ...base, id: 'c' }, d: { ...base, id: 'd' } },
    purposes: { ...graph.purposes, defaults: { ...graph.purposes.defaults, chatFallbacks: ['b', 'c'] },
      agents: { researcher: 'b' }, agentFallbacks: { researcher: ['c'] },
      adapters: { qq: { chat: 'd', chatFallbacks: ['c'] }, plain: { chat: 'b' } },
      scenes: { scene: { chat: 'c', chatFallbacks: ['d'] } } } });
}

describe('purpose fallbacks in the plan and graph (#1250)', () => {
  it('compiles string and { profile, fallbacks } purposes into primary + sibling chains', async () => {
    const result = await reviewer()(document);
    const id = (alias: string) => result.bindings.profiles[alias];
    const purposes = result.graph.purposes;
    expect(purposes.defaults.chat).toBe(id('free'));
    expect(purposes.defaults.chatFallbacks).toEqual([id('cnb'), id('deep')]);
    expect(purposes.defaults.summaryFallbacks).toEqual([id('deep')]);
    expect(purposes.defaults.ambient).toBe(id('free'));
    expect(purposes.defaults.ambientFallbacks).toBeUndefined();
    expect(purposes.agents).toEqual({ researcher: id('free') });
    expect(purposes.agentFallbacks).toEqual({ researcher: [id('cnb')] });
    expect(purposes.adapters?.qq).toEqual({ chat: id('free'), chatFallbacks: [id('deep')] });
    expect(purposes.scenes?.['sandbox:group']).toEqual({ chat: id('cnb'), chatFallbacks: [id('deep')] });
  });

  it('replaces a whole chain on write and clears it with the purpose', async () => {
    const first = await reviewer()(document);
    const id = (alias: string) => first.bindings.profiles[alias];
    const rewritten = await reviewer(first.graph)({ version: 1, purposes: { chat: { profile: 'deep' }, agents: { researcher: 'deep' } } }, first.bindings);
    expect(rewritten.graph.purposes.defaults.chat).toBe(id('deep'));
    expect(rewritten.graph.purposes.defaults.chatFallbacks).toBeUndefined();
    expect(rewritten.graph.purposes.agentFallbacks).toBeUndefined();
    // Untouched purposes keep their chains.
    expect(rewritten.graph.purposes.defaults.summaryFallbacks).toEqual([id('deep')]);
    const cleared = await reviewer(first.graph)({ version: 1, purposes: { summary: null, agents: { researcher: null } } }, first.bindings);
    expect(cleared.graph.purposes.defaults.summary).toBeUndefined();
    expect(cleared.graph.purposes.defaults.summaryFallbacks).toBeUndefined();
    expect(cleared.graph.purposes.agentFallbacks).toBeUndefined();
  });

  it('rejects empty, duplicate, self-referencing and image chains', async () => {
    const plan = (purposes: unknown) => reviewer()({ ...document, purposes });
    await expect(plan({ chat: { profile: 'free', fallbacks: [] } })).rejects.toThrow('invalid-plan');
    await expect(plan({ chat: { profile: 'free', fallbacks: ['cnb', 'cnb'] } })).rejects.toThrow('invalid-plan');
    await expect(plan({ chat: { profile: 'free', fallbacks: ['free'] } })).rejects.toThrow('invalid-plan');
    await expect(plan({ chat: { profile: 'free', fallbacks: ['missing'] } })).rejects.toThrow('invalid-plan');
    await expect(plan({ image: { profile: 'picture', fallbacks: ['picture'] } })).rejects.toThrow('invalid-plan');
    // A decision-only or image Profile cannot be a language fallback.
    await expect(plan({ chat: { profile: 'free', fallbacks: ['picture'] } })).rejects.toThrow('invalid-graph');
    const graph = graphFixture();
    expect(() => normalizeProviderGraph({ ...graph, purposes: { defaults: { chatFallbacks: ['text'] } } })).toThrow('invalid-graph');
    expect(() => normalizeProviderGraph({ ...graph, purposes: { defaults: { chat: 'text' }, agentFallbacks: { x: ['text'] } } })).toThrow('invalid-graph');
  });

  it('keeps fallback Profiles host-owned like every deployment purpose', async () => {
    const graph = graphFixture();
    const personal = normalizeProviderGraph({ ...graph,
      accounts: { ...graph.accounts, mine: { ...graph.accounts.account, id: 'mine', ownerId: 'alice', incarnation: 'alice' } },
      profiles: { ...graph.profiles, mine: { ...graph.profiles.text, id: 'mine', accountId: 'mine', ownerId: 'alice' } } });
    await expect(reviewer(personal)({ version: 1, purposes: { chat: { profile: 'text', fallbacks: ['mine'] } } },
      { services: {}, accounts: {}, profiles: { text: 'text', mine: 'mine' } })).rejects.toThrow('forbidden');
  });

  it('reports fallback references as changed purpose Profiles', () => {
    const graph = withChains();
    const changed = normalizeProviderGraph({ ...graph, purposes: { ...graph.purposes, defaults: { ...graph.purposes.defaults, chatFallbacks: ['d'] } } });
    expect(changedPurposeProfileIds(graph.purposes, changed.purposes)).toEqual(['d']);
  });
});

describe('purpose fallback selection (#1250)', () => {
  it('orders default, summary-inherited and agent chains', () => {
    const graph = withChains();
    expect(providerPurposeProfiles({ graph, context, purpose: 'chat' })).toEqual(['text', 'b', 'c']);
    // Summary without its own Profile inherits chat and chat's chain.
    expect(providerPurposeProfiles({ graph, context, purpose: 'summary' })).toEqual(['text', 'b', 'c']);
    expect(providerPurposeProfiles({ graph, context, purpose: 'agent:researcher' })).toEqual(['b', 'c']);
    expect(providerPurposeSelections({ graph, context, purpose: 'agent:researcher' })[1]?.source).toEqual({ level: 'agent', name: 'researcher' });
  });
  it('honours an adapter / scene override with its own chain, never an outer layer’s', () => {
    const graph = withChains();
    expect(providerPurposeProfiles({ graph, context: { ...context, adapterKey: 'qq' }, purpose: 'chat' })).toEqual(['d', 'c']);
    expect(providerPurposeSelections({ graph, context: { ...context, adapterKey: 'qq' }, purpose: 'chat' })[1]?.source)
      .toEqual({ level: 'adapter', key: 'qq' });
    // An override without fallbacks drops the default chain instead of inheriting it.
    expect(providerPurposeProfiles({ graph, context: { ...context, adapterKey: 'plain' }, purpose: 'chat' })).toEqual(['b']);
    expect(providerPurposeProfiles({ graph, context: { ...context, adapterKey: 'qq', sceneKey: 'scene' }, purpose: 'chat' })).toEqual(['c', 'd']);
  });
});
