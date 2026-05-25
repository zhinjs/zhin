/**
 * 按 session 隔离的 Sandbox SSE 推送（Edge / Vercel 等无 WebSocket 入站时使用）。
 * SSE `data` 字段为与 WebSocket 相同的 JSON 字符串。
 */

type Subscriber = {
  id: string;
  enqueue: (chunk: string) => void;
  close: () => void;
};

type StoredEvent = { id: string; data: string };

type SessionState = {
  subscribers: Map<string, Subscriber>;
  history: StoredEvent[];
  nextSubId: number;
  nextEventId: number;
};

const MAX_REPLAY = 100;
const sessions = new Map<string, SessionState>();

function getSession(sessionId: string): SessionState {
  let s = sessions.get(sessionId);
  if (!s) {
    s = { subscribers: new Map(), history: [], nextSubId: 0, nextEventId: 0 };
    sessions.set(sessionId, s);
  }
  return s;
}

function formatSse(data: string, id?: string): string {
  const lines: string[] = [];
  if (id) lines.push(`id: ${id}`);
  lines.push(`data: ${data}`);
  lines.push("");
  return lines.join("\n") + "\n";
}

export function broadcastSandboxSse(sessionId: string, jsonPayload: string): void {
  const session = getSession(sessionId);
  const stored: StoredEvent = {
    id: String(++session.nextEventId),
    data: jsonPayload,
  };
  session.history.push(stored);
  if (session.history.length > MAX_REPLAY) session.history.shift();
  const chunk = formatSse(stored.data, stored.id);
  for (const sub of session.subscribers.values()) {
    sub.enqueue(chunk);
  }
}

export function subscribeSandboxSse(
  sessionId: string,
  lastEventId?: string,
): ReadableStream<Uint8Array> {
  const session = getSession(sessionId);
  const encoder = new TextEncoder();
  const replayFrom = lastEventId ? Number.parseInt(lastEventId, 10) : 0;
  const subId = `sse-${++session.nextSubId}`;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const ev of session.history) {
        if (Number(ev.id) > replayFrom) {
          controller.enqueue(encoder.encode(formatSse(ev.data, ev.id)));
        }
      }
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(interval);
        }
      }, 15000);
      session.subscribers.set(subId, {
        id: subId,
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
      const s = sessions.get(sessionId);
      const sub = s?.subscribers.get(subId);
      sub?.close();
      s?.subscribers.delete(subId);
    },
  });
}

export function closeSandboxSseSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  for (const sub of session.subscribers.values()) sub.close();
  session.subscribers.clear();
  sessions.delete(sessionId);
}

/** @internal */
export function resetSandboxSseHubForTests(): void {
  for (const id of [...sessions.keys()]) closeSandboxSseSession(id);
  sessions.clear();
}
