import type { Message } from '../resource-hub/types.js';
import type { ResolvedInboundQueueConfig } from './inbound-queue-config.js';

export class InboundTurnExpiredError extends Error {
  constructor(sessionKey: string) {
    super(`Inbound turn expired in queue for session ${sessionKey}`);
    this.name = 'InboundTurnExpiredError';
  }
}

export class InboundTurnCancelledError extends Error {
  constructor(sessionKey: string, reason?: unknown) {
    super(`Inbound turn cancelled in queue for session ${sessionKey}`, reason === undefined ? undefined : { cause: reason });
    this.name = 'InboundTurnCancelledError';
  }
}

interface QueuedInboundTurn<T> {
  sessionKey: string;
  senderId: string;
  commMessage: Message;
  queuedFeedbackMessages: Message[];
  textParts: string[];
  enqueuedAt: number;
  lastEnqueuedAt: number;
  coalesceEnabled: boolean;
  signal?: AbortSignal;
  started: boolean;
  disposeAbortListener?: () => void;
  promise: Promise<T>;
  run: (mergedContent: string) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export interface InboundQueueActivityEmitter {
  emitQueuedStart(commMessage: Message, sessionKey: string): void;
  emitQueuedClear(commMessage: Message, sessionKey: string): void;
}

const noopEmitter: InboundQueueActivityEmitter = {
  emitQueuedStart() {},
  emitQueuedClear() {},
};

export class InboundTurnQueue {
  private readonly queues = new Map<string, QueuedInboundTurn<unknown>[]>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private config: ResolvedInboundQueueConfig,
    private activityEmitter: InboundQueueActivityEmitter = noopEmitter,
  ) {}

  updateConfig(config: ResolvedInboundQueueConfig): void {
    this.config = config;
  }

  schedule<T>(options: {
    sessionKey: string;
    commMessage: Message;
    content?: string;
    coalesce?: boolean;
    signal?: AbortSignal;
    run: (mergedContent: string) => Promise<T>;
  }): Promise<T> {
    const { sessionKey, commMessage, run } = options;
    // A cancellable caller owns an individual deadline, so it cannot safely
    // share a coalesced promise with another inbound message.
    const coalesceEnabled = options.coalesce !== false && options.signal === undefined;
    const content = options.content ?? '';
    if (options.signal?.aborted) {
      return Promise.reject(inboundAbortReason(sessionKey, options.signal.reason));
    }
    const senderId = String(commMessage.$sender?.id ?? 'unknown');
    const now = Date.now();
    const queue = this.queues.get(sessionKey) ?? [];
    this.queues.set(sessionKey, queue);

    if (coalesceEnabled && content && queue.length > 0) {
      const tail = queue[queue.length - 1] as QueuedInboundTurn<T>;
      if (
        tail.senderId === senderId
        && now - tail.lastEnqueuedAt < this.config.coalesceWindowMs
      ) {
        tail.textParts.push(content);
        tail.lastEnqueuedAt = now;
        tail.commMessage = commMessage;
        tail.run = run;
        this.activityEmitter.emitQueuedStart(commMessage, sessionKey);
        tail.queuedFeedbackMessages.push(commMessage);
        void this.pump(sessionKey);
        return tail.promise;
      }
    }

    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const entry: QueuedInboundTurn<T> = {
      sessionKey,
      senderId,
      commMessage,
      queuedFeedbackMessages: [],
      textParts: content ? [content] : [],
      enqueuedAt: now,
      lastEnqueuedAt: now,
      coalesceEnabled,
      signal: options.signal,
      started: false,
      promise,
      run,
      resolve,
      reject,
    };

    if (options.signal) {
      const abort = () => this.cancelQueuedEntry(entry as QueuedInboundTurn<unknown>);
      options.signal.addEventListener('abort', abort, { once: true });
      entry.disposeAbortListener = () => options.signal?.removeEventListener('abort', abort);
    }

    queue.push(entry as QueuedInboundTurn<unknown>);

    const shouldShowPending = this.inFlight.has(sessionKey) || queue.length > 1;
    if (shouldShowPending) {
      this.activityEmitter.emitQueuedStart(commMessage, sessionKey);
      entry.queuedFeedbackMessages.push(commMessage);
    }

    void this.pump(sessionKey);
    return promise;
  }

  dispose(): void {
    for (const queue of this.queues.values()) {
      for (const entry of queue) {
        entry.disposeAbortListener?.();
        this.clearQueuedFeedback(entry);
        entry.reject(new Error('InboundTurnQueue disposed'));
      }
    }
    this.queues.clear();
    this.inFlight.clear();
  }

  private isExpired(entry: QueuedInboundTurn<unknown>, now: number): boolean {
    return this.config.ttlMs > 0 && entry.enqueuedAt + this.config.ttlMs < now;
  }

  private async discardExpired(sessionKey: string): Promise<void> {
    const queue = this.queues.get(sessionKey);
    if (!queue?.length) return;

    const now = Date.now();
    while (queue.length > 0 && this.isExpired(queue[0]!, now)) {
      const expired = queue.shift()!;
      expired.disposeAbortListener?.();
      this.clearQueuedFeedback(expired);
      expired.reject(new InboundTurnExpiredError(sessionKey));
    }

    if (!queue.length) {
      this.queues.delete(sessionKey);
    }
  }

  private async pump(sessionKey: string): Promise<void> {
    if (this.inFlight.has(sessionKey)) return;

    const runLoop = async (): Promise<void> => {
      while (true) {
        await this.discardExpired(sessionKey);
        const queue = this.queues.get(sessionKey);
        if (!queue?.length) {
          this.queues.delete(sessionKey);
          return;
        }

        const entry = queue.shift()!;
        if (!queue.length) {
          this.queues.delete(sessionKey);
        }

        this.clearQueuedFeedback(entry);
        entry.started = true;

        try {
          const merged = entry.textParts.filter(Boolean).join('\n');
          const result = await entry.run(merged);
          entry.resolve(result);
        } catch (error) {
          entry.reject(error);
        } finally {
          entry.disposeAbortListener?.();
        }
      }
    };

    const flight = runLoop().finally(() => {
      if (this.inFlight.get(sessionKey) === flight) {
        this.inFlight.delete(sessionKey);
      }
    });
    this.inFlight.set(sessionKey, flight);
    await flight;
  }

  private cancelQueuedEntry(entry: QueuedInboundTurn<unknown>): void {
    if (entry.started) return;
    const queue = this.queues.get(entry.sessionKey);
    if (!queue) return;
    const index = queue.indexOf(entry);
    if (index === -1) return;
    queue.splice(index, 1);
    if (queue.length === 0) this.queues.delete(entry.sessionKey);
    entry.disposeAbortListener?.();
    this.clearQueuedFeedback(entry);
    entry.reject(inboundAbortReason(entry.sessionKey, entry.signal?.reason));
  }

  private clearQueuedFeedback(entry: QueuedInboundTurn<unknown>): void {
    for (const commMessage of entry.queuedFeedbackMessages) {
      this.activityEmitter.emitQueuedClear(commMessage, entry.sessionKey);
    }
    entry.queuedFeedbackMessages.length = 0;
  }
}

function inboundAbortReason(sessionKey: string, reason?: unknown): Error {
  if (reason instanceof Error && reason.name !== 'AbortError') return reason;
  return new InboundTurnCancelledError(sessionKey, reason);
}
