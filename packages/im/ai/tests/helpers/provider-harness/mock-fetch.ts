/**
 * Mocked HTTP endpoint for provider tests: a `fetch` that records every request
 * and answers from a queue of responders (or persistent routes).
 *
 * Only the network edge is fake. The real `@ai-sdk/*` provider builds the
 * request and parses the response, so tests exercise the exact wire format.
 */

/** One request as the provider SDK sent it. Header names are lower-cased. */
export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  /** `URL.pathname`, e.g. `/v1/chat/completions`. */
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  /** Parsed JSON body (`undefined` for GET / non-JSON bodies). */
  readonly body: any;
  readonly rawBody?: string;
  /** True when the SDK asked for a streamed answer (`stream: true`, `alt=sse`, `:streamGenerateContent`). */
  readonly stream: boolean;
  readonly signal?: AbortSignal;
}

/** One server-sent event. `data` is JSON-encoded unless it is a string (e.g. `'[DONE]'`). */
export interface SseEvent {
  readonly event?: string;
  readonly data: unknown;
}

/**
 * A literal HTTP response. Exactly one of `json`, `sse`, `text` is normally set.
 *
 * `hang` simulates a stuck server for timeout tests:
 * - `'before-headers'`: the response never arrives;
 * - `'after-events'`: headers and the `sse` events are sent, then the stream stalls.
 * Either way the request ends when the caller's `AbortSignal` fires, with its reason.
 */
export interface MockResponse {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly json?: unknown;
  readonly sse?: readonly SseEvent[];
  readonly text?: string;
  readonly hang?: 'before-headers' | 'after-events';
}

/**
 * A protocol-aware reply that serves both transports: `stream` for streamed
 * requests (the agent path, `streamText`) and `json` for non-streamed ones
 * (`generateText`, e.g. `SdkProviderAdapter.completeText`). Built by the
 * protocol helpers in `protocols.ts`.
 */
export interface ProtocolReply {
  readonly kind: 'protocol';
  readonly stream: (request: RecordedRequest) => MockResponse;
  readonly json: (request: RecordedRequest) => MockResponse;
}

export type Responder =
  | MockResponse
  | ProtocolReply
  | ((request: RecordedRequest) => MockResponse | ProtocolReply | Promise<MockResponse | ProtocolReply>);

export interface MockFetch {
  readonly fetch: typeof globalThis.fetch;
  /** Every request in order, including routed ones. */
  readonly requests: RecordedRequest[];
  /** Queue responders; each request consumes the next one. */
  enqueue(...responders: Responder[]): MockFetch;
  /** A persistent responder for matching requests (checked before the queue), e.g. model discovery. */
  route(match: (request: RecordedRequest) => boolean, responder: Responder): MockFetch;
  /** Requests whose path ends with `suffix` (e.g. `'/chat/completions'`). */
  requestsTo(suffix: string): RecordedRequest[];
}

const STREAM_URL = /:streamGenerateContent|[?&]alt=sse/;

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  new Headers(headers).forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export function serializeSse(events: readonly SseEvent[]): string {
  return events
    .map((e) => `${e.event ? `event: ${e.event}\n` : ''}data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`)
    .join('');
}

function abortError(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function toResponse(mock: MockResponse, signal: AbortSignal | undefined): Promise<Response> | Response {
  const status = mock.status ?? 200;
  if (mock.hang === 'before-headers') {
    return new Promise<Response>((_resolve, reject) => {
      if (signal?.aborted) return reject(abortError(signal));
      signal?.addEventListener('abort', () => reject(abortError(signal)), { once: true });
    });
  }
  if (mock.sse) {
    const payload = new TextEncoder().encode(serializeSse(mock.sse));
    const hang = mock.hang === 'after-events';
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload);
        if (!hang) {
          controller.close();
          return;
        }
        const onAbort = () => controller.error(abortError(signal));
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      },
    });
    return new Response(body, { status, headers: { 'content-type': 'text/event-stream', ...mock.headers } });
  }
  if (mock.json !== undefined) {
    return new Response(JSON.stringify(mock.json), { status, headers: { 'content-type': 'application/json', ...mock.headers } });
  }
  return new Response(mock.text ?? '', { status, headers: { ...mock.headers } });
}

function isProtocolReply(value: unknown): value is ProtocolReply {
  return !!value && typeof value === 'object' && (value as ProtocolReply).kind === 'protocol';
}

/** Create a recording `fetch` that answers from `responders` in order. */
export function createMockFetch(responders: readonly Responder[] = []): MockFetch {
  const queue: Responder[] = [...responders];
  const routes: Array<{ match: (request: RecordedRequest) => boolean; responder: Responder }> = [];
  const requests: RecordedRequest[] = [];

  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const rawBody = typeof init?.body === 'string' ? init.body : undefined;
    let body: unknown;
    if (rawBody !== undefined) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = undefined;
      }
    }
    const request: RecordedRequest = {
      method: (init?.method ?? 'GET').toUpperCase(),
      url,
      path: new URL(url).pathname,
      headers: headersToRecord(init?.headers),
      body,
      ...(rawBody !== undefined ? { rawBody } : {}),
      stream: (body as { stream?: unknown } | undefined)?.stream === true || STREAM_URL.test(url),
      ...(init?.signal ? { signal: init.signal } : {}),
    };
    requests.push(request);

    const route = routes.find((r) => r.match(request));
    const responder = route ? route.responder : queue.shift();
    if (!responder) {
      throw new Error(`provider-harness: no mocked response queued for ${request.method} ${url}`);
    }
    let resolved = typeof responder === 'function' ? await responder(request) : responder;
    if (isProtocolReply(resolved)) resolved = request.stream ? resolved.stream(request) : resolved.json(request);
    return toResponse(resolved, init?.signal ?? undefined);
  }) as typeof globalThis.fetch;

  const api: MockFetch = {
    fetch,
    requests,
    enqueue(...more) {
      queue.push(...more);
      return api;
    },
    route(match, responder) {
      routes.push({ match, responder });
      return api;
    },
    requestsTo(suffix) {
      return requests.filter((r) => r.path.endsWith(suffix));
    },
  };
  return api;
}
