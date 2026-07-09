import type { Message } from '../orchestrator/types.js';
import type { ResolvedInboundQueueConfig } from './inbound-queue-config.js';

export class InboundTurnExpiredError extends Error {
  constructor(sessionKey: string) {
    super(`Inbound turn expired in queue for session ${sessionKey}`);
    this.name = 'InboundTurnExpiredError';
  }
}

interface QueuedInboundTurn<T> {
  sessionKey: string;
  senderId: string;
  commMessage: Message;
  textParts: string[];
  enqueuedAt: number;
  lastEnqueuedAt: number;
  coalesceEnabled: boolean;
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
    run: (mergedContent: string) => Promise<T>;
  }): Promise<T> {
    const { sessionKey, commMessage, run } = options;
    const coalesceEnabled = options.coalesce !== false;
    const content = options.content ?? '';
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
      textParts: content ? [content] : [],
      enqueuedAt: now,
      lastEnqueuedAt: now,
      coalesceEnabled,
      promise,
      run,
      resolve,
      reject,
    };

    queue.push(entry as QueuedInboundTurn<unknown>);

    const shouldShowPending = this.inFlight.has(sessionKey) || queue.length > 1;
    if (shouldShowPending) {
      this.activityEmitter.emitQueuedStart(commMessage, sessionKey);
    }

    void this.pump(sessionKey);
    return promise;
  }

  dispose(): void {
    for (const queue of this.queues.values()) {
      for (const entry of queue) {
        this.activityEmitter.emitQueuedClear(entry.commMessage, entry.sessionKey);
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
      this.activityEmitter.emitQueuedClear(expired.commMessage, sessionKey);
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

        this.activityEmitter.emitQueuedClear(entry.commMessage, sessionKey);

        try {
          const merged = entry.textParts.filter(Boolean).join('\n');
          const result = await entry.run(merged);
          entry.resolve(result);
        } catch (error) {
          entry.reject(error);
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
}
