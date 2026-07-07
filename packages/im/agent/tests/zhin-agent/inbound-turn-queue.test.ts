import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  InboundTurnExpiredError,
  InboundTurnQueue,
  type InboundQueueActivityEmitter,
} from '../../src/zhin-agent/inbound-turn-queue.js';
import { normalizeInboundQueueConfig } from '../../src/zhin-agent/inbound-queue-config.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

describe('InboundTurnQueue', () => {
  const fifoConfig = normalizeInboundQueueConfig({ groupMode: 'fifo' });
  let emitter: InboundQueueActivityEmitter & {
    starts: Array<{ sessionKey: string; messageId?: string }>;
    clears: Array<{ sessionKey: string; messageId?: string }>;
  };

  beforeEach(() => {
    emitter = {
      starts: [],
      clears: [],
      emitQueuedStart(commMessage, sessionKey) {
        this.starts.push({ sessionKey, messageId: commMessage.$id });
      },
      emitQueuedClear(commMessage, sessionKey) {
        this.clears.push({ sessionKey, messageId: commMessage.$id });
      },
    };
  });

  function messageWithId(overrides: Parameters<typeof mockCommMessage>[0] & { messageId?: string }) {
    const { messageId = 'msg-1', ...rest } = overrides;
    return { ...mockCommMessage(rest), $id: messageId } as ReturnType<typeof mockCommMessage> & { $id: string };
  }

  it('runs same-session turns in FIFO order', async () => {
    const queue = new InboundTurnQueue(fifoConfig, emitter);
    const sessionKey = 'sandbox:b1:group:g1';
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = queue.schedule({
      sessionKey,
      commMessage: messageWithId({ scope: 'group', sceneId: 'g1', senderId: 'u1', messageId: 'm1' }),
      content: 'first',
      run: async () => {
        order.push('start:first');
        await firstGate;
        order.push('end:first');
        return ['first'];
      },
    });

    await new Promise((r) => setTimeout(r, 5));

    const second = queue.schedule({
      sessionKey,
      commMessage: messageWithId({ scope: 'group', sceneId: 'g1', senderId: 'u2', messageId: 'm2' }),
      content: 'second',
      run: async () => {
        order.push('start:second');
        return ['second'];
      },
    });

    expect(emitter.starts.some((e) => e.messageId === 'm2')).toBe(true);

    releaseFirst();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(['first']);
    expect(b).toEqual(['second']);
    expect(order).toEqual(['start:first', 'end:first', 'start:second']);
    expect(emitter.clears.some((e) => e.messageId === 'm2')).toBe(true);
  });

  it('coalesces same sender within the window', async () => {
    const queue = new InboundTurnQueue(fifoConfig, emitter);
    const sessionKey = 'sandbox:b1:group:g1';
    const seen: string[] = [];

    const first = queue.schedule({
      sessionKey,
      commMessage: messageWithId({ scope: 'group', sceneId: 'g1', senderId: 'u1', messageId: 'm1' }),
      content: 'hello',
      run: async (merged) => {
        seen.push(merged);
        return [merged];
      },
    });

    const second = queue.schedule({
      sessionKey,
      commMessage: messageWithId({ scope: 'group', sceneId: 'g1', senderId: 'u1', messageId: 'm2' }),
      content: 'world',
      run: async (merged) => {
        seen.push(merged);
        return [merged];
      },
    });

    expect(first).toBe(second);
    const result = await first;
    expect(result).toEqual(['hello\nworld']);
  });

  it('drops expired queue items and clears queued feedback', async () => {
    vi.useFakeTimers();
    const queue = new InboundTurnQueue(
      normalizeInboundQueueConfig({ groupMode: 'fifo', ttlMs: 1_000, coalesceWindowMs: 0 }),
      emitter,
    );
    const sessionKey = 'sandbox:b1:group:g1';

    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    void queue.schedule({
      sessionKey,
      commMessage: messageWithId({ scope: 'group', sceneId: 'g1', senderId: 'u1', messageId: 'm1' }),
      content: 'busy',
      run: async () => {
        await gate;
        return ['busy'];
      },
    });

    await vi.advanceTimersByTimeAsync(5);

    const expired = queue.schedule({
      sessionKey,
      commMessage: messageWithId({ scope: 'group', sceneId: 'g1', senderId: 'u2', messageId: 'm2' }),
      content: 'late',
      run: async () => ['late'],
    });

    await vi.advanceTimersByTimeAsync(1_500);
    releaseFirst();

    await expect(expired).rejects.toBeInstanceOf(InboundTurnExpiredError);
    expect(emitter.clears.some((e) => e.messageId === 'm2')).toBe(true);
    vi.useRealTimers();
  });
});
