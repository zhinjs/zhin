/**
 * Transport-independent HTTP route contract shared by Zhin hosts (ADR 0054 §2).
 *
 * Routes receive a Web standard `Request` and return a `Response`; the Host that
 * owns the listener converts from and to its transport (Node `http`, a process
 * bridge, …). Nothing here imports `node:http` or `ws`.
 */

/**
 * The narrow route metadata that protocol hosts may contribute to the HTTP
 * OpenAPI catalog. Keep this data-only so the contract remains independent
 * from the concrete HTTP host implementation.
 */
export interface HttpRouteParameter {
  readonly name: string;
  readonly in: 'query' | 'path' | 'header';
  readonly required?: boolean;
  readonly description?: string;
  readonly schema?: Record<string, unknown>;
}

export interface HttpRouteMeta {
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly operationId?: string;
  readonly deprecated?: boolean;
  readonly parameters?: readonly HttpRouteParameter[];
  readonly responses?: Record<string, unknown>;
  readonly requestBody?: Record<string, unknown>;
}

/** Per-request data the Host resolved before dispatch. */
export interface HttpRouteContext {
  /** Parsed request URL (path and query as received). */
  readonly url: URL;
  /** Path parameters; prefix routes (`/x/*`) expose the remainder as `params['*']`. */
  readonly params: Readonly<Record<string, string>>;
  /** Principal the Host authenticated; its shape belongs to the Host. */
  readonly principal?: unknown;
  readonly remoteAddress?: string;
}

/** A protocol route does not need to know how the Host represents auth or transport. */
export type HttpRouteHandler = (
  request: Request,
  context: HttpRouteContext,
) => Response | Promise<Response>;

export type HttpRouteRegistration = () => void;

/**
 * Minimal inbound HTTP capability consumed by protocol hosts such as MCP and
 * A2A. The concrete Host may expose richer APIs, but those stay out of the
 * protocol packages' public declarations.
 */
export interface HttpRouteHost {
  route(
    method: string,
    path: string,
    handler: HttpRouteHandler,
    meta?: HttpRouteMeta,
  ): HttpRouteRegistration;
}

/** A serializable request-body failure suitable for an HTTP response. */
export class HttpBodyError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'HttpBodyError';
  }
}

export interface HttpBodyReadOptions {
  /** Maximum body size in bytes (default 1 MiB). */
  readonly limit?: number;
}

const DEFAULT_BODY_LIMIT = 1_048_576;

/**
 * Read a request body into memory with a size limit (default 1 MiB). An oversize
 * body is still read to its end before `HttpBodyError(413)` is thrown, so the
 * transport can answer on the same keep-alive connection.
 */
export async function readBodyBytes(
  request: Request,
  options: HttpBodyReadOptions = {},
): Promise<Uint8Array> {
  const limit = options.limit ?? DEFAULT_BODY_LIMIT;
  const body = request.body;
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let exceeded = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (exceeded || !value) continue;
      size += value.byteLength;
      if (size > limit) {
        exceeded = true;
        chunks.length = 0;
        continue;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (exceeded) throw new HttpBodyError(`Request body exceeds ${limit} bytes`, 413);
  if (chunks.length === 1) return chunks[0]!;
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Read a request body as UTF-8 text with a size limit (default 1 MiB).
 * The text is returned verbatim (no trimming) so callers can verify webhook
 * signatures over it. Oversize requests are fully drained before reporting
 * 413, exactly like `readJsonBody()`.
 */
export async function readTextBody(
  request: Request,
  options: HttpBodyReadOptions = {},
): Promise<string> {
  return new TextDecoder().decode(await readBodyBytes(request, options));
}

/**
 * Read and parse a JSON request body with a size limit (default 1 MiB).
 * Empty bodies become `undefined`. Oversize requests are fully drained before
 * reporting 413 so callers can still respond on the same socket.
 */
export async function readJsonBody<T = unknown>(
  request: Request,
  options: HttpBodyReadOptions = {},
): Promise<T | undefined> {
  const raw = (await readTextBody(request, options)).trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpBodyError('Invalid JSON body', 400);
  }
}

/** `application/json; charset=utf-8` response (the Host's error-shape content type). */
export function jsonResponse(
  status: number,
  body: unknown,
  headers?: HeadersInit,
): Response {
  const merged = new Headers(headers);
  if (!merged.has('content-type')) merged.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers: merged });
}

/** Empty-body response with a status (and optional headers). */
export function emptyResponse(status: number, headers?: HeadersInit): Response {
  return new Response(null, { status, ...(headers ? { headers } : {}) });
}

export interface HttpResponseStreamOptions {
  /** Bytes queued before `write()` reports backpressure (default 16 KiB). */
  readonly highWaterMark?: number;
}

/**
 * Producer side of a streaming response body (SSE, large downloads). Use
 * `stream` as the `Response` body. `write()` returns false once the queue is
 * full; wait for `onDrain` before writing more. When the consumer goes away
 * (client disconnect) `signal` aborts and `onClose` listeners run.
 */
export interface HttpResponseStream {
  readonly stream: ReadableStream<Uint8Array>;
  readonly signal: AbortSignal;
  /** True after `close()`, `error()` or consumer cancellation. */
  readonly closed: boolean;
  /** Queue a chunk; false means the consumer is applying backpressure. */
  write(chunk: string | Uint8Array): boolean;
  /** Runs whenever the consumer asks for more data after backpressure. */
  onDrain(listener: () => void): () => void;
  /** Runs once when the stream ends for any reason. */
  onClose(listener: () => void): () => void;
  close(): void;
  /** Ends the response abnormally: the transport drops the connection. */
  error(reason?: unknown): void;
}

export function createResponseStream(
  options: HttpResponseStreamOptions = {},
): HttpResponseStream {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const drainListeners = new Set<() => void>();
  const closeListeners = new Set<() => void>();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;

  const finish = (): void => {
    if (closed) return;
    closed = true;
    drainListeners.clear();
    if (!abort.signal.aborted) abort.abort();
    for (const listener of [...closeListeners]) {
      try { listener(); } catch { /* isolate listener failures */ }
    }
    closeListeners.clear();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    pull() {
      for (const listener of [...drainListeners]) {
        try { listener(); } catch { /* isolate listener failures */ }
      }
    },
    cancel() {
      finish();
    },
  }, new ByteLengthQueuingStrategy({ highWaterMark: options.highWaterMark ?? 16_384 }));

  return {
    stream,
    signal: abort.signal,
    get closed() { return closed; },
    write(chunk) {
      if (closed) return false;
      controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      return (controller.desiredSize ?? 0) > 0;
    },
    onDrain(listener) {
      if (closed) return () => undefined;
      drainListeners.add(listener);
      return () => { drainListeners.delete(listener); };
    },
    onClose(listener) {
      if (closed) {
        listener();
        return () => undefined;
      }
      closeListeners.add(listener);
      return () => { closeListeners.delete(listener); };
    },
    close() {
      if (closed) return;
      try { controller.close(); } catch { /* already closed */ }
      finish();
    },
    error(reason) {
      if (closed) return;
      try { controller.error(reason ?? new Error('Response stream aborted')); } catch { /* already closed */ }
      finish();
    },
  };
}

/** Headers every Server-Sent Events response sends. */
export const SSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
});
