import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../src/plugin-runtime/im/contracts.js';
import { createSyntheticMessage } from '../src/built/message-enrich.js';
import type { MessageMiddleware } from '../src/types.js';
import { compose } from '../src/utils.js';

function makeMessage(text: string): Message {
  return createSyntheticMessage({
    conversation: {
      endpoint: { id: 'bot1', adapter: 'test' },
      kind: 'group',
      id: 'ch1',
    },
    sender: { id: 'u1', name: 'U' },
    content: text,
    segments: [{ type: 'text', data: { text } }],
    messageId: `msg-${Math.random().toString(36).slice(2, 8)}`,
  });
}

describe('compose stress', () => {
  it('runs 100 middleware layers for 1000 messages', async () => {
    const middlewares: MessageMiddleware[] = Array.from(
      { length: 100 },
      () => async (_message, next) => next(),
    );
    const run = compose(middlewares);
    const message = makeMessage('ping');

    const start = performance.now();
    for (let index = 0; index < 1000; index += 1) {
      await run(message, async () => undefined);
    }

    expect(performance.now() - start).toBeLessThan(5000);
  });

  it('isolates middleware failures between messages', async () => {
    let successes = 0;
    const run = compose([
      async (message, next) => {
        if (message.content === 'bomb') throw new Error('boom');
        await next();
      },
    ]);

    for (let index = 0; index < 100; index += 1) {
      try {
        await run(makeMessage(index % 10 === 0 ? 'bomb' : 'ok'), async () => {
          successes += 1;
        });
      } catch {
        // Expected for each deliberately failing message.
      }
    }

    expect(successes).toBe(90);
  });

  it('calls terminal next for an empty chain', async () => {
    const next = vi.fn(async () => undefined);
    await compose([])(makeMessage('empty'), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects repeated next calls', async () => {
    const run = compose([
      async (_message, next) => {
        await next();
        await next();
      },
    ]);

    await expect(run(makeMessage('repeat')))
      .rejects.toThrow('next() called multiple times');
  });
});
