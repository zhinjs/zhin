import { describe, expect, it } from 'vitest';
import { AGENT_RUN_EVENT_VERSION, AgentRunJournal, AgentStreamEventType } from '@zhin.js/ai/agent-stream';
import { mapTurnEventToAgentStreamEvents } from '../../src/event/turn-to-agent-stream.js';

describe('mapTurnEventToAgentStreamEvents', () => {
  const ctx = { sessionId: 'ses_test', turnId: 'turn_1' };

  it('maps turn_start to turn.started', () => {
    const events = mapTurnEventToAgentStreamEvents(
      { type: 'turn_start', sessionId: 'x', turnId: 'y' },
      ctx,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(AgentStreamEventType.TURN_STARTED);
  });

  it('maps chunk to message.appended with delta and cumulative', () => {
    const events = mapTurnEventToAgentStreamEvents(
      { type: 'chunk', text: 'Hi', accumulated: 'Hi there' },
      ctx,
    );
    expect(events[0]?.type).toBe(AgentStreamEventType.MESSAGE_APPENDED);
    expect(events[0]?.data?.messageDelta).toBe('Hi');
    expect(events[0]?.data?.message).toBe('Hi there');
  });

  it('maps tool_call and tool_result', () => {
    const causedBy = { subjectId: 'bob-id', displayName: 'Bob', roles: ['user'] };
    const call = mapTurnEventToAgentStreamEvents(
      { type: 'tool_call', toolName: 'bash', args: { command: 'ls' }, toolUseId: 'c1', causedBy },
      ctx,
    );
    expect(call[0]?.type).toBe(AgentStreamEventType.ACTIONS_REQUESTED);
    expect(call[0]?.data?.causedBy).toEqual(causedBy);

    const result = mapTurnEventToAgentStreamEvents(
      { type: 'tool_result', toolName: 'bash', output: 'a.txt', durationMs: 12, toolUseId: 'c1', causedBy },
      ctx,
    );
    expect(result[0]?.type).toBe(AgentStreamEventType.ACTION_RESULT);
    expect(result[0]?.data?.causedBy).toEqual(causedBy);
  });

  it('maps turn_end to message.completed and turn.completed', () => {
    const journal = new AgentRunJournal(ctx);
    const events = mapTurnEventToAgentStreamEvents(
      {
        type: 'turn_end',
        output: [{ type: 'text', content: 'done' }],
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      },
      { ...ctx, journal },
    );
    expect(events.map((e) => e.type)).toEqual([
      AgentStreamEventType.MESSAGE_COMPLETED,
      AgentStreamEventType.TURN_COMPLETED,
    ]);
    expect(events[0]?.data?.message).toBe('done');
    expect(events[1]).toMatchObject({
      version: AGENT_RUN_EVENT_VERSION,
      run: ctx,
      sequence: 2,
      terminal: 'completed',
    });
  });

  it('maps turn_cancelled to a versioned cancelled terminal', () => {
    const journal = new AgentRunJournal(ctx);
    const events = mapTurnEventToAgentStreamEvents(
      { type: 'turn_cancelled', code: 'timeout', reason: 'deadline elapsed' },
      { ...ctx, journal },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      version: AGENT_RUN_EVENT_VERSION,
      type: AgentStreamEventType.TURN_CANCELLED,
      run: ctx,
      sequence: 1,
      terminal: 'cancelled',
      data: { code: 'timeout', reason: 'deadline elapsed' },
    });
  });
});
