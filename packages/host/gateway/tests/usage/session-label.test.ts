import { describe, expect, it } from 'vitest';
import { dayKeyOf, sessionLabelOf, shortSessionKey } from '../../src/usage/aggregate.js';

describe('readable session names for zhin trace -l (#1250 trace-list-raw-session-keys)', () => {
  const key = `personal-session:v1:${'ab12cd34'.repeat(8)}`;
  it('uses the conversation zhin usage report shows, with the short key', () => {
    const trace = { session_key: key, origin: { kind: 'im', platform: 'sandbox', scope: 'private', sceneId: 'dev-user' }, principal: { display_name: 'Developer' } };
    expect(sessionLabelOf(trace)).toBe('sandbox · 私聊 Developer（personal-session:ab12cd34）');
    expect(sessionLabelOf({ session_key: key })).toBe('personal-session:ab12cd34');
    expect(sessionLabelOf({ session_key: 'qq:bot:group:123' })).toBe('qq:bot:group:123');
    expect(shortSessionKey('plain')).toBe('plain');
  });

  it('day keys stay YYYY-MM-DD in the requested zone', () => {
    expect(dayKeyOf(Date.UTC(2026, 10, 14, 16, 30), 'Asia/Shanghai')).toBe('2026-11-15');
    expect(dayKeyOf(Date.UTC(2026, 10, 14, 16, 30), 'UTC')).toBe('2026-11-14');
  });
});
