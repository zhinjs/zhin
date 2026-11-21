import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginStatusLine } from '../src/login-text.js';

function endpoint(expiresAt: number) {
  return {
    localId: 'main',
    login: { state: 'ok', mid: 1, uname: 'u', source: 'qr', expiresAt },
    drafts: { size: 0 },
  } as never;
}

describe('bili-login expiry date (#1250)', () => {
  let previousTz: string | undefined;
  beforeEach(() => { previousTz = process.env.TZ; process.env.TZ = 'Asia/Shanghai'; });
  afterEach(() => { if (previousTz === undefined) delete process.env.TZ; else process.env.TZ = previousTz; });

  it('shows the local day, not the UTC day, of the expiry', () => {
    const at = Date.parse('2026-01-05T17:00:00Z');
    expect(loginStatusLine(endpoint(at), 'zh-CN')).toContain('，2026-01-06 过期');
    expect(loginStatusLine(endpoint(at), 'en')).toContain(', expires 2026-01-06');
  });
});
