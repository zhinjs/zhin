/** #1250 b111: a refused OneBot12 identity lookup says why, masked before it is cut. */
import { describe, expect, it } from 'vitest';
import { onebot12FailureReason } from '../src/identity.js';

describe('OneBot12 identity failure reason', () => {
  it('masks the access token before it cuts, so a token across the boundary is not half kept', () => {
    const token = 'boundary-token-0123456789';
    const reason = onebot12FailureReason({ retcode: 1403, message: `${'x'.repeat(290)} ${token}` }, token);
    expect(reason).not.toMatch(/boundary|0123456789/u);
    expect(reason).toMatch(/\*\*\* \(retcode 1403\)$/u);
  });
  it('masks secret-shaped text the implementation echoes', () => {
    expect(onebot12FailureReason({ retcode: 1, message: 'bad access_token=abcdefgh1234' }, undefined)).toBe('bad access_token=[redacted] (retcode 1)');
    expect(onebot12FailureReason({ retcode: 2, wording: '' }, 'tok-1')).toBe('unknown (retcode 2)');
  });
});
