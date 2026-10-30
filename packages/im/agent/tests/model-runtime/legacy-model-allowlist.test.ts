import { AIService } from '../../src/service.js';
import { createSdkProviderAdapter } from '@zhin.js/ai';

const hostOwnerId = 'host:/legacy-model-allowlist';

it.each(['binding', 'perception', 'perception-fallback'] as const)('preserves the configured model allowlist across preparation for %s', async target => {
  const service = new AIService({
    providers: { main: { sdk: 'ollama', baseUrl: 'https://models.test', models: ['allowed'] } },
    agents: { zhin: { provider: 'main', model: target === 'binding' ? 'blocked' : 'allowed' } },
    ...(target === 'binding' ? {} : { multimodal: { perception: { provider: 'main', model: target === 'perception' ? 'blocked' : 'allowed',
      ...(target === 'perception-fallback' ? { fallbacks: [{ provider: 'main', model: 'blocked' }] } : {}) } } }),
  });
  try {
    expect(() => service.getLlmRuntime().model('main', 'blocked')).toThrow('not registered');
    await expect(service.prepareModelRuntime({ hostOwnerId })).rejects.toMatchObject({ code: 'invalid-config' });
    expect(() => service.getLlmRuntime().model('main', 'blocked')).toThrow('not registered');
  } finally { await service.dispose(); }
});

it.each([undefined, []])('preserves explicit binding selection when the provider has no nonempty model allowlist (%j)', async models => {
  const service = new AIService({ providers: { main: { sdk: 'ollama', baseUrl: 'https://models.test', ...(models ? { models } : {}) } },
    agents: { zhin: { provider: 'main', model: 'explicit-model' } } });
  try {
    expect(service.getLlmRuntime().model('main', 'explicit-model').id).toBe('explicit-model');
    await service.prepareModelRuntime({ hostOwnerId });
    expect(service.getLlmRuntime().model('main', 'explicit-model').id).toBe('explicit-model');
  } finally { await service.dispose(); }
});

it('uses the admitted SDK configuration allowlist rather than stale source configuration', async () => {
  const service = new AIService({ providers: { main: { sdk: 'ollama', baseUrl: 'https://models.test', models: ['stale-model'] } },
    agents: { zhin: { provider: 'main', model: 'current-model' } } });
  const incoming = createSdkProviderAdapter('main', { sdk: 'ollama', baseUrl: 'https://models.test', models: ['current-model'] })!;
  await service.registerProvider(incoming);
  try {
    expect(service.getLlmRuntime().model('main', 'current-model').id).toBe('current-model');
    expect(() => service.getLlmRuntime().model('main', 'stale-model')).toThrow('not registered');
    await service.prepareModelRuntime({ hostOwnerId });
    expect(service.getLlmRuntime().model('main', 'current-model').id).toBe('current-model');
    expect(() => service.getLlmRuntime().model('main', 'stale-model')).toThrow('not registered');
  } finally { await service.dispose(); }
});

it('matches the SDK normalization of explicit model ids without discovering extra models', async () => {
  const service = new AIService({ providers: { main: { sdk: 'ollama', baseUrl: 'https://models.test', models: [' allowed ', ''] } },
    agents: { zhin: { provider: 'main', model: 'allowed' } } });
  try {
    expect(service.getLlmRuntime().model('main', 'allowed').id).toBe('allowed');
    await service.prepareModelRuntime({ hostOwnerId });
    expect(service.getLlmRuntime().model('main', 'allowed').id).toBe('allowed');
    expect(() => service.getLlmRuntime().model('main', 'blocked')).toThrow('not registered');
  } finally { await service.dispose(); }
});
