import { normalizeProviderGraph, createEmptyProviderGraph, reviewProviderPlan } from '@zhin.js/ai/provider';
import { graphFixture } from '../../../ai/tests/provider/fixtures.js';
import { AIService } from '../../src/service.js';

it('completes plan aliases only through explicit Host review, allocating real IDs and owner once', async () => {
  let sequence = 0;
  const plan = { version: 1, services: { main: { driver: 'fixture', models: graphFixture().services.service.models } }, accounts: { bot: { service: 'main', auth: { method: 'none' } } }, profiles: { chosen: { account: 'bot', model: 'text' } }, purposes: { chat: { profile: 'chosen' } } };
  const output = await reviewProviderPlan({ input: plan, graph: createEmptyProviderGraph('root'), ownerId: 'host', hostOwnerId: 'host', createId: kind => `${kind}:${++sequence}`,
    resolveService: input => ({ driver: { id: 'fixture', owner: 'root/providers', contractVersion: '1' }, options: input.options, models: input.models }) });
  expect(output.graph.profiles[output.bindings.profiles.chosen].ownerId).toBe('host');
  expect(output.graph.profiles[output.bindings.profiles.chosen].id).not.toBe('chosen');
  expect(plan.profiles.chosen).toEqual({ account: 'bot', model: 'text' });
});

it('does not accept authored IDs, owners, secrets, permissions or factory payloads as plan resource overrides', async () => {
  for (const key of ['id', 'ownerId', 'apiKey', 'headers', 'hostFactoryData', 'permission']) {
    await expect(reviewProviderPlan({ input: { version: 1, services: { main: { driver: 'fixture', [key]: 'synthetic-private-value' } } }, graph: createEmptyProviderGraph('root'), ownerId: 'host', hostOwnerId: 'host', createId: () => 'new',
      resolveService: () => { throw new Error('Invalid public input must not reach a Driver'); } })).rejects.toThrow('invalid-plan');
  }
});

it('retains generic graph identity validation without implicitly replacing a declared owner', () => {
  const graph = graphFixture();
  expect(() => normalizeProviderGraph({ ...graph, services: { service: { ...graph.services.service, id: 'different-id' } } })).toThrow('invalid-graph');
  expect(() => normalizeProviderGraph({ ...graph, accounts: { account: { ...graph.accounts.account, rootId: 'other' } } })).toThrow('invalid-graph');
  expect(graph.services.service.ownerId).toBe('host:test');
});

it('preserves strict unknown-field and nonpositive capability metadata rejection', () => {
  const graph = graphFixture();
  for (const invalid of [
    { ...graph, apiKey: 'synthetic-private-key' },
    { ...graph, profiles: { ...graph.profiles, text: { ...graph.profiles.text, factory: {} } } },
    { ...graph, services: { service: { ...graph.services.service, models: { ...graph.services.service.models, text: { ...graph.services.service.models.text, contextWindow: -1 } } } } },
    { ...graph, services: { service: { ...graph.services.service, models: { ...graph.services.service.models, text: { ...graph.services.service.models.text, madeUpCapability: true } } } } },
  ]) {
    try { normalizeProviderGraph(invalid); throw new Error('Accepted invalid graph'); }
    catch (error) { expect(String(error)).toContain('invalid-graph'); expect(String(error)).not.toContain('synthetic-private-key'); }
  }
});

it('returns detached frozen resource data without mutating the submitted graph', () => {
  const input = structuredClone(graphFixture()), before = structuredClone(input), output = normalizeProviderGraph(input);
  expect(input).toEqual(before);
  input.profiles.text.parameters = { temperature: 0.7 };
  expect(output.profiles.text.parameters).toEqual({});
  expect(Object.isFrozen(output)).toBe(true); expect(Object.isFrozen(output.services.service.models.text.input)).toBe(true);
});

it('rejects nonenumerable and symbol fields instead of dropping hidden authority data', () => {
  for (const key of ['apiKey', Symbol('private-factory')]) {
    const graph = structuredClone(graphFixture()); Object.defineProperty(graph, key, { value: 'synthetic-hidden-key', enumerable: false });
    expect(() => normalizeProviderGraph(graph)).toThrow('invalid-graph');
  }
});

it('requires offline review for old shorthand instead of adding an implicit runtime compiler', () => {
  expect(() => new AIService({ modelCatalog: { connections: {}, models: {}, presets: {} } })).toThrow('migration required');
});
