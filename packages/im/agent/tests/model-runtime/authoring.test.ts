import { createModelCatalog, ModelCatalogError, normalizeModelCatalogConfig } from '@zhin.js/ai/model-catalog';
import { normalizeHostModelCatalog } from '../../src/model-runtime/authoring.js';
import { ModelRuntimeService } from '../../src/model-runtime/service.js';
import { compileModelRuntimeConfig } from '../../src/model-runtime/compiler.js';

const host = 'host:/authoring-test';
function shorthand() {
  return {
    connections: { main: { revision: 3, sdk: 'openai-compatible' as const, baseUrl: 'https://model.test/v1', secretRef: 'vault:host-ref' } },
    models: { chat: { connectionId: 'main', model: 'selected-model', capabilities: { input: ['text' as const], toolCalling: true } } },
    presets: { chosen: { modelId: 'chat' } },
  };
}
function complete() {
  const value = shorthand();
  return {
    connections: { main: { ...value.connections.main, id: 'main', ownerId: host } },
    models: { chat: { ...value.models.chat, id: 'chat' } },
    presets: { chosen: { ...value.presets.chosen, id: 'chosen' } },
  };
}

it('compiles Host shorthand to the same strict catalog as the complete form', () => {
  const policy = { defaults: { chat: 'chosen' } };
  const simplified = compileModelRuntimeConfig({ modelCatalog: shorthand(), modelPolicy: policy }, host);
  const full = compileModelRuntimeConfig({ modelCatalog: complete(), modelPolicy: policy }, host);
  expect(simplified.catalogConfig).toEqual(full.catalogConfig);
  expect(simplified.catalogConfig).toEqual(normalizeModelCatalogConfig(complete()));
});

it('does not relax the generic personal catalog contract', () => {
  expect(() => normalizeModelCatalogConfig(shorthand())).toThrow(ModelCatalogError);
  const personal = complete();
  personal.connections.main.ownerId = 'im-owner:alice';
  const catalog = createModelCatalog(personal);
  expect(catalog.resolve('chosen', { ownerId: 'im-owner:alice', hostOwnerId: host }).connection.ownerId).toBe('im-owner:alice');
  expect(() => catalog.resolve('chosen', { ownerId: 'im-owner:bob', hostOwnerId: host })).toThrow('connection-forbidden');
});

it.each(['connections', 'models', 'presets'] as const)('rejects a conflicting explicit %s id', collection => {
  const value = complete();
  const entry = Object.values(value[collection])[0]!;
  entry.id = 'different-id';
  expect(() => normalizeHostModelCatalog(value, host)).toThrow('invalid-config');
});

it('rejects an explicit external owner instead of reassigning it to the Host', () => {
  const value = complete(); value.connections.main.ownerId = 'im-owner:alice';
  expect(() => normalizeHostModelCatalog(value, host)).toThrow('deployment-owner-mismatch');
  expect(value.connections.main.ownerId).toBe('im-owner:alice');
});

it('keeps revision mandatory and preserves strict unknown-field and capability validation', () => {
  const value = shorthand();
  const { revision, ...withoutRevision } = value.connections.main;
  expect(revision).toBe(3);
  expect(() => normalizeHostModelCatalog({ ...value, connections: { main: withoutRevision } }, host)).toThrow('invalid-config');
  for (const invalid of [
    { ...value, apiKey: 'synthetic-forbidden-key' },
    { ...value, connections: { main: { ...value.connections.main, apiKey: 'synthetic-forbidden-key' } } },
    { ...value, models: { chat: { ...value.models.chat, capabilities: { extraCapability: true } } } },
    { ...value, presets: { chosen: { ...value.presets.chosen, hostFactoryData: { apiKey: 'synthetic-forbidden-key' } } } },
  ]) {
    try { normalizeHostModelCatalog(invalid, host); throw new Error('Accepted invalid catalog'); }
    catch (error) { expect(error).toBeInstanceOf(ModelCatalogError); expect(String(error)).not.toContain('synthetic-forbidden-key'); }
  }
});

it('returns detached frozen catalog data without mutating the authored input', () => {
  const input = shorthand(); const before = structuredClone(input);
  const output = normalizeHostModelCatalog(input, host);
  expect(input).toEqual(before);
  input.connections.main.baseUrl = 'https://changed.test/v1';
  input.models.chat.capabilities.input.push('text');
  expect(output.connections.main.baseUrl).toBe('https://model.test/v1');
  expect(output.models.chat.capabilities.input).toEqual(['text']);
  expect(Object.isFrozen(output)).toBe(true);
  expect(Object.isFrozen(output.connections.main)).toBe(true);
  expect(Object.isFrozen(output.models.chat.capabilities.input)).toBe(true);
});

it('keeps legacy secrets and execution factory data out of the completed catalog', () => {
  const compiled = compileModelRuntimeConfig({ modelCatalog: shorthand(), modelPolicy: { defaults: { chat: 'chosen' } },
    providers: { main: { sdk: 'openai-compatible', models: ['selected-model'], apiKey: 'synthetic-private-key', headers: { 'X-Private': 'synthetic-private-header' } } },
  }, host);
  const serialized = JSON.stringify(compiled.catalogConfig);
  expect(serialized).not.toMatch(/synthetic-private-key|synthetic-private-header|apiKey|hostFactoryData|headers/);
  expect(compiled.hostFactoryData.get('main')).toMatchObject({ origin: 'explicit', config: { apiKey: 'synthetic-private-key' } });
});

it('completes only the Host catalog and preserves separately loaded personal identities', async () => {
  const personal = {
    connections: { privateConnection: { id: 'privateConnection', ownerId: 'im-owner:alice', revision: 1, sdk: 'ollama' as const, baseUrl: 'https://personal.test' } },
    models: { privateModel: { id: 'privateModel', connectionId: 'privateConnection', model: 'personal-model', capabilities: { input: ['text' as const] } } },
    presets: { privateChat: { id: 'privateChat', modelId: 'privateModel' } },
  };
  const before = structuredClone(personal);
  const runtime = new ModelRuntimeService({ hostOwnerId: host,
    config: { modelCatalog: shorthand(), modelPolicy: { defaults: { chat: 'chosen' } } },
    personalCatalogSnapshot: async owner => owner === 'im-owner:alice' ? personal : undefined,
  });
  try {
    const invocation = await runtime.resolvePreset('privateChat', { ownerId: 'im-owner:alice' });
    expect(invocation.connection.ownerId).toBe('im-owner:alice');
    expect(invocation.model.id).toBe('privateModel');
    expect(runtime.getCatalogConfig().connections.main.ownerId).toBe(host);
    expect(runtime.getCatalogConfig().connections.privateConnection).toBeUndefined();
    expect(personal).toEqual(before);
  } finally { await runtime.dispose(); }
});

it('preserves strict rejection of nonenumerable and symbolic unknown fields during identity completion', () => {
  for (const placement of ['root', 'connection'] as const) {
    for (const key of ['apiKey', Symbol('private-factory-data')]) {
      const value = shorthand();
      Object.defineProperty(placement === 'root' ? value : value.connections.main, key, { value: 'synthetic-hidden-key', enumerable: false });
      expect(() => normalizeHostModelCatalog(value, host)).toThrow('invalid-config');
    }
  }
});
