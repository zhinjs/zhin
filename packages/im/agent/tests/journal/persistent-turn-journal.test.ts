import { describe, expect, it, vi } from 'vitest';
import type { AgentRunEvent } from '@zhin.js/ai/agent-stream';
import type { JournalStore } from '@zhin.js/ai/journal-store';
import { PersistentTurnJournal } from '../../src/journal/persistent-turn-journal.js';

describe('PersistentTurnJournal', () => {
  it('durably sequences turn events and replays the committed terminal', async () => {
    const events: AgentRunEvent[] = [];
    const store = memoryStore(events);
    const journal = new PersistentTurnJournal({ sessionId: 'session-1', turnId: 'turn-1' }, store);

    await journal.append({ type: 'chunk', text: 'hello', accumulated: 'hello' });
    await journal.append({
      type: 'turn_end',
      output: [{ type: 'text', content: 'hello' }],
      usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
    });

    expect(events.map((event) => [event.sequence, event.type, event.terminal])).toEqual([
      [1, 'message.appended', undefined],
      [2, 'message.completed', undefined],
      [3, 'turn.completed', 'completed'],
    ]);
    await expect(journal.replay()).resolves.toEqual(events);
    expect(journal.terminal).toEqual(events[2]);
  });

  it('attributes tool calls and outputs to the authenticated turn principal', async () => {
    const events: AgentRunEvent[] = [];
    const journal = new PersistentTurnJournal(
      { sessionId: 'shared', turnId: 'turn-bob' },
      memoryStore(events),
      { subjectId: 'bob-id', displayName: 'Bob', roles: ['trusted'] },
    );

    await journal.append({
      type: 'tool_call', toolName: 'deploy', args: {}, toolUseId: 'call-1',
      causedBy: { subjectId: 'alice-id', displayName: 'Alice', roles: ['user'] },
    });
    await journal.append({
      type: 'tool_result', toolName: 'deploy', output: 'ok', durationMs: 2, toolUseId: 'call-1',
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      run: { turnId: 'turn-bob' },
      data: {
        callId: 'call-1',
        principal: { subjectId: 'bob-id', roles: ['trusted'] },
        causedBy: { subjectId: 'alice-id', displayName: 'Alice' },
      },
    });
    expect(events[1]).toMatchObject({
      run: { turnId: 'turn-bob' },
      data: { callId: 'call-1', principal: { subjectId: 'bob-id' } },
    });
  });

  it('links a participant control turn to the active turn it influenced', async () => {
    const events: AgentRunEvent[] = [];
    const journal = new PersistentTurnJournal(
      { sessionId: 'shared', turnId: 'turn-bob' },
      memoryStore(events),
      { subjectId: 'bob-id', displayName: 'Bob', roles: ['user'] },
    );

    await journal.append({
      type: 'turn_end',
      output: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      control: { intent: 'steer', targetTurnId: 'turn-alice' },
    });

    expect(events.at(-1)).toMatchObject({
      terminal: 'completed',
      run: { turnId: 'turn-bob' },
      data: {
        principal: { subjectId: 'bob-id' },
        control: { intent: 'steer', targetTurnId: 'turn-alice' },
      },
    });
  });

  it('does not commit or close the terminal when persistence fails', async () => {
    const append = vi.fn(async (event: AgentRunEvent) => {
      if (event.terminal) throw new Error('disk full');
    });
    const journal = new PersistentTurnJournal({ sessionId: 'session-1', turnId: 'turn-1' }, {
      append,
      replay: async () => [],
      listRuns: async () => [],
    });

    await expect(journal.append({
      type: 'turn_cancelled', code: 'timeout', reason: 'deadline',
    })).rejects.toThrow('disk full');
    expect(journal.terminal).toBeUndefined();
  });

  it('persists budget exhaustion as an explicit terminal fact', async () => {
    const events: AgentRunEvent[] = [];
    const journal = new PersistentTurnJournal(
      { sessionId: 'session-1', turnId: 'turn-budget' },
      memoryStore(events),
    );

    await journal.append({
      type: 'budget_exceeded',
      budget: 'tool_calls',
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
    });

    expect(journal.terminal).toMatchObject({
      type: 'turn.budget_exceeded',
      terminal: 'budget_exceeded',
      data: { budget: 'tool_calls' },
    });
  });

  it('resumes sequence from an existing non-terminal run', async () => {
    const events: AgentRunEvent[] = [{
      type: 'message.appended',
      version: 1,
      run: { sessionId: 'session-1', turnId: 'turn-resume' },
      sequence: 1,
      timestamp: 1,
      data: {},
    }];
    const journal = new PersistentTurnJournal(
      { sessionId: 'session-1', turnId: 'turn-resume' },
      memoryStore(events),
    );

    await journal.append({ type: 'chunk', text: 'next', accumulated: 'next' });
    expect(events.at(-1)?.sequence).toBe(2);
  });

  it('rejects appending to an already terminal run', async () => {
    const events: AgentRunEvent[] = [{
      type: 'turn.completed',
      version: 1,
      run: { sessionId: 'session-1', turnId: 'turn-terminal' },
      sequence: 1,
      timestamp: 1,
      terminal: 'completed',
      data: {},
    }];
    const journal = new PersistentTurnJournal(
      { sessionId: 'session-1', turnId: 'turn-terminal' },
      memoryStore(events),
    );

    await expect(journal.append({ type: 'chunk', text: 'late', accumulated: 'late' }))
      .rejects.toThrow('already terminal');
  });
});

function memoryStore(events: AgentRunEvent[]): JournalStore {
  return {
    append: (event) => { events.push(event); },
    replay: async (run, afterSequence = 0) => events.filter((event) =>
      event.run.sessionId === run.sessionId
      && event.run.turnId === run.turnId
      && event.sequence > afterSequence),
    listRuns: async () => [],
  };
}
