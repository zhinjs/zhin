import { describe, expect, it } from 'vitest';
import {
  SUBAGENT_AUTO_CONTINUE_MARKER,
  buildSubagentAutoContinueUserMessage,
} from '../../src/zhin-agent/subagent-auto-continue.js';

describe('subagent-auto-continue', () => {
  it('builds wake-up user message for main agent', () => {
    const msg = buildSubagentAutoContinueUserMessage('t1', 'research', 'ok');
    const text = msg.content.find((b) => b.type === 'text')?.text ?? '';
    expect(text).toContain(SUBAGENT_AUTO_CONTINUE_MARKER);
    expect(text).toContain('t1');
    expect(text).toContain('research');
  });
});
