/** #1250 b111: a refused Lark identity lookup says why, without credentials. */
import { describe, expect, it } from 'vitest';
import { larkFailureReason } from '../src/adapter.js';

describe('Lark identity verification failure reason', () => {
  it('carries code and msg and masks the account secrets', () => {
    expect(larkFailureReason({ code: 10014, msg: 'app secret invalid: app-secret-value' }, ['app-secret-value', undefined]))
      .toBe('app secret invalid: *** (code 10014)');
    expect(larkFailureReason({ code: 99991663 }, [])).toBe('unknown (code 99991663)');
  });
});

describe('Lark failure reason masking order (#1250 b111)', () => {
  it('masks before it cuts, so a secret across the boundary is not half kept', () => {
    const secret = 'boundary-secret-0123456789';
    const reason = larkFailureReason({ code: 1, msg: `${'x'.repeat(290)} ${secret}` }, [secret]);
    expect(reason).not.toMatch(/boundary|0123456789/u);
  });
});
