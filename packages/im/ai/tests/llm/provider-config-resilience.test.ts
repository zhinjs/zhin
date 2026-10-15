/**
 * Provider config `timeout` / `maxRetries` (S15) and stall timeouts (S21).
 */
import { describe, expect, it } from 'vitest';
import {
  createLlmTransportModel,
  resolveModelStreamTimeout,
  resolveProviderConfigResilience,
} from '../../src/llm/llm-api-runtime.js';
import { resolveProviderResilienceConfig } from '../../src/llm/provider-resilience.js';
import { createLlmApiRuntime } from '../../src/llm/llm-runtime-factory.js';

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

  it('exposes the registered provider config to the agent', () => {
    const runtime = createLlmApiRuntime([{ alias: 'gw', config: { sdk: 'openai', apiKey: 'k', timeout: 30_000 }, models: ['m'] }], () => ['m']);
    expect(runtime.providerConfig('gw')).toMatchObject({ timeout: 30_000 });
    expect(runtime.providerConfig('missing')).toBeUndefined();
  });
});

describe('stream stall timeouts', () => {
  it('copies positive firstChunkTimeoutMs / chunkTimeoutMs onto the model', () => {
    expect(resolveModelStreamTimeout({ sdk: 'openai', firstChunkTimeoutMs: 20_000, chunkTimeoutMs: 60_000 }))
      .toEqual({ firstChunkMs: 20_000, chunkMs: 60_000 });
    expect(resolveModelStreamTimeout({ sdk: 'openai', chunkTimeoutMs: 0 })).toBeUndefined();
    expect(createLlmTransportModel('a', { sdk: 'openai', firstChunkTimeoutMs: 5_000 }, 'm').streamTimeout).toEqual({ firstChunkMs: 5_000 });
  });
});
