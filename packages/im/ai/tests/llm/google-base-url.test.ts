import { describe, it, expect } from 'vitest';
import { normalizeGoogleBaseUrl } from '../../src/llm/sdk-registry.js';

describe('normalizeGoogleBaseUrl', () => {
  it('returns undefined for empty', () => {
    expect(normalizeGoogleBaseUrl(undefined)).toBeUndefined();
    expect(normalizeGoogleBaseUrl('  ')).toBeUndefined();
  });

  it('keeps url already ending with /v1beta', () => {
    expect(normalizeGoogleBaseUrl('https://proxy.example/v1beta')).toBe('https://proxy.example/v1beta');
    expect(normalizeGoogleBaseUrl('https://proxy.example/v1beta/')).toBe('https://proxy.example/v1beta');
  });

  it('appends /v1beta to proxy root', () => {
    expect(normalizeGoogleBaseUrl('https://gemini-proxy.zhin.workers.dev')).toBe(
      'https://gemini-proxy.zhin.workers.dev/v1beta',
    );
  });
});
