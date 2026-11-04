import { createModelCatalog, normalizeModelCatalogConfig, type ModelCatalogConfig } from '../../src/model-catalog/index.js';

function fixture(): ModelCatalogConfig {
  return {
    connections: { main: { id: 'main', ownerId: 'host', revision: 1, sdk: 'openai-compatible', baseUrl: 'https://example.test/v1', secretRef: 'secret/main' } },
    models: { chat: { id: 'chat', connectionId: 'main', model: 'chat-v1', capabilities: { input: ['text', 'image'], toolCalling: true }, contextWindow: 16000 } },
    presets: { default: { id: 'default', modelId: 'chat' } },
  };
}
const owner = { ownerId: 'alice', hostOwnerId: 'host' };

describe('model catalog', () => {
  it('resolves detached, deeply frozen, secret-free invocation snapshots', () => {
    const input = fixture();
    const catalog = createModelCatalog(input);
    expect(Reflect.set(catalog, 'config', {})).toBe(false);
    const invocation = catalog.resolve('default', owner, { input: ['image'], toolCalling: true });
    expect(invocation.model.model).toBe('chat-v1');
    for (const value of [invocation, invocation.connection, invocation.model, invocation.model.capabilities, invocation.model.capabilities.input, invocation.preset, catalog.config, catalog.config.connections]) expect(Object.isFrozen(value)).toBe(true);
    expect(invocation.connection).not.toBe(input.connections.main);
    Reflect.set(input.connections.main, 'baseUrl', 'https://changed.test');
    expect(invocation.connection.baseUrl).toBe('https://example.test/v1');
    expect(JSON.stringify(invocation)).not.toContain('apiKey');
    expect(invocation.model.maxOutputTokens).toBeUndefined();
  });

  it('permits the current owner and host owner, rejects other private owners before returning metadata', () => {
    const input = fixture();
    const personal = { ...input, connections: { main: { ...input.connections.main, ownerId: 'alice' } } };
    const catalog = createModelCatalog(personal);
    expect(catalog.resolve('default', owner).connection.ownerId).toBe('alice');
    expect(() => catalog.resolve('default', { ownerId: 'bob', hostOwnerId: 'host' })).toThrow('connection-forbidden');
  });

  it('checks unknown capability only when explicitly required', () => {
    const catalog = createModelCatalog(fixture());
    expect(() => catalog.resolve('default', owner)).not.toThrow();
    expect(() => catalog.resolve('default', owner, { streaming: false })).not.toThrow();
    expect(() => catalog.resolve('default', owner, { streaming: true })).toThrow('unsupported-capability');
    expect(() => catalog.resolve('default', owner, { input: ['audio'] })).toThrow('unsupported-capability');
    expect(() => catalog.resolve('missing', owner)).toThrow('unknown-preset');
  });

  it.each([
    { extra: true },
    { connections: { main: { ...fixture().connections.main, id: 'wrong' } } },
    { connections: { main: { ...fixture().connections.main, revision: 0 } } },
    { connections: { main: { ...fixture().connections.main, apiKey: 'secret-value' } } },
    { connections: { main: { ...fixture().connections.main, headers: { Authorization: 'secret-value' } } } },
    { connections: { main: { ...fixture().connections.main, sdk: 'made-up' } } },
    { connections: { main: { ...fixture().connections.main, baseUrl: 'https://user:secret-value@example.test' } } },
    { models: { chat: { ...fixture().models.chat, connectionId: 'missing' } } },
    { models: { chat: { ...fixture().models.chat, contextWindow: -1 } } },
    { models: { chat: { ...fixture().models.chat, capabilities: { permission: 'admin' } } } },
    { presets: { default: { ...fixture().presets.default, modelId: 'missing' } } },
    { presets: { default: { ...fixture().presets.default, maxTokens: 4000 } } },
  ])('rejects invalid closed schemas and references without echoing secrets (%#)', patch => {
    const run = () => normalizeModelCatalogConfig({ ...fixture(), ...patch });
    expect(run).toThrow('invalid-config');
    try { run(); } catch (error) { expect(String(error)).not.toContain('secret-value'); }
  });

  it('rejects authority and arbitrary generation parameters at lower levels', () => {
    const catalog = createModelCatalog(fixture());
    expect(() => catalog.resolve('default', owner, { maxTokens: 1000 } as never)).toThrow('invalid-config');
    expect(() => catalog.resolve('default', { ...owner, permission: 'admin' } as never)).toThrow('invalid-config');
  });
});
