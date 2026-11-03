import { openAiProvider } from '../../src/providers/api-key.js';
import { profileModel } from '../helpers/profile-runtime.js';
/**
 * Provider config `timeout` / `maxRetries` (S15) and stall timeouts (S21).
 */
import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveOutputTokens,
  resolveModelStreamTimeout,
  resolveProviderConfigResilience,
} from '../../src/llm/llm-api-runtime.js';
import { resolveProviderResilienceConfig } from '../../src/llm/provider-resilience.js';


describe('provider config resilience layer', () => {
  it('maps timeout to requestTimeoutMs and keeps maxRetries', () => {
    expect(resolveProviderConfigResilience({ timeout: 45_000, maxRetries: 0 })).toEqual({ requestTimeoutMs: 45_000, maxRetries: 0 });
    expect(resolveProviderConfigResilience({ timeout: 0 })).toEqual({ requestTimeoutMs: 0 });
    expect(resolveProviderConfigResilience({})).toBeUndefined();
    expect(resolveProviderConfigResilience(undefined)).toBeUndefined();
    expect(resolveProviderConfigResilience({ timeout: -1, maxRetries: Number.NaN })).toBeUndefined();
  });

  it('sits between ai.providerResilience and the model harness', () => {
    const resolved = resolveProviderResilienceConfig(
      { requestTimeoutMs: 180_000, maxRetries: 2 },
      resolveProviderConfigResilience({ timeout: 60_000, maxRetries: 4 }),
      { requestTimeoutMs: 90_000, emptyReplyRetries: undefined },
    );
    expect(resolved).toMatchObject({ requestTimeoutMs: 90_000, maxRetries: 4 });
  });

  it('keeps timeout and retry settings as explicit Profile parameters', () => {
    expect(openAiProvider.profileSchema({ service: { id: 's', rootId: 'r', ownerId: 'h', revision: 1, driver: { id: 'openai', owner: 'root', contractVersion: '1' }, options: openAiProvider.serviceSchema.parse({}), models: {} }, model: { id: 'm', kinds: ['language'], protocol: 'openai-chat' } }).parse({ requestTimeoutMs: 30000, maxRetries: 0 }))
      .toMatchObject({ requestTimeoutMs: 30000, maxRetries: 0 });
  });
});

describe('stream stall timeouts', () => {
  it('copies positive firstChunkTimeoutMs / chunkTimeoutMs onto the model', () => {
    expect(resolveModelStreamTimeout({ firstChunkTimeoutMs: 20_000, chunkTimeoutMs: 60_000 }))
      .toEqual({ firstChunkMs: 20_000, chunkMs: 60_000 });
    expect(resolveModelStreamTimeout({ chunkTimeoutMs: 0 })).toBeUndefined();
    expect(profileModel('a', { sdk: 'openai', firstChunkTimeoutMs: 5_000 }, 'm').streamTimeout).toEqual({ firstChunkMs: 5_000 });
  });
});

it('preserves the established generic output budget without writing a Profile default', () => {
  expect(resolveEffectiveOutputTokens({})).toBe(8192);
  expect(resolveEffectiveOutputTokens({ declared: 4096 })).toBe(4096);
  expect(resolveEffectiveOutputTokens({ declared: 4096, configured: 256 })).toBe(256);
});
