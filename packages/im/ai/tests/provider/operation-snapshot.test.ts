import { normalizeProviderGraph, createProfileReference, persistentProfileSelection } from '../../src/provider/index.js';
import { defineProvider } from '../../src/provider/driver.js';
import { ProviderBindingResourceOwner, createProviderResourceKey } from '../../src/provider/resources.js';
import { assistant, context, graphFixture, runtimeFixture } from './fixtures.js';

it('uses one captured turn graph for Host decisions and personal chat without borrowing the Host owner', async () => {
  const graph = graphFixture();
  const old = normalizeProviderGraph({ ...graph,
    accounts: { ...graph.accounts, alice: { ...graph.accounts.account, id: 'alice', ownerId: 'alice' } },
    profiles: { ...graph.profiles, private: { ...graph.profiles.text, id: 'private', accountId: 'alice', ownerId: 'alice', parameters: { maxOutputTokens: 37 } } },
  });
  const generationIdentity = {};
  const before = runtimeFixture({ graph: old, generationIdentity });
  const outer = await before.runtime.openScope({ context });
  expect((await outer.resolve({ kind: 'decision', purpose: 'decision:tools' })).profile.id).toBe('decision');
  const changed = normalizeProviderGraph({ ...old, revision: 2,
    profiles: { ...old.profiles, private: { ...old.profiles.private, revision: 2, parameters: { maxOutputTokens: 89 } } } });
  const after = runtimeFixture({ graph: changed, generationIdentity });
  const binding = { graphRevision: old.revision, profile: old.profiles.private, account: old.accounts.alice,
    service: old.services.service, model: old.services.service.models.text };
  const personal = { ...context, ownerId: 'alice', sessionChat: persistentProfileSelection(createProfileReference({ binding, kind: 'language' })) };
  const inner = await after.runtime.openScope({ context: personal, snapshot: outer.snapshot });
  expect(inner.graph.revision).toBe(1);
  expect((await inner.resolve({ kind: 'language', purpose: 'chat' })).profile.parameters.maxOutputTokens).toBe(37);
  expect(inner.context.ownerId).toBe('alice');
  const next = await after.runtime.openScope({ context: { ...personal, operationId: 'next-turn' } });
  expect(next.graph.revision).toBe(2);
  expect((await next.resolve({ kind: 'language', purpose: 'chat' })).profile.parameters.maxOutputTokens).toBe(89);
  await expect(after.runtime.openScope({ context: { ...personal, operationId: 'foreign-turn' }, snapshot: outer.snapshot })).rejects.toThrow('forbidden');
  const foreignGeneration = runtimeFixture({ graph: changed, generationIdentity: {} });
  await expect(foreignGeneration.runtime.openScope({ context: personal, snapshot: outer.snapshot })).rejects.toThrow('forbidden');
  expect(JSON.stringify(outer.snapshot)).toBe('{}');
  await inner.close(); await next.close(); await outer.close();
});

it('does not let an out-of-order old graph retire the shared pool state for a newer operation', async () => {
  let created = 0, disposed = 0;
  const resources = new ProviderBindingResourceOwner(() => undefined);
  const key = createProviderResourceKey<{ ordinal: number }>('snapshot-test');
  const seen: number[] = [];
  const definition = defineProvider({ id: 'fixture', contractVersion: '1', serviceSchema: { parse: (value: unknown) => value },
    authentication: { methods: ['none'] }, targets: () => ({ authentication: [], inference: [] }), models: service => service.models,
    createExecution(options) {
      const state = options.resources.getOrCreate({ key, create: () => ({ value: { ordinal: ++created }, dispose: () => { disposed++; } }) });
      return { language: { generate: async () => { seen.push(state.ordinal); return assistant(); },
        stream: async () => (async function* () {})() } };
    },
  });
  const old = graphFixture();
  const latest = normalizeProviderGraph({ ...old, revision: 2,
    profiles: { ...old.profiles, text: { ...old.profiles.text, revision: 2, parameters: { temperature: 0.1 } } } });
  const newRuntime = () => runtimeFixture({ graph: latest, resources, definition }).runtime;
  const first = await newRuntime().openOperation({ context });
  await first.generate({ purpose: 'chat', request: { context: { systemPrompt: '', messages: [] } } });
  await first.close();
  const late = await runtimeFixture({ graph: old, resources, definition }).runtime.openOperation({ context });
  await late.generate({ purpose: 'chat', request: { context: { systemPrompt: '', messages: [] } } });
  await late.close();
  const again = await newRuntime().openOperation({ context });
  await again.generate({ purpose: 'chat', request: { context: { systemPrompt: '', messages: [] } } });
  await again.close();
  expect(seen).toEqual([1, 2, 1]);
  expect(disposed).toBe(1);
  resources.retire(); expect(disposed).toBe(2);
});

it('lets older and newer generation drivers finish without retiring each other by arrival order', () => {
  const owner = new ProviderBindingResourceOwner(() => undefined);
  const key = createProviderResourceKey<object>('generation-data');
  const graph = graphFixture();
  const binding = { graphRevision: 1, service: graph.services.service, account: graph.accounts.account,
    profile: graph.profiles.text, model: graph.services.service.models.text };
  const definition = () => defineProvider({ id: 'fixture', contractVersion: '1', authentication: { methods: ['none'] },
    serviceSchema: { parse: (value: unknown) => value }, targets: () => ({ authentication: [], inference: [] }),
    models: service => service.models, createExecution: () => ({}) });
  const oldDriver = definition(), newDriver = definition();
  let disposed = 0;
  const newer = owner.acquire({ binding, driver: newDriver });
  const state = newer.resources.getOrCreate({ key, create: () => ({ value: {}, dispose: () => { disposed++; } }) });
  newer.release();
  const delayedOlder = owner.acquire({ binding, driver: oldDriver });
  delayedOlder.resources.getOrCreate({ key, create: () => ({ value: {}, dispose: () => { disposed++; } }) });
  owner.retireDriver(oldDriver);
  expect(disposed).toBe(0); // Active older work owns its state until release.
  delayedOlder.release(); expect(disposed).toBe(1);
  const again = owner.acquire({ binding, driver: newDriver });
  expect(again.resources.getOrCreate({ key, create: () => { throw new Error('new generation state was incorrectly retired'); } })).toBe(state);
  again.release(); owner.retireDriver(newDriver); expect(disposed).toBe(2);
});
