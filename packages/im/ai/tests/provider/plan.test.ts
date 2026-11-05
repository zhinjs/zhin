import { createEmptyProviderGraph, normalizeProviderGraph } from '../../src/provider/graph.js';
import { reviewProviderPlan } from '../../src/provider/plan.js';
import { graphFixture, HOST } from './fixtures.js';

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
    text: { id: 'text', kinds: ['language'], protocol: 'fixture', streaming: true },
    judgment: { id: 'judgment', kinds: ['decision'], protocol: 'fixture' },
  } } },
  accounts: { primary: { service: 'products', auth: { method: 'oauth' } }, secondary: { service: 'products', auth: { method: 'oauth' } } },
  profiles: { daily: { account: 'primary', model: 'text' }, review: { account: 'primary', model: 'judgment' } },
  purposes: { chat: { profile: 'daily' }, decisions: { tools: { profile: 'review', mode: 'shadow' } } },
};
describe('explicit provider plan compiler', () => {
  it('creates separate account identities, compiles aliases and never starts authentication', async () => {
    const result = await reviewer()(document);
    expect(result.baseRevision).toBe(0); expect(result.graph.revision).toBe(1);
    const accounts = Object.values(result.graph.accounts);
    expect(accounts).toHaveLength(2); expect(accounts[0].incarnation).not.toBe(accounts[1].incarnation);
    expect(result.graph.purposes.defaults.chat).toBe(result.bindings.profiles.daily);
    expect(result.graph.purposes.decisions?.tools).toEqual({ profile: result.bindings.profiles.review, mode: 'shadow' });
    expect(JSON.stringify(result.graph)).not.toContain('accessToken');
  });
  it('requires explicit mappings to update, does not match names and retains unchanged resource versions', async () => {
    const first = await reviewer()(document);
    const same = await reviewer(first.graph)(document, first.bindings);
    expect(same.changes.profiles.updated).toEqual([]);
    expect(same.graph.profiles[first.bindings.profiles.daily].revision).toBe(1);
    let n = 100;
    const another = await reviewProviderPlan({ input: document, graph: first.graph, ownerId: HOST, hostOwnerId: HOST,
      createId: kind => `${kind}:${++n}`, resolveService: options => ({ driver: typeof options.driver === 'string' ? { id: options.driver, owner: 'root/providers', contractVersion: '1' } : options.driver,
        options: options.options, models: options.models }) });
    expect(Object.keys(another.graph.accounts)).toHaveLength(4);
    expect(another.bindings.accounts.primary).not.toBe(first.bindings.accounts.primary);
  });
  it('does not delete omitted objects, and rejects unresolved removals', async () => {
    const graph = graphFixture();
    const noChange = await reviewer(graph)({ version: 1 });
    expect(Object.keys(noChange.graph.profiles)).toEqual(Object.keys(graph.profiles));
    await expect(reviewer(graph)({ version: 1, remove: { profiles: ['text'] } })).rejects.toThrow('invalid-graph');
    const removed = await reviewer(graph)({ version: 1, purposes: { chat: null }, remove: { profiles: ['text'] } });
    expect(removed.graph.profiles.text).toBeUndefined(); expect(removed.graph.purposes.defaults.chat).toBeUndefined();
    expect(graph.profiles.text).toBeDefined();
  });
  it('explicitly clears roles and scope references in the same resource-deletion plan', async () => {
    const graph = graphFixture();
    const withScopes = normalizeProviderGraph({ ...graph, purposes: { ...graph.purposes,
      agents: { reviewer: 'text' }, adapters: { adapter: { chat: 'text' } }, endpoints: { endpoint: { chat: 'text' } }, scenes: { scene: { chat: 'text' } } } });
    const cleared = await reviewer(withScopes)({ version: 1, purposes: {
      chat: null, agents: { reviewer: null }, adapters: { adapter: null }, endpoints: { endpoint: null }, scenes: { scene: null },
    }, remove: { profiles: ['text'] } });
    expect(cleared.graph.purposes.agents).toEqual({}); expect(cleared.graph.purposes.endpoints).toEqual({});
    expect(cleared.changes.profiles.removed).toEqual(['text']);
  });
  it('forbids service target/account identity changes in place', async () => {
    const graph = graphFixture();
    await expect(reviewer(graph)({ version: 1, services: { changed: { driver: 'fixture', options: { baseUrl: 'https://new.example' }, models: graph.services.service.models } } },
      { services: { changed: 'service' } })).rejects.toThrow('plan-conflict');
    await expect(reviewer(graph)({ version: 1, accounts: { changed: { service: 'existing', auth: { method: 'oauth' } } } },
      { services: { existing: 'service' }, accounts: { changed: 'account' } })).rejects.toThrow('plan-conflict');
  });
  it('does not let private resources become deployment scope choices or edit another owner', async () => {
    const graph = graphFixture();
    await expect(reviewer(graph, 'alice')({ version: 1, services: { existing: { driver: 'fixture', models: graph.services.service.models } } },
      { services: { existing: 'service' } })).rejects.toThrow('forbidden');
    const privateGraph = normalizeProviderGraph({ ...graph,
      accounts: { ...graph.accounts, alice: { ...graph.accounts.account, id: 'alice', ownerId: 'alice', incarnation: 'alice' } },
      profiles: { ...graph.profiles, alice: { ...graph.profiles.text, id: 'alice', ownerId: 'alice', accountId: 'alice' } } });
    await expect(reviewer(privateGraph)({ version: 1, purposes: { endpoints: { group: { chat: { profile: 'private' } } } } },
      { profiles: { private: 'alice' } })).rejects.toThrow('forbidden');
    await expect(reviewer(privateGraph, 'alice')({ version: 1, purposes: { chat: { profile: 'private' } } },
      { profiles: { private: 'alice' } })).rejects.toThrow('forbidden');
  });
  it('rejects literal secret sources and wrong-language decision bindings', async () => {
    const malformed = structuredClone(document);
    Object.assign(malformed.accounts.primary, { auth: { method: 'api-key', source: 'a-literal-secret' } });
    await expect(reviewer()(malformed)).rejects.toThrow('invalid-graph');
    await expect(reviewer()({ ...document, purposes: { decisions: { tools: { profile: 'daily', mode: 'active' } } } })).rejects.toThrow('invalid-graph');
  });
});

it('accepts exact Driver identity and refuses a resolver that ignores its owner or contract', async () => {
  const reference = { id: 'fixture', owner: 'root/provider-a', contractVersion: '1' };
  const explicit = { version: 1, services: { product: { driver: reference, models: graphFixture().services.service.models } } };
  const result = await reviewer()(explicit);
  expect(Object.values(result.graph.services)[0].driver).toEqual(reference);
  for (const mismatch of [{ ...reference, owner: 'root/provider-b' }, { ...reference, contractVersion: '2' }]) {
    await expect(reviewProviderPlan({ input: explicit, graph: createEmptyProviderGraph('root'), ownerId: HOST, hostOwnerId: HOST,
      createId: kind => `${kind}:new`, resolveService: input => ({ driver: mismatch, options: input.options, models: input.models }) })).rejects.toThrow('driver-contract-mismatch');
  }
  const graph = graphFixture();
  await expect(reviewer(graph)(explicit, { services: { product: 'service' } })).rejects.toThrow('plan-conflict');
});

it('compiles and explicitly clears the independent ambient Language purpose', async () => {
  const configured = await reviewer()({ ...document, purposes: { ...document.purposes, ambient: { profile: 'daily' } } });
  expect(configured.graph.purposes.defaults.ambient).toBe(configured.bindings.profiles.daily);
  const cleared = await reviewer(configured.graph)({ version: 1, purposes: { ambient: null } });
  expect(cleared.graph.purposes.defaults.ambient).toBeUndefined();
  await expect(reviewer()({ ...document, purposes: { ambient: { profile: 'review' } } })).rejects.toThrow('invalid-graph');
});


it('updates non-identity Service settings in place while requiring new identity for audience changes', async () => {
  const source = graphFixture();
  const options = { baseUrl: 'https://provider.test/v1', issuer: 'issuer-a', product: 'paid-a', tenant: 'tenant-a', compat: 'old', cache: false };
  const graph = normalizeProviderGraph({ ...source, services: { service: { ...source.services.service, options } } });
  const review = (next: typeof options) => reviewProviderPlan({
    graph, ownerId: HOST, hostOwnerId: HOST, input: { version: 1, services: { existing: { driver: graph.services.service.driver, options: next, models: graph.services.service.models } } },
    bindings: { services: { existing: 'service' } }, createId: () => { throw new Error('No identity allocation expected'); },
    resolveService: input => ({ driver: graph.services.service.driver, options: input.options, models: input.models,
      identity: service => { const value = service.options; return { baseUrl: value.baseUrl, issuer: value.issuer, product: value.product, tenant: value.tenant }; } }),
  });
  const next = await review({ ...options, compat: 'new', cache: true });
  expect(next.graph.services.service.revision).toBe(2);
  expect(next.graph.accounts.account).toEqual(graph.accounts.account);
  expect(graph.services.service.options.compat).toBe('old');
  expect(next.graph.services.service).not.toHaveProperty('identity');
  for (const key of ['baseUrl', 'issuer', 'product', 'tenant'] as const) {
    await expect(review({ ...options, [key]: `${options[key]}-changed` })).rejects.toThrow('plan-conflict');
  }
});

it('rejects undefined or invisible Decision Profiles at save and import (ADR 0047 S3)', async () => {
  // Undefined alias fails at save (plan review) without inventing a Profile.
  await expect(reviewer()({ version: 1, purposes: { decisions: { tools: { profile: 'missing', mode: 'active' } } } })).rejects.toThrow('invalid-plan');
  const graph = graphFixture();
  // Undefined Profile id fails at import/normalize.
  expect(() => normalizeProviderGraph({ ...graph, purposes: { ...graph.purposes,
    decisions: { tools: { profile: 'missing', mode: 'active' } } } })).toThrow('invalid-graph');
  // Active purpose without a Profile is invalid at normalize (import) time.
  expect(() => normalizeProviderGraph({ ...graph, purposes: { ...graph.purposes,
    decisions: { skills: { mode: 'active' } } } })).toThrow('invalid-graph');
  // Invisible to deployment: a private Profile must not become a Host Decision purpose.
  const privateGraph = normalizeProviderGraph({ ...graph,
    accounts: { ...graph.accounts, alice: { ...graph.accounts.account, id: 'alice', ownerId: 'alice', incarnation: 'alice' } },
    profiles: { ...graph.profiles, alice: { ...graph.profiles.decision, id: 'alice', ownerId: 'alice', accountId: 'alice' } } });
  await expect(reviewer(privateGraph)({ version: 1, purposes: { decisions: { tools: { profile: 'private', mode: 'active' } } } },
    { profiles: { private: 'alice' } })).rejects.toThrow('forbidden');
  await expect(reviewer(privateGraph, 'alice')({ version: 1, purposes: { decisions: { tools: { profile: 'private', mode: 'active' } } } },
    { profiles: { private: 'alice' } })).rejects.toThrow('forbidden');
});
