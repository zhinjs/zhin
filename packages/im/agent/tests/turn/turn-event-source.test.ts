import { describe, expect, it } from 'vitest';
import type { TurnEvent } from '../../src/event/turn-event.js';
import { streamTurnEvents } from '../../src/turn/turn-event-source.js';

describe('streamTurnEvents', () => {
  it('publishes one terminal and ignores late events', async () => {
    const events = await collect(streamTurnEvents({
      execute: async (emit) => {
        emit({ type: 'chunk', text: 'ok', accumulated: 'ok' });
        emit(terminal('done'));
        emit({ type: 'chunk', text: 'late', accumulated: 'oklate' });
        emit(terminal('duplicate'));
        return [{ type: 'text', content: 'ignored fallback' }];
      },
    }));

    expect(events).toEqual([
      { type: 'chunk', text: 'ok', accumulated: 'ok' },
      terminal('done'),
    ]);
  });

  it('maps a rejected worker to one error terminal', async () => {
    const [event] = await collect(streamTurnEvents({
      execute: async () => { throw new Error('model unavailable'); },
    }));

    expect(event).toMatchObject({
      type: 'error',
      error: { message: 'model unavailable' },
      recoverable: false,
    });
  });

  it('waits for worker settlement when the consumer stops at terminal', async () => {
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => { settle = resolve; });
    let workerDone = false;
    const source = streamTurnEvents({
      execute: async (emit) => {
        emit(terminal('visible'));
        await settled;
        workerDone = true;
        return [];
      },
    });

    const first = await source.next();
    expect(first.value).toEqual(terminal('visible'));
    const closing = source.return(undefined);
    await Promise.resolve();
    expect(workerDone).toBe(false);
    settle();
    await closing;
    expect(workerDone).toBe(true);
  });
});

async function collect(source: AsyncGenerator<TurnEvent>): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of source) events.push(event);
  return events;
}

function terminal(content: string): TurnEvent {
  return {
    type: 'turn_end',
    output: [{ type: 'text', content }],
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  };
}
