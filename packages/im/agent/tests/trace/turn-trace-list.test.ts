import { describe, expect, it } from 'vitest';
import { formatDateTime } from '@zhin.js/plugin-runtime';
import { TurnTraceCollector, formatTurnTrace, formatTurnTraceList } from '../../src/trace/index.js';

describe('zhin trace -l (#1250 trace-list-raw-session-keys, cli-datetime-us-locale)', () => {
  const trace = () => new TurnTraceCollector({ turnId: 'turn-1', sessionKey: `personal-session:v1:${'a'.repeat(64)}` }).snapshot();

  it('shows the label the caller resolves, else the session key', () => {
    const one = trace();
    expect(formatTurnTraceList([one], { sessionLabel: () => 'sandbox · 私聊 Developer（personal-session:aaaaaaaa）' }))
      .toContain('turn-1  sandbox · 私聊 Developer（personal-session:aaaaaaaa）');
    expect(formatTurnTraceList([one], { sessionLabel: () => undefined })).toContain(one.session_key);
    expect(formatTurnTraceList([one])).toContain(one.session_key);
  });

  it('prints YYYY-MM-DD HH:mm:ss, 24-hour', () => {
    const one = trace();
    expect(formatTurnTraceList([one]).startsWith(formatDateTime(one.started_at))).toBe(true);
    expect(formatTurnTrace(one)).toContain(`开始: ${formatDateTime(one.started_at)}`);
    expect(formatTurnTraceList([one])).not.toMatch(/\b[AP]M\b/u);
  });
});
