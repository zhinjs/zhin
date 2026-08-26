import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type {
  ConsoleEventEnvelope,
  ConsoleEventHistoryPage,
  ConsoleEventHistoryQuery,
  ConsoleEventPayloadMap,
  KnownConsoleEventType,
} from '@zhin.js/console-protocol';
import { createToken } from '@zhin.js/plugin-runtime';

/**
 * Console 实时事件枢纽（Plugin Runtime Host 的 `/api/events` SSE 事件源）。
 * 单进程内 fan-out：`publish` 向所有已订阅的 SSE response 写帧；
 * write 失败或连接断开自动摘除订阅。
 */
export interface ConsoleEventSubscriptionOptions {
  readonly runtimeId?: string;
  readonly after?: number;
}

export interface ConsoleEventHub {
  publish<Type extends string>(
    type: Type,
    data: Type extends KnownConsoleEventType ? ConsoleEventPayloadMap[Type] : unknown,
  ): ConsoleEventEnvelope<
    Type,
    Type extends KnownConsoleEventType ? ConsoleEventPayloadMap[Type] : unknown
  >;
  history(query?: ConsoleEventHistoryQuery): ConsoleEventHistoryPage;
  /** In-process delivery for trusted Host bridges such as Device Protocol. */
  listen(listener: (event: ConsoleEventEnvelope) => void): () => void;
  /** Atomically replay the resumable suffix, then join live fan-out. */
  subscribe(response: ServerResponse, options?: ConsoleEventSubscriptionOptions): () => void;
  readonly runtimeId: string;
  readonly subscriberCount: number;
}

/** Shared Console event authority installed by the Plugin Runtime composition root. */
export const consoleEventHubToken = createToken<ConsoleEventHub>('zhin.host.console-events');

export interface ConsoleEventHubOptions {
  readonly runtimeId?: string;
  readonly historyLimit?: number;
  readonly historyByteLimit?: number;
  readonly historyPageByteLimit?: number;
}

const DEFAULT_HISTORY_LIMIT = 256;
const DEFAULT_PAGE_LIMIT = 200;
const MAX_PAGE_LIMIT = 500;
const MAX_EVENT_BYTES = 64 * 1024;
const DEFAULT_HISTORY_BYTE_LIMIT = 8 * 1024 * 1024;
const DEFAULT_HISTORY_PAGE_BYTE_LIMIT = 1024 * 1024;

interface JournalEntry {
  readonly event: ConsoleEventEnvelope;
  readonly frame: string;
  readonly bytes: number;
}

export function createConsoleEventHub(options: ConsoleEventHubOptions = {}): ConsoleEventHub {
  let nextId = 0;
  const runtimeId = options.runtimeId ?? randomUUID();
  const historyLimit = positiveInteger(options.historyLimit, DEFAULT_HISTORY_LIMIT);
  const historyByteLimit = positiveInteger(options.historyByteLimit, DEFAULT_HISTORY_BYTE_LIMIT);
  const historyPageByteLimit = positiveInteger(
    options.historyPageByteLimit,
    DEFAULT_HISTORY_PAGE_BYTE_LIMIT,
  );
  const journal: JournalEntry[] = [];
  let journalBytes = 0;
  const subscribers = new Set<ServerResponse>();
  const listeners = new Set<(event: ConsoleEventEnvelope) => void>();

  const remove = (response: ServerResponse): void => {
    subscribers.delete(response);
  };

  const write = (response: ServerResponse, entry: JournalEntry): void => {
    let failed = false;
    const accepted = response.write(entry.frame, (error) => {
      if (error) {
        failed = true;
        remove(response);
      }
    });
    if (failed) throw new Error('Console event subscriber rejected replay');
    if (!accepted) {
      remove(response);
      response.destroy(new Error('Console event subscriber backpressure limit reached'));
      throw new Error('Console event subscriber backpressure limit reached');
    }
  };

  return {
    runtimeId,
    get subscriberCount() {
      return subscribers.size;
    },
    publish<Type extends string>(
      type: Type,
      data: Type extends KnownConsoleEventType ? ConsoleEventPayloadMap[Type] : unknown,
    ): ConsoleEventEnvelope<
      Type,
      Type extends KnownConsoleEventType ? ConsoleEventPayloadMap[Type] : unknown
    > {
      const snapshot = jsonSnapshot(data);
      const event = Object.freeze({
        runtimeId,
        eventId: ++nextId,
        type,
        data: snapshot,
        timestamp: Date.now(),
      });
      const frame = serializeConsoleEvent(event);
      const entry = Object.freeze({ event, frame, bytes: Buffer.byteLength(frame, 'utf8') });
      journal.push(entry);
      journalBytes += entry.bytes;
      while (journal.length > historyLimit || journalBytes > historyByteLimit) {
        journalBytes -= journal.shift()?.bytes ?? 0;
      }
      for (const response of [...subscribers]) {
        try {
          write(response, entry);
        } catch {
          remove(response);
        }
      }
      for (const listener of [...listeners]) {
        try { listener(event); } catch { /* isolate trusted bridge failures */ }
      }
      return event as ConsoleEventEnvelope<
        Type,
        Type extends KnownConsoleEventType ? ConsoleEventPayloadMap[Type] : unknown
      >;
    },
    history(query = {}): ConsoleEventHistoryPage {
      const requestedAfter = nonNegativeInteger(query.after, 0);
      const sameRuntime = !query.runtimeId || query.runtimeId === runtimeId;
      const cursorAhead = requestedAfter > nextId;
      const after = sameRuntime && !cursorAhead ? requestedAfter : 0;
      const limit = Math.min(MAX_PAGE_LIMIT, positiveInteger(query.limit, DEFAULT_PAGE_LIMIT));
      const oldestAvailableEventId = journal[0]?.event.eventId ?? null;
      const latestEventId = nextId;
      const gap = !sameRuntime || cursorAhead
        || (oldestAvailableEventId !== null
          ? after < oldestAvailableEventId - 1
          : after < latestEventId);
      const available = journal.filter((entry) => entry.event.eventId > after);
      const selected: ConsoleEventEnvelope[] = [];
      let selectedBytes = 0;
      for (const entry of available) {
        if (selected.length >= limit) break;
        if (selected.length > 0 && selectedBytes + entry.bytes > historyPageByteLimit) break;
        selected.push(entry.event);
        selectedBytes += entry.bytes;
      }
      const items = Object.freeze(selected);
      const nextAfter = items.at(-1)?.eventId ?? after;
      return Object.freeze({
        runtimeId,
        items,
        oldestAvailableEventId,
        latestEventId,
        nextAfter,
        hasMore: available.length > items.length,
        gap,
      });
    },
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribe(response, options = {}) {
      // Replay and subscription are synchronous relative to publish(), closing
      // the race between HTTP recovery and the live stream hand-off.
      const requestedAfter = nonNegativeInteger(options.after, 0);
      const after = options.runtimeId && options.runtimeId !== runtimeId
        || requestedAfter > nextId
        ? 0
        : requestedAfter;
      try {
        for (const entry of journal) {
          if (entry.event.eventId > after) write(response, entry);
        }
        subscribers.add(response);
      } catch {
        remove(response);
      }
      response.once('close', () => remove(response));
      response.once('error', () => remove(response));
      return () => remove(response);
    },
  };
}

export function serializeConsoleEvent(event: ConsoleEventEnvelope): string {
  return `id: ${event.eventId}\nevent: ${event.type}\nruntime: ${event.runtimeId}\ntimestamp: ${event.timestamp}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function jsonSnapshot(value: unknown): unknown {
  const encoded = JSON.stringify(value ?? null);
  if (encoded === undefined) throw new TypeError('Console event data must be JSON serializable');
  if (Buffer.byteLength(encoded, 'utf8') > MAX_EVENT_BYTES) {
    throw new RangeError(`Console event data exceeds ${MAX_EVENT_BYTES} bytes`);
  }
  return JSON.parse(encoded) as unknown;
}
