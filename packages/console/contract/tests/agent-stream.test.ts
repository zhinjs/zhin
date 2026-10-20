import { describe, expect, it } from 'vitest';
import {
  AgentStreamEventType,
  createAgentStreamReduceState,
  formatAgentStreamNdjsonLine,
  reduceAgentStreamEvent,
} from '../src/agent-stream.js';

describe('agent-stream contract', () => {
  it('formatAgentStreamNdjsonLine produces valid JSON line', () => {
    const line = formatAgentStreamNdjsonLine({
      type: AgentStreamEventType.SESSION_STARTED,
      data: { sessionId: 'ses_1' },
    });
    expect(line.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(line.trim());
    expect(parsed.type).toBe('session.started');
    expect(typeof parsed.timestamp).toBe('number');
  });

  it('reduceAgentStreamEvent accumulates assistant text', () => {
    let state = createAgentStreamReduceState();
    state = reduceAgentStreamEvent(state, {
      type: AgentStreamEventType.MESSAGE_APPENDED,
      data: { messageDelta: 'Hel', message: 'Hel' },
    });
    state = reduceAgentStreamEvent(state, {
      type: AgentStreamEventType.MESSAGE_APPENDED,
      data: { messageDelta: 'lo', message: 'Hello' },
    });
    expect(state.assistantText).toBe('Hello');
    state = reduceAgentStreamEvent(state, {
      type: AgentStreamEventType.SESSION_WAITING,
      data: {},
    });
    expect(state.waiting).toBe(true);
  });
});
