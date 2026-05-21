export type ConsoleSseEvent = {
  type: string;
  data?: unknown;
  timestamp?: number;
  requestId?: number;
  error?: string;
};

type Subscriber = {
  id: string;
  enqueue: (chunk: string) => void;
  close: () => void;
};

let subscribers = new Map<string, Subscriber>();
let nextId = 0;

export function subscribeSse(
  initial: ConsoleSseEvent[] = [],
): { stream: ReadableStream<Uint8Array>; id: string } {
  const id = `sse-${++nextId}`;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const ev of initial) {
        controller.enqueue(encoder.encode(formatSse(ev)));
      }
      if (initial.length === 0) {
        controller.enqueue(
          encoder.encode(formatSse({ type: "init-data", timestamp: Date.now() })),
        );
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

export function formatSse(event: ConsoleSseEvent): string {
  const payload = JSON.stringify(event);
  return `data: ${payload}\n\n`;
}

export function broadcastSse(event: ConsoleSseEvent): void {
  const chunk = formatSse({
    ...event,
    timestamp: event.timestamp ?? Date.now(),
  });
  for (const sub of subscribers.values()) {
    sub.enqueue(chunk);
  }
}

export function sseSubscriberCount(): number {
  return subscribers.size;
}
