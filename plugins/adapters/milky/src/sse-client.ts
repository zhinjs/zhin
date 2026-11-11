/**
 * Minimal fetch-based SSE client (no EventSource dependency).
 * Parses `text/event-stream` frames and invokes onMessage for each `data:` payload.
 */
export interface SseClientOptions {
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly fetch?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
  readonly onMessage: (data: string) => void;
  readonly onError?: (error: Error) => void;
  readonly onOpen?: () => void;
  /** Abort and report an error when no bytes arrive for this long (default 5 min; 0 disables). */
  readonly idleTimeoutMs?: number;
  /** Abort and report an error when an unterminated frame grows past this many characters (default 8 Mi). */
  readonly maxBufferLength?: number;
}

export const SSE_DEFAULT_IDLE_TIMEOUT_MS = 300_000;
export const SSE_DEFAULT_MAX_BUFFER_LENGTH = 8 * 1024 * 1024;

export interface SseClientHandle {
  readonly closed: Promise<void>;
  close(): void;
}

export function openSseStream(options: SseClientOptions): SseClientHandle {
  const controller = new AbortController();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  let settle!: () => void;
  const closed = new Promise<void>((resolve) => { settle = resolve; });

  const idleTimeoutMs = options.idleTimeoutMs ?? SSE_DEFAULT_IDLE_TIMEOUT_MS;
  const maxBufferLength = options.maxBufferLength ?? SSE_DEFAULT_MAX_BUFFER_LENGTH;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  // Set before aborting our own controller so the abort is still reported as an error.
  let failure: Error | undefined;
  const armIdleTimer = (): void => {
    if (idleTimeoutMs <= 0) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      failure = new Error(`SSE idle for ${idleTimeoutMs}ms`);
      controller.abort();
    }, idleTimeoutMs);
  };

  const run = async (): Promise<void> => {
    try {
      const response = await fetchImpl(options.url, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...(options.headers ?? {}),
        },
        signal: anySignal([controller.signal, options.signal]),
      });
      if (!response.ok) {
        throw new Error(`SSE HTTP ${response.status}`);
      }
      if (!response.body) {
        throw new Error('SSE response has no body');
      }
      options.onOpen?.();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      armIdleTimer();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armIdleTimer();
        buffer += decoder.decode(value, { stream: true });
        buffer = consumeSseBuffer(buffer, options.onMessage);
        if (buffer.length > maxBufferLength) {
          throw new Error(`SSE frame exceeds ${maxBufferLength} characters`);
        }
      }
      buffer += decoder.decode();
      consumeSseBuffer(`${buffer}\n\n`, options.onMessage);
    } catch (error) {
      if (failure) {
        options.onError?.(failure);
      } else if (!controller.signal.aborted) {
        const err = error instanceof Error ? error : new Error(String(error));
        options.onError?.(err);
      }
    } finally {
      clearTimeout(idleTimer);
      // Release the connection after an oversize frame; a no-op when already closed.
      controller.abort();
      settle();
    }
  };

  void run();

  return {
    closed,
    close() {
      controller.abort();
    },
  };
}

/**
 * Normalize CRLF / lone CR line endings to LF (all three are valid in
 * `text/event-stream`). A trailing CR is kept: it may be half of a CRLF split
 * across chunks.
 */
function normalizeSseNewlines(buffer: string): string {
  if (!buffer.includes('\r')) return buffer;
  const tail = buffer.endsWith('\r') ? '\r' : '';
  const body = tail ? buffer.slice(0, -1) : buffer;
  return body.replace(/\r\n?/g, '\n') + tail;
}

/** Exported for unit tests. */
export function consumeSseBuffer(
  buffer: string,
  onMessage: (data: string) => void,
): string {
  let rest = normalizeSseNewlines(buffer);
  while (true) {
    const sep = rest.indexOf('\n\n');
    if (sep < 0) return rest;
    const frame = rest.slice(0, sep);
    rest = rest.slice(sep + 2);
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (dataLines.length > 0) onMessage(dataLines.join('\n'));
  }
}

function anySignal(signals: Array<AbortSignal | undefined>): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
