import schema from '../src/host-config-schema.json' with { type: 'json' };
import { parsePluginConfigSchema } from '../src/config-composer.js';

function input() {
  return { ai: {
    modelCatalog: {
      connections: { main: { id: 'main', ownerId: 'host', revision: 1, sdk: 'openai-compatible', baseUrl: 'https://provider.test/v1', secretRef: 'env://AI_KEY' } },
      models: { chat: { id: 'chat', connectionId: 'main', model: 'selected', capabilities: { input: ['text'], toolCalling: true } } },
      presets: { chat: { id: 'chat', modelId: 'chat' } },
    },
    modelPolicy: { defaults: { chat: 'chat', summary: 'chat' }, adapters: { sandbox: { chat: 'chat', perception: 'chat' } } },
    agents: { zhin: { preset: 'chat', mcpServers: ['readonly'] } },
    personalPrincipals: { operator: [{ rootId: '/project', platform: 'sandbox', endpoint: 'bot', adapterId: 'adapter', subjectId: 'alice' }] },
  } };
}

describe('canonical model configuration schema', () => {
  it('validates the complete reference form without inserting product defaults', () => {
    const value = input();
    const parsed = parsePluginConfigSchema(schema, value);
    expect(parsed.errors).toEqual([]);
    expect(parsed.value).toEqual(value);
  });

  it('accepts keyed Host shorthand while leaving identity completion to the Host compiler', () => {
    const value = input();
    const { id: connectionId, ownerId, ...connection } = value.ai.modelCatalog.connections.main;
    const { id: modelId, ...model } = value.ai.modelCatalog.models.chat;
    const { id: presetId, ...preset } = value.ai.modelCatalog.presets.chat;
    const shorthand = { ...value, ai: { ...value.ai, modelCatalog: {
      connections: { main: connection }, models: { chat: model }, presets: { chat: preset },
    } } };
    expect([connectionId, modelId, presetId, ownerId]).toEqual(['main', 'chat', 'chat', 'host']);
    const parsed = parsePluginConfigSchema(schema, shorthand);
    expect(parsed.errors).toEqual([]);
    expect(parsed.value).toEqual(shorthand);
  });

  it.each(['apiKey', 'headers', 'permission', 'maxRetries'])('rejects %s inside a connection or preset instead of preserving arbitrary overrides', field => {
    const value = input();
    Object.assign(value.ai.modelCatalog.connections.main, { [field]: 'forbidden' });
    expect(parsePluginConfigSchema(schema, value).errors.length).toBeGreaterThan(0);
    const preset = input();
    Object.assign(preset.ai.modelCatalog.presets.chat, { [field]: 'forbidden' });
    expect(parsePluginConfigSchema(schema, preset).errors.length).toBeGreaterThan(0);
  });

  it('enforces the scope whitelist and exact principal-owner mapping shape', () => {
    const value = input();
    Object.assign(value.ai.modelPolicy.adapters.sandbox, { summary: 'chat' });
    expect(parsePluginConfigSchema(schema, value).errors.length).toBeGreaterThan(0);
    const principal = input();
    Object.assign(principal.ai.personalPrincipals.operator[0], { wildcard: '*' });
    expect(parsePluginConfigSchema(schema, principal).errors.length).toBeGreaterThan(0);
  });
});
