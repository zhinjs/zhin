/** Web `Request` / `Response` helpers for adapter webhook tests. */

/** A webhook request with a body and headers (default `POST http://localhost/webhook`). */
export function webhookRequest(
  body: string | Uint8Array | undefined,
  headers: Record<string, string | undefined> = {},
  init: { readonly method?: string; readonly url?: string } = {},
): Request {
  const clean = Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const method = init.method ?? 'POST';
  return new Request(init.url ?? 'http://localhost/webhook', {
    method,
    headers: clean,
    ...(body !== undefined && method !== 'GET' && method !== 'HEAD' ? { body } : {}),
  });
}

/**
 * Replays a `Response` onto `writeHead` / `end` spies, so assertions written against the old
 * Node response shape (`writeHead(status, headers)`, `end(body)`) read the same.
 */
export async function recordResponse(response: Response): Promise<{
  readonly status: number;
  readonly headers: Headers;
  readonly body: string;
  readonly writeHead: ReturnType<typeof vi.fn>;
  readonly end: ReturnType<typeof vi.fn>;
}> {
  const body = await response.text();
  const writeHead = vi.fn();
  const end = vi.fn();
  writeHead(response.status, Object.fromEntries(response.headers));
  end(body);
  return { status: response.status, headers: response.headers, body, writeHead, end };
}

/**
 * `writeHead` / `end` spies that receive the handler's `Response` once it settles; while
 * the handler is still pending neither has been called.
 */
export function respondInto(pending: Promise<Response> | Response): {
  readonly writeHead: ReturnType<typeof vi.fn>;
  readonly end: ReturnType<typeof vi.fn>;
  readonly done: Promise<void>;
} {
  const writeHead = vi.fn();
  const end = vi.fn();
  const done = Promise.resolve(pending).then(async (response) => {
    const body = await response.text();
    writeHead(response.status, Object.fromEntries(response.headers));
    end(body);
  });
  return { writeHead, end, done };
}

interface MockSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off?(event: string, listener: (...args: unknown[]) => void): unknown;
}

/**
 * A Host `WsConnection` over an event-emitter socket double (`on('message' | 'close')`,
 * `send`, `close`) and the upgrade request it arrived with.
 */
export function wsConnectionFromMock(input: {
  readonly socket: MockSocket;
  readonly request: {
    readonly headers: Readonly<Record<string, string | undefined>>;
    readonly url?: string;
    readonly socket?: { readonly remoteAddress?: string };
  };
}): {
  readonly url: URL;
  readonly headers: Headers;
  readonly remoteAddress?: string;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onMessage(listener: (data: string | Uint8Array) => void): () => void;
  onClose(listener: (code: number, reason: string) => void): () => void;
  readonly bufferedAmount: number;
} {
  const { socket, request } = input;
  const subscribe = (event: string, listener: (...args: unknown[]) => void) => {
    socket.on(event, listener);
    return () => { socket.off?.(event, listener); };
  };
  return {
    url: new URL(request.url ?? '/', 'http://localhost'),
    headers: new Headers(Object.fromEntries(Object.entries(request.headers)
      .filter((entry): entry is [string, string] => entry[1] !== undefined))),
    ...(request.socket?.remoteAddress ? { remoteAddress: request.socket.remoteAddress } : {}),
    send: (data) => socket.send(typeof data === 'string' ? data : Buffer.from(data).toString('utf8')),
    close: (code, reason) => socket.close(code, reason),
    onMessage: (listener) => subscribe('message', (data) => listener(data as string)),
    onClose: (listener) => subscribe('close', (code, reason) => listener(Number(code ?? 1005), String(reason ?? ''))),
    bufferedAmount: 0,
  };
}
