import { describe, expect, it } from 'vitest';
import {
  parseTraceTime,
  traceCommand,
} from '../src/commands/trace.js';

describe('zhin trace filters (#728) & Engagement Collaboration Graph (ADR 0048 H5)', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  it('parses relative, ISO and epoch times', () => {
    expect(parseTraceTime(undefined)).toBeUndefined();
    expect(parseTraceTime('2h', now)).toBe(now - 2 * 3_600_000);
    expect(parseTraceTime('7d', now)).toBe(now - 7 * 86_400_000);
    expect(parseTraceTime('30m', now)).toBe(now - 30 * 60_000);
    expect(parseTraceTime('2026-10-14T08:00:00Z')).toBe(Date.parse('2026-10-14T08:00:00Z'));
    expect(parseTraceTime('1760400000000')).toBe(1760400000000);
    expect(() => parseTraceTime('yesterday-ish')).toThrow(/无法解析时间/);
  });

  it('exposes session, time, and engagements flags', () => {
    const flags = traceCommand.options.map((option) => option.long);
    expect(flags).toEqual(
      expect.arrayContaining(['--session', '--since', '--until', '--sessions', '--engagements', '--dir', '--limit']),
    );
  });

});

describe('zhin trace --sessions rows (#1250 b63)', () => {
  const base = { turns: 2, last_started_at: Date.parse('2026-11-19T08:00:00Z'), last_status: 'completed', total_tokens: 12 };
  it('prints the readable chat with the short key, the chats of a multi-chat session, and degrades without an origin', async () => {
    const { formatTraceSessionRow } = await import('../src/commands/trace.js');
    const labelled = formatTraceSessionRow({ ...base, session_key: 'personal-session:v1:0123456789abcdef0123',
      platform: 'sandbox', scope_kind: 'private', scene_label: 'Developer', display_name: 'sandbox · 私聊 Developer' });
    expect(labelled[0]).toMatch(/^sandbox · 私聊 Developer（personal-session:01234567） {2}2 回合/);
    // An older Agent returns `origin` without the name fields.
    const fromOrigin = formatTraceSessionRow({ ...base, session_key: 'scene-task:v1:0123456789abcdef0123',
      origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'group', sceneId: '42' },
      conversations: [
        { display_name: 'qq · 群 42', turns: 1, last_started_at: base.last_started_at },
        { origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'group', sceneId: '43' }, turns: 1, last_started_at: base.last_started_at - 1 },
      ],
      conversations_total: 12 });
    expect(fromOrigin[0]).toMatch(/^qq · 群 42（scene-task:01234567）/);
    expect(fromOrigin.slice(1).map(line => line.replace(/ {2}\d+ 回合.*$/u, ''))).toEqual(['  · qq · 群 42', '  · qq · 群 43', '  · 另有 10 段聊天']);
    const legacy = formatTraceSessionRow({ ...base, session_key: 'schedule:sched_1' });
    expect(legacy[0]).toMatch(/^schedule:sched_1 {2}2 回合/);
  });

  it('escapes control and bidi characters before printing (#1250 b63 A-1)', async () => {
    const { escapeTerminalText, formatTraceSessionRow } = await import('../src/commands/trace.js');
    expect(escapeTerminalText('a\u001b[2Jb\nc\u2028d\u202Ee\u2066f')).toBe('a\\u001b[2Jb\\u000ac\\u2028d\\u202ee\\u2066f');
    // An older Agent's raw display_name, and a raw origin name: neither reaches the terminal as-is.
    const raw = formatTraceSessionRow({ ...base, session_key: 'k\u001b', display_name: 'qq · 群 \u001b]0;pwned\u0007',
      conversations: [{ origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'group', sceneId: '1', conversation: { endpoint: { adapter: 'qq', id: 'bot' }, kind: 'group', id: '1', name: '坏\n群' } }, turns: 1, last_started_at: base.last_started_at }] });
    for (const line of raw) expect(line).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u);
    expect(raw[0]).toContain('qq · 群 \\u001b]0;pwned\\u0007（k\\u001b）');
    expect(raw[1]).toContain('· qq · 群 坏\\u000a群');
  });
});
