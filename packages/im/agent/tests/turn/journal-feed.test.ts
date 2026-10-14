import { describe, expect, it } from 'vitest';
import type { TurnEvent } from '../../src/event/turn-event.js';
import { executeAgentTurn } from '../../src/turn/execute-agent-turn.js';
import { createJournalFeed, journalFeedOf } from '../../src/turn/journal-feed.js';
import { createTurnIngress, type TurnIngressInput } from '../../src/turn/turn-ingress.js';
import { createScopedTraceJournal } from '../../src/trace/turn-trace-registry.js';

const end: TurnEvent = { type: 'turn_end', output: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };

function feedTurn(committed: TurnEvent[], append?: (event: TurnEvent) => void) {
  return createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'http', sessionId: 's' },
    principal: { subjectId: 'user', roles: ['user'] },
    input: { text: 'hi' },
    session: { key: 'http:s' },
    policy: { permissions: ['user'], unattended: false },
    capabilities: { tools: [], skills: [] },
    signal: new AbortController().signal,
    ports: {
      journal: createJournalFeed({ append: (event) => { append?.(event); committed.push(event); } }, { turnId: 'turn' }),
    },
  } satisfies TurnIngressInput);
}

const call: TurnEvent = { type: 'tool_call', toolName: 'lookup', args: {}, toolUseId: 't1' };
const result: TurnEvent = { type: 'tool_result', toolName: 'lookup', output: 'ok', durationMs: 1, toolUseId: 't1' };

describe('journal-derived stream feed (#748)', () => {
  it('delivers events committed straight to the journal to observers, in commit order, without re-appending', async () => {
    const committed: TurnEvent[] = [];
    const turn = feedTurn(committed);
    const observed: TurnEvent[] = [];
    const outcome = await executeAgentTurn(turn, async function* () {
      yield { type: 'chunk', text: 'a', accumulated: 'a' };
      // Authority path: TurnToolRuntime journals tool events before executing.
      await turn.ports.journal.append(call);
      await turn.ports.journal.append(result);
      yield end;
    }, (event) => { observed.push(event); });
    expect(outcome.status).toBe('completed');
    expect(observed.map((event) => event.type)).toEqual(['chunk', 'tool_call', 'tool_result', 'turn_end']);
    expect(observed[1]).toBe(call);
    // Single source: each fact is committed exactly once.
    expect(committed.map((event) => event.type)).toEqual(['chunk', 'tool_call', 'tool_result', 'turn_end']);
  });

  it('does not surface events whose journal commit failed', async () => {
    const committed: TurnEvent[] = [];
    const turn = feedTurn(committed, (event) => { if (event.type === 'tool_call') throw new Error('disk full'); });
    const observed: string[] = [];
    await executeAgentTurn(turn, async function* () {
      await turn.ports.journal.append(call).catch(() => undefined);
      yield end;
    }, (event) => { observed.push(event.type); });
    expect(observed).toEqual(['turn_end']);
  });

  it('keeps sub-agent events out of the parent feed', async () => {
    const committed: TurnEvent[] = [];
    const turn = feedTurn(committed);
    const child = createScopedTraceJournal(turn.ports.journal, { turnId: 'turn:subagent:1', sessionKey: 'x' });
    const observed: string[] = [];
    await executeAgentTurn(turn, async function* () {
      await child.append({ ...call });
      yield end;
    }, (event) => { observed.push(event.type); });
    expect(observed).toEqual(['turn_end']);
    expect(committed.map((event) => event.type)).toEqual(['tool_call', 'turn_end']);
  });

  it('buffers nothing while no turn is observing', async () => {
    const port = createJournalFeed({ append: () => undefined }, { turnId: 'turn' });
    await port.append(call);
    const feed = journalFeedOf(port)!;
    expect(feed.drain()).toEqual([]);
    const close = feed.open();
    await port.append(call);
    expect(feed.drain()).toEqual([call]);
    close();
  });
});
