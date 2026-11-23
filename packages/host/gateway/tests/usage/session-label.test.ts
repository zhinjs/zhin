import { describe, expect, it } from 'vitest';
import { dayKeyOf, sanitizeSessionText, sessionDisplayNameOf, sessionLabelOf, sessionPartsOf, shortSessionKey } from '../../src/usage/aggregate.js';

describe('readable session names for zhin trace -l (#1250 trace-list-raw-session-keys)', () => {
  const key = `personal-session:v1:${'ab12cd34'.repeat(8)}`;
  it('uses the conversation zhin usage report shows, with the short key', () => {
    const trace = { session_key: key, origin: { kind: 'im', platform: 'sandbox', scope: 'private', sceneId: 'dev-user' }, principal: { display_name: 'Developer' } };
    expect(sessionLabelOf(trace)).toBe('sandbox · 私聊 Developer（personal-session:ab12cd34）');
    expect(sessionLabelOf({ session_key: key })).toBe('personal-session:ab12cd34');
    expect(sessionLabelOf({ session_key: 'qq:bot:group:123' })).toBe('qq:bot:group:123');
    expect(shortSessionKey('plain')).toBe('plain');
  });

  it('cleans platform-given names: control / bidi characters escaped, cut to 128 code points (#1250 b63 A-1)', () => {
    expect(sanitizeSessionText('坏\u001b[2J群\n名\u2028\u202E!')).toBe('坏\\u001b[2J群\\u000a名\\u2028\\u202e!');
    expect(sanitizeSessionText('😀'.repeat(200))).toBe('😀'.repeat(128));
    expect(sanitizeSessionText(' ')).toBeUndefined();
    const trace = { origin: { kind: 'im', platform: 'qq', scope: 'group', sceneId: 'g', conversation: { kind: 'group', id: 'g', name: '\u001b[31m红群' } } };
    expect(sessionDisplayNameOf(trace)).toBe('qq · 群 \\u001b[31m红群');
    const dm = { origin: { kind: 'im', platform: 'qq', scope: 'private', sceneId: 'u' }, principal: { display_name: 'Ali\u2066ce' } };
    expect(sessionPartsOf(dm)).toEqual({ scopeKind: 'private', sceneLabel: 'Ali\\u2066ce' });
    expect(sessionLabelOf({ ...dm, session_key: 'dm' })).toBe('qq · 私聊 Ali\\u2066ce（dm）');
  });

  it('falls back on blank scope / sceneId and a missing platform, like the Agent (#1250 b63 A-5)', () => {
    const origin = { kind: 'im', platform: ' ', scope: '  ', sceneId: '', conversation: { endpoint: { adapter: 'sandbox', id: 'bot' }, kind: 'channel', id: 'c1' } };
    expect(sessionPartsOf({ origin })).toEqual({ scopeKind: 'channel', sceneLabel: 'c1' });
    expect(sessionDisplayNameOf({ origin })).toBe('sandbox · 频道 c1');
  });

  it('day keys stay YYYY-MM-DD in the requested zone', () => {
    expect(dayKeyOf(Date.UTC(2026, 10, 14, 16, 30), 'Asia/Shanghai')).toBe('2026-11-15');
    expect(dayKeyOf(Date.UTC(2026, 10, 14, 16, 30), 'UTC')).toBe('2026-11-14');
  });
});
