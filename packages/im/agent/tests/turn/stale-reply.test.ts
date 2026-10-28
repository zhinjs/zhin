import { isActingTurnEvent } from '../../src/turn/stale-reply.js';
import { TOOL_HARD_GATE_POLICY } from '../../src/security/tool-hard-gate.js';
import type { TurnEvent } from '../../src/event/turn-event.js';

describe('isActingTurnEvent (ADR 0038 §4)', () => {
  it('counts tool calls, MCP calls and sub-agents', () => {
    expect(isActingTurnEvent({ type: 'tool_call', toolName: 'kick', args: {}, toolUseId: 't1' })).toBe(true);
    expect(isActingTurnEvent({ type: 'mcp_tool_call', serverName: 's', toolName: 'x' })).toBe(true);
    expect(isActingTurnEvent({ type: 'subagent_start' } as TurnEvent)).toBe(true);
  });

  it('counts a hard-gate denial but not other denials', () => {
    const denied = (policy: string): TurnEvent => ({ type: 'tool_denied', toolName: 'kick', toolUseId: 't1', policy, reason: 'r' });
    expect(isActingTurnEvent(denied(TOOL_HARD_GATE_POLICY))).toBe(true);
    expect(isActingTurnEvent(denied('approval'))).toBe(false);
  });

  it('ignores text and bookkeeping events', () => {
    expect(isActingTurnEvent({ type: 'chunk', text: 'hi', accumulated: 'hi' })).toBe(false);
    expect(isActingTurnEvent({ type: 'turn_start', sessionId: 's', turnId: 't' })).toBe(false);
  });
});
