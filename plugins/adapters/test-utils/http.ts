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
