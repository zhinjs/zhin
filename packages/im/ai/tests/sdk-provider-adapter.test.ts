import { describe, it, expect } from 'vitest';
import { createSdkProviderAdapter } from '../src/sdk-provider-adapter.js';

describe('SdkProviderAdapter models', () => {
  it('anthropic adapter gets preset models without yaml', () => {
    const p = createSdkProviderAdapter('anyrouter', {
      sdk: 'anthropic',
      apiKey: 'test-key',
      baseUrl: 'https://anyrouter.top',
    });
    expect(p).not.toBeNull();
    expect(p!.models.length).toBeGreaterThan(0);
    expect(p!.models).toContain('claude-sonnet-4-6');
  });

  it('anthropic adapter uses custom yaml models', async () => {
    const p = createSdkProviderAdapter('anyrouter', {
      sdk: 'anthropic',
      apiKey: 'test-key',
      baseUrl: 'https://anyrouter.top',
      models: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    });
    expect(p!.models).toEqual([
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ]);
    await expect(p!.listModels()).resolves.toEqual(p!.models);
  });
});
