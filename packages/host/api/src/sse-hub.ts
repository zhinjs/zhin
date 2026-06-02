export type ConsoleSseEvent = {
  type: string;
  data?: unknown;
  timestamp?: number;
  requestId?: number;
  error?: string;
};

type StoredEvent = ConsoleSseEvent & { id: string };

type Subscriber = {
  id: string;
  enqueue: (chunk: string) => void;
  close: () => void;
};

const MAX_REPLAY = 200;
let subscribers = new Map<string, Subscriber>();
let nextSubId = 0;
let nextEventId = 0;
const eventHistory: StoredEvent[] = [];

function pushHistory(event: ConsoleSseEvent): StoredEvent {
  const stored: StoredEvent = {
    ...event,
    timestamp: event.timestamp ?? Date.now(),
    id: String(++nextEventId),
  };
  eventHistory.push(stored);
  if (eventHistory.length > MAX_REPLAY) eventHistory.shift();
  return stored;
}

export function formatSse(event: ConsoleSseEvent, id?: string): string {
  const lines: string[] = [];
  if (id) lines.push(`id: ${id}`);
  lines.push(`data: ${JSON.stringify(event)}`);
  lines.push("");
  return lines.join("\n") + "\n";
}

export function subscribeSse(
  initial: ConsoleSseEvent[] = [],
  lastEventId?: string,
): { stream: ReadableStream<Uint8Array>; id: string } {
  const id = `sse-${++nextSubId}`;
  const encoder = new TextEncoder();
  const replayFrom = lastEventId ? Number.parseInt(lastEventId, 10) : 0;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const ev of eventHistory) {
        if (Number(ev.id) > replayFrom) {
          controller.enqueue(encoder.encode(formatSse(ev, ev.id)));
        }
      }
      for (const ev of initial) {
        const stored = pushHistory(ev);
        controller.enqueue(encoder.encode(formatSse(stored, stored.id)));
      }
      if (initial.length === 0 && eventHistory.length === 0) {
        const stored = pushHistory({ type: "init-data", timestamp: Date.now() });
        controller.enqueue(encoder.encode(formatSse(stored, stored.id)));
      }
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(interval);
        }
      }, 15000);
      subscribers.set(id, {
        id,
        enqueue: (chunk) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            /* closed */
          }
        },
        close: () => {
          clearInterval(interval);
          try {
            controller.close();
          } catch {
            /* */
          }
        },
      });
    },
    cancel() {
      const sub = subscribers.get(id);
      sub?.close();
      subscribers.delete(id);
    },
  });

  return { stream, id };
}

export function broadcastSse(event: ConsoleSseEvent): void {
  const stored = pushHistory({
    ...event,
    timestamp: event.timestamp ?? Date.now(),
  });
  const chunk = formatSse(stored, stored.id);
  for (const sub of subscribers.values()) {
    sub.enqueue(chunk);
  }
}

export function sseSubscriberCount(): number {
  return subscribers.size;
}

/** @internal test helper */
export function resetSseHubForTests(): void {
  subscribers.clear();
  eventHistory.length = 0;
  nextSubId = 0;
  nextEventId = 0;
}
