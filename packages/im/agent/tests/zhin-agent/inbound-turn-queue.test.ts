import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  InboundTurnCancelledError,
  InboundTurnExpiredError,
  InboundTurnQueue,
  type InboundQueueActivityEmitter,
} from '../../src/turn/inbound-turn-queue.js';
import { normalizeInboundQueueConfig } from '../../src/turn/inbound-queue-config.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import { activityFeedbackAiBus } from '../../src/activity-feedback/ai-bus.js';
import { ZhinAgentEventEmitter } from '../../src/event/event-emitter.js';
import { createInboundTurnQueue } from '../../src/turn/inbound-queue-runtime.js';

describe('InboundTurnQueue', () => {
  const fifoConfig = normalizeInboundQueueConfig({ groupMode: 'fifo' });
  let emitter: InboundQueueActivityEmitter & {
    starts: Array<{ sessionKey: string; messageId?: string }>;
    clears: Array<{ sessionKey: string; messageId?: string }>;
  };

  beforeEach(() => {
    activityFeedbackAiBus.clear();
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

  it('marks every message queued behind a pending turn as activity-feedback eligible', async () => {
    const runtime = createInboundTurnQueue({
      inboundQueue: { groupMode: 'fifo', coalesceWindowMs: 0 },
    } as never, new ZhinAgentEventEmitter());
    const sessionKey = 'sandbox:b1:group:g1';
    const starts: Array<{ messageId?: string; eligible?: unknown }> = [];
    activityFeedbackAiBus.on('ai.activity.queued.start', (payload) => {
      starts.push({
        messageId: payload.messageId,
        eligible: payload.hookContext?.activityFeedbackEligible,
      });
    });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = runtime.queue.schedule({
      sessionKey,
      commMessage: messageWithId({ scope: 'group', sceneId: 'g1', senderId: 'u1', messageId: 'm1' }),
      content: 'busy',
      run: async () => {
        await firstGate;
        return 'first';
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = runtime.queue.schedule({
      sessionKey,
      commMessage: messageWithId({ scope: 'group', sceneId: 'g1', senderId: 'u2', messageId: 'm2' }),
      content: 'next',
      run: async () => 'second',
    });

    await vi.waitFor(() => expect(starts).toContainEqual({ messageId: 'm2', eligible: true }));
    releaseFirst();
    await Promise.all([first, second]);
    runtime.queue.dispose();
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

  it('acknowledges and clears every coalesced message while another turn is active', async () => {
    const queue = new InboundTurnQueue(fifoConfig, emitter);
    const sessionKey = 'sandbox:b1:group:g1';
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = queue.schedule({
      sessionKey,
      commMessage: messageWithId({ scope: 'group', sceneId: 'g1', senderId: 'u1', messageId: 'm1' }),
      content: 'busy',
      run: async () => {
        await firstGate;
        return ['busy'];
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = queue.schedule({
      sessionKey,
      commMessage: messageWithId({ scope: 'group', sceneId: 'g1', senderId: 'u2', messageId: 'm2' }),
      content: 'hello',
      run: async (merged) => [merged],
    });
    const third = queue.schedule({
      sessionKey,
      commMessage: messageWithId({ scope: 'group', sceneId: 'g1', senderId: 'u2', messageId: 'm3' }),
      content: 'world',
      run: async (merged) => [merged],
    });

    expect(second).toBe(third);
    expect(emitter.starts.map((event) => event.messageId)).toEqual(['m2', 'm3']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(emitter.clears.map((event) => event.messageId)).toEqual(['m2', 'm3']);
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

  it('removes a cancelled queued turn before it can execute', async () => {
    const queue = new InboundTurnQueue(fifoConfig, emitter);
    const sessionKey = 'sandbox:b1:group:g1';
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const ran: string[] = [];

    void queue.schedule({
      sessionKey,
      commMessage: messageWithId({ scope: 'group', sceneId: 'g1', senderId: 'u1', messageId: 'm1' }),
      run: async () => {
        await firstGate;
        return [];
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const controller = new AbortController();
    const cancelled = queue.schedule({
      sessionKey,
      commMessage: messageWithId({ scope: 'group', sceneId: 'g1', senderId: 'u2', messageId: 'm2' }),
      signal: controller.signal,
      run: async () => {
        ran.push('cancelled turn');
        return [];
      },
    });
    controller.abort();
    releaseFirst();

    await expect(cancelled).rejects.toBeInstanceOf(InboundTurnCancelledError);
    expect(ran).toEqual([]);
    expect(emitter.clears.some((entry) => entry.messageId === 'm2')).toBe(true);
  });
});
