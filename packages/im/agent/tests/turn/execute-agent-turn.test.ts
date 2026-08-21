import { describe, expect, it, vi } from 'vitest';
import type { TurnEvent } from '../../src/event/turn-event.js';
import { executeAgentTurn } from '../../src/turn/execute-agent-turn.js';
import { createTurnIngress, type TurnIngressInput } from '../../src/turn/turn-ingress.js';
import { TurnJournalCommitError } from '../../src/turn/journal-integrity.js';

function turn(): ReturnType<typeof createTurnIngress> {
  return createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 3, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'http', sessionId: 'http-session' },
    principal: { subjectId: 'user', roles: ['user'] },
    input: { text: 'hello' },
    session: { key: 'http:http-session' },
    policy: { permissions: ['user'], unattended: false },
    capabilities: { tools: [], skills: [] },
    signal: new AbortController().signal,
    ports: { journal: { append: () => undefined } },
  } satisfies TurnIngressInput);
}

function turnWithJournal(events: TurnEvent[]): ReturnType<typeof createTurnIngress> {
  return createTurnIngress({
    intent: { kind: 'new' },
    ...turn(),
    ports: { journal: { append: (event) => { events.push(event); } } },
  });
}

async function* events(items: readonly TurnEvent[]): AsyncGenerator<TurnEvent, void> {
  for (const event of items) yield event;
}

describe('executeAgentTurn', () => {
  it('returns one completed outcome and projects the ordered event stream', async () => {
    const source = turn();
    const observed: string[] = [];
    const run = vi.fn(() => events([
      { type: 'chunk', text: 'ok', accumulated: 'ok' },
      {
        type: 'turn_end',
        output: [{ type: 'text', content: 'ok' }],
        usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
      },
    ]));

    const outcome = await executeAgentTurn(source, run, (event) => observed.push(event.type));

    expect(run).toHaveBeenCalledWith(source);
    expect(observed).toEqual(['chunk', 'turn_end']);
    expect(outcome).toEqual({
      status: 'completed',
      output: [{ type: 'text', content: 'ok' }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    });
  });

  it('maps a cancelled terminal without throwing', async () => {
    const outcome = await executeAgentTurn(turn(), () => events([
      { type: 'turn_cancelled', code: 'timeout', reason: 'deadline elapsed' },
    ]));
    expect(outcome).toEqual({
      status: 'cancelled',
      reason: 'deadline elapsed',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  });

  it('fails closed when the engine ends without a terminal event', async () => {
    const journal: TurnEvent[] = [];
    const outcome = await executeAgentTurn(turnWithJournal(journal), () => events([
      { type: 'chunk', text: 'partial', accumulated: 'partial' },
    ]));
    expect(outcome).toMatchObject({
      status: 'failed',
      error: { code: 'turn_terminal_missing', retryable: false },
    });
    expect(journal.at(-1)).toMatchObject({ type: 'error', recoverable: false });
  });

  it('commits one durable error terminal when the engine throws', async () => {
    const journal: TurnEvent[] = [];
    const outcome = await executeAgentTurn(turnWithJournal(journal), async function* () {
      yield { type: 'usage', usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4 } };
      throw new Error('provider offline');
    });

    expect(outcome).toMatchObject({
      status: 'failed',
      error: { code: 'turn_engine_failed', message: 'provider offline' },
      usage: { total_tokens: 4 },
    });
    expect(journal.filter((event) => event.type === 'error')).toHaveLength(1);
    expect(journal.at(-1)).toMatchObject({ type: 'error', recoverable: true });
  });

  it('reports a tool fact integrity failure with the stable journal error code', async () => {
    const journal: TurnEvent[] = [];
    const outcome = await executeAgentTurn(turnWithJournal(journal), async function* () {
      yield* events([]);
      throw new TurnJournalCommitError(new Error('tool fact unavailable'));
    });

    expect(outcome).toMatchObject({
      status: 'failed',
      error: {
        code: 'turn_journal_commit_failed',
        message: 'tool fact unavailable',
        retryable: false,
      },
    });
    expect(journal.at(-1)).toMatchObject({
      type: 'error',
      code: 'turn_journal_commit_failed',
      recoverable: false,
    });
  });

  it('commits one durable cancellation terminal when the ingress aborts', async () => {
    const journal: TurnEvent[] = [];
    const controller = new AbortController();
    const source = createTurnIngress({
    intent: { kind: 'new' },
      ...turnWithJournal(journal),
      signal: controller.signal,
    });
    const outcome = await executeAgentTurn(source, async function* () {
      yield* events([]);
      controller.abort(new Error('deadline'));
      throw new Error('transport aborted');
    });

    expect(outcome).toMatchObject({ status: 'cancelled', reason: 'deadline' });
    expect(journal.at(-1)).toMatchObject({
      type: 'turn_cancelled',
      code: 'cancelled',
      reason: 'deadline',
    });
  });

  it('does not let an observer failure replace an accepted terminal outcome', async () => {
    const outcome = await executeAgentTurn(turn(), async function* () {
      yield {
        type: 'turn_end',
        output: [{ type: 'text', content: 'done' }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    }, () => {
      throw new Error('projection failed');
    });

    expect(outcome).toMatchObject({ status: 'completed', output: [{ content: 'done' }] });
  });

  it('commits the first terminal and does not consume a throwing tail', async () => {
    const outcome = await executeAgentTurn(turn(), async function* () {
      yield {
        type: 'turn_end', output: [{ type: 'text', content: 'committed' }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
      throw new Error('late engine failure');
    });
    expect(outcome).toMatchObject({ status: 'completed', output: [{ content: 'committed' }] });
  });

  it('commits the terminal fact before applying its conversation projection', async () => {
    const order: string[] = [];
    const source = createTurnIngress({
    intent: { kind: 'new' },
      ...turn(),
      ports: { journal: { append: async (event) => { order.push(`journal:${event.type}`); } } },
    });
    const outcome = await executeAgentTurn(source, async function* () {
      yield {
        type: 'turn_end', output: [{ type: 'text', content: 'committed' }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
      return { project: async () => { order.push('projection'); } };
    });

    expect(outcome.status).toBe('completed');
    expect(order).toEqual(['journal:turn_end', 'projection']);
  });

  it('does not rewrite a committed terminal when a projection fails', async () => {
    const diagnostics: string[] = [];
    const source = createTurnIngress({
    intent: { kind: 'new' },
      ...turn(),
      ports: {
        journal: { append: async () => undefined },
        activity: { publish: (event) => { diagnostics.push(String(event.data)); } },
      },
    });
    const outcome = await executeAgentTurn(source, async function* () {
      yield {
        type: 'turn_end', output: [{ type: 'text', content: 'committed' }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
      return { project: async () => { throw new Error('projection unavailable'); } };
    });

    expect(outcome.status).toBe('completed');
    expect(diagnostics).toEqual(['projection unavailable']);
  });

  it('fails closed when the required journal cannot commit the terminal', async () => {
    const source = createTurnIngress({
    intent: { kind: 'new' },
      ...turn(),
      ports: { journal: { append: () => { throw new Error('journal unavailable'); } } },
    });
    const outcome = await executeAgentTurn(source, () => events([{
      type: 'turn_end',
      output: [{ type: 'text', content: 'must not escape' }],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }]));

    expect(outcome).toMatchObject({
      status: 'failed',
      error: { code: 'turn_journal_commit_failed', message: 'journal unavailable' },
    });
  });

  it('retains model usage when a later terminal fails', async () => {
    const outcome = await executeAgentTurn(turn(), () => events([
      { type: 'usage', usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 } },
      { type: 'error', error: new Error('provider failed'), recoverable: true },
    ]));

    expect(outcome).toEqual({
      status: 'failed',
      error: { code: 'turn_failed', message: 'provider failed', retryable: true },
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
    });
  });
});
