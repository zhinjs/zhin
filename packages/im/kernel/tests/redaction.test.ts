import { describe, expect, it } from 'vitest';
import { isSecretLikeKey, redactDecisionPayload, redactSecretText } from '../src/index.js';

describe('redaction (moved from @zhin.js/agent, ADR 0061 P1)', () => {
  it('masks secret keys, omits prompts and hides token-shaped text', () => {
    expect(redactDecisionPayload({ apiKey: 'x', prompt: 'full prompt', note: 'Bearer abcdefghijklmnop' })).toEqual({
      apiKey: '[redacted]', prompt: '[omitted]', note: 'Bearer [redacted]',
    });
    expect(redactDecisionPayload(null)).toEqual({});
    expect(redactSecretText('token=sk-abcdefghijkl')).not.toContain('sk-abcdefghijkl');
    expect(isSecretLikeKey('openaiApiKey')).toBe(true);
    expect(isSecretLikeKey('name')).toBe(false);
  });
});
