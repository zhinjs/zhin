import { describe, expect, it, vi } from 'vitest';
import { AgentRunJournal, AgentStreamEventType } from '@zhin.js/ai/agent-stream';
import { publishTurnStreamEvents } from '../../src/event/publish-agent-stream.js';

describe('publishTurnStreamEvents', () => {
  it('publishes journalled events in sequence and keeps the first terminal only', () => {
    const publish = vi.fn(async () => {});
    const host = { resourceHub: { agentStreamBus: { publish } } } as any;
    const context = { sessionId: 's1', turnId: 't1' };
    const journal = new AgentRunJournal(context);

    publishTurnStreamEvents(host, { type: 'turn_start', sessionId: 's1', turnId: 't1' }, context, journal);
    publishTurnStreamEvents(host, {
      type: 'turn_cancelled',
      code: 'superseded',
      reason: 'newer turn started',
    }, context, journal);
    publishTurnStreamEvents(host, {
      type: 'turn_end',
      output: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }, context, journal);

    const events = publish.mock.calls.map(([event]) => event);
    expect(events).toMatchObject([
      { type: AgentStreamEventType.TURN_STARTED, run: context, sequence: 1 },
      { type: AgentStreamEventType.TURN_CANCELLED, run: context, sequence: 2, terminal: 'cancelled' },
    ]);
    expect(journal.replay().map((event) => event.sequence)).toEqual([1, 2]);
  });
});
