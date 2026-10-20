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
}

export interface SseClientHandle {
  readonly closed: Promise<void>;
  close(): void;
}

export function openSseStream(options: SseClientOptions): SseClientHandle {
  const controller = new AbortController();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  let settle!: () => void;
  const closed = new Promise<void>((resolve) => { settle = resolve; });

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
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = consumeSseBuffer(buffer, options.onMessage);
      }
      buffer += decoder.decode();
      consumeSseBuffer(`${buffer}\n\n`, options.onMessage);
    } catch (error) {
      if (!controller.signal.aborted) {
        const err = error instanceof Error ? error : new Error(String(error));
        options.onError?.(err);
      }
    } finally {
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

/** Exported for unit tests. */
export function consumeSseBuffer(
  buffer: string,
  onMessage: (data: string) => void,
): string {
  let rest = buffer;
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
