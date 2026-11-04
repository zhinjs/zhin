import hostSchema from '../src/host-config-schema.json' with { type: 'json' };
import planSchema from '../../ai/provider-plan.schema.json' with { type: 'json' };
import { parsePluginConfigSchema } from '../src/config-composer.js';
import { reviewAIPlan } from '../../../../tests/helpers/review-ai-plan.js';
import { validateModelRuntimeConfig } from '../../agent/src/model-runtime/validation.js';

function input() {
  return { version: 1, services: { main: { driver: 'openai-compatible', options: { baseUrl: 'https://provider.test/v1' }, models: {
    chat: { id: 'chat', kinds: ['language'], protocol: 'openai-chat', input: ['text'], toolCalling: true },
  } } }, accounts: { main: { service: 'main', auth: { method: 'api-key', source: 'env://AI_KEY' } } },
  profiles: { chat: { account: 'main', model: 'chat' } },
  purposes: { chat: { profile: 'chat' }, summary: { profile: 'chat' }, adapters: { sandbox: { chat: { profile: 'chat' } } } } };
}

describe('canonical model configuration schema', () => {
  it('validates a complete independent proposal without inserting defaults or mutating it', async () => {
    const value = input(), before = structuredClone(value);
    expect(parsePluginConfigSchema(planSchema, value)).toEqual({ value, errors: [] });
    const reviewed = await reviewAIPlan(value);
    expect(reviewed.graph.profiles[reviewed.bindings.profiles.chat].model).toBe('chat');
    expect(value).toEqual(before);
  });

  it('completes keyed aliases only during explicit Host review and rejects authored identity overrides', async () => {
    const value = input();
    const reviewed = await reviewAIPlan(value);
    const service = reviewed.graph.services[reviewed.bindings.services.main];
    expect(service.id).not.toBe('main');
    expect(service.ownerId).toBe('host:example');
    for (const field of ['id', 'ownerId']) {
      const invalid = input(); Object.assign(invalid.services.main, { [field]: 'claimed-identity' });
      expect(parsePluginConfigSchema(planSchema, invalid).errors.length).toBeGreaterThan(0);
      await expect(reviewAIPlan(invalid)).rejects.toThrow('invalid-plan');
    }
  });

  it.each(['apiKey', 'headers', 'permission', 'maxRetries'])('rejects %s as an arbitrary Service or Profile override', async field => {
    const service = input(); Object.assign(service.services.main, { [field]: 'forbidden' });
    expect(parsePluginConfigSchema(planSchema, service).errors.length).toBeGreaterThan(0);
    await expect(reviewAIPlan(service)).rejects.toThrow('invalid-plan');
    const profile = input(); Object.assign(profile.profiles.chat, { [field]: 'forbidden' });
    expect(parsePluginConfigSchema(planSchema, profile).errors.length).toBeGreaterThan(0);
    await expect(reviewAIPlan(profile)).rejects.toThrow('invalid-plan');
  });

  it('keeps approved generation controls under Profile parameters rather than rejecting all overrides', async () => {
    const value = input(); Object.assign(value.profiles.chat, { parameters: { maxRetries: 0, temperature: 0.4 } });
    expect(parsePluginConfigSchema(planSchema, value).errors).toEqual([]);
    const reviewed = await reviewAIPlan(value);
    expect(reviewed.graph.profiles[reviewed.bindings.profiles.chat].parameters).toEqual({ maxRetries: 0, temperature: 0.4 });
  });

  it('enforces the purpose scope whitelist and exact administrator-bound principal shape', async () => {
    const value = input(); Object.assign(value.purposes.adapters.sandbox, { summary: { profile: 'chat' } });
    expect(parsePluginConfigSchema(planSchema, value).errors.length).toBeGreaterThan(0);
    await expect(reviewAIPlan(value)).rejects.toThrow();
    const principal = { ai: { personalPrincipals: { operator: [{ rootId: '/project', platform: 'sandbox', endpoint: 'bot', adapterId: 'adapter', subjectId: 'alice' }] } } };
    expect(parsePluginConfigSchema(hostSchema, principal)).toEqual({ value: principal, errors: [] });
    Object.assign(principal.ai.personalPrincipals.operator[0], { wildcard: '*' });
    expect(parsePluginConfigSchema(hostSchema, principal).errors.length).toBeGreaterThan(0);
  });

  it.each(['providers', 'modelCatalog', 'modelPolicy', 'decisions', 'plan'])('rejects retired startup %s at the actual Agent validation boundary', key => {
    expect(validateModelRuntimeConfig({ [key]: {} }, 'host:test')).toEqual([expect.stringContaining('migration required')]);
    expect(hostSchema.properties.ai.properties).not.toHaveProperty(key);
  });
});
