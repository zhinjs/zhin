/**
 * Gateway events on the Console event stream (ADR 0054 §4): package transaction progress
 * (`gateway.packages.progress`) must reach the Console while the instance is stopped for the
 * transaction, so the gateway owns `GET {base}/events`:
 *
 * - instance ready: the instance's SSE stream is forwarded and gateway frames are spliced in
 *   between its frames (gateway frames carry no `id:`, so the resumable cursor stays the
 *   instance's); the stream ends with the instance's;
 * - instance offline: a gateway-only stream, closed as soon as the instance is ready again so the
 *   Console reconnects to the merged stream. `GET {base}/events/history` then answers an empty
 *   page that keeps the caller's cursor.
 *
 * `GET {base}/gateway/packages/progress` serves the progress frames alone.
 */
import type { ConsoleEventHistoryPage, GatewayPackageEvent } from '@zhin.js/console-protocol';
import { GATEWAY_PACKAGES_PROGRESS, GATEWAY_PACKAGES_PROGRESS_PATH } from '@zhin.js/console-protocol';
import { jsonResponse, type RouteContext } from '@zhin.js/host-http';
import type { GatewayHttpServer } from './gateway-http-server.js';

const KEEPALIVE_MS = 15_000;
/** Gateway frames held while an instance frame is half written. */
const MAX_PENDING_FRAMES = 1_024;
/** Chunks queued for a client that does not read; beyond it the stream ends (the client resumes). */
const MAX_QUEUED_CHUNKS = 4_096;
const SSE_HEADERS = Object.freeze({
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  'x-accel-buffering': 'no',
});

export interface GatewayEventSource {
  /** Package transaction events (`GatewayPackageService.subscribe`). */
  subscribe(listener: (event: GatewayPackageEvent) => void): () => void;
}

export interface GatewayInstanceReadiness {
  /** Called whenever the instance's route table changes (ready, reload, gone). */
  onChange(listener: () => void): () => void;
}

export interface RegisterGatewayEventRoutesOptions {
  readonly server: GatewayHttpServer;
  readonly packages?: GatewayEventSource;
  readonly instance?: GatewayInstanceReadiness;
  readonly keepAliveMs?: number;
}

export function gatewayEventFrame(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Registers the gateway's event routes; returns the unregister function. */
export function registerGatewayEventRoutes(options: RegisterGatewayEventRoutesOptions): () => void {
  const { server } = options;
  const base = server.apiBase;
  const keepAliveMs = options.keepAliveMs ?? KEEPALIVE_MS;
  const encoder = new TextEncoder();

  /** A client stream fed with gateway frames (plus, when merging, the instance's). */
  const open = (request: Request) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let finished = false;
    const cleanups: Array<() => void> = [];
    const finish = (): void => {
      if (finished) return;
      finished = true;
      for (const cleanup of cleanups.splice(0)) {
        try { cleanup(); } catch { /* keep closing */ }
      }
      try { controller.close(); } catch { /* already closed */ }
    };
    const stream = new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
      cancel() { finish(); },
    });
    const write = (text: string): void => {
      if (finished) return;
      try {
        if ((controller.desiredSize ?? 1) < -MAX_QUEUED_CHUNKS) {
          finish();
          return;
        }
        controller.enqueue(encoder.encode(text));
      } catch { finish(); }
    };
    request.signal.addEventListener('abort', finish, { once: true });
    const timer = setInterval(() => write(': keepalive\n\n'), keepAliveMs);
    timer.unref?.();
    cleanups.push(() => clearInterval(timer));
    return { stream, write, finish, cleanups, get finished() { return finished; } };
  };

  const subscribeProgress = (deliver: (frame: string) => void): (() => void) | undefined =>
    options.packages?.subscribe((event) => deliver(gatewayEventFrame(GATEWAY_PACKAGES_PROGRESS, event)));

  const events = async (request: Request, context: RouteContext): Promise<Response> => {
    if (!server.instanceReady) return offlineStream(request);
    const upstream = await server.forward(request, context);
    const type = upstream.headers.get('content-type') ?? '';
    // Errors (401 / 403 / 503 …) and non-SSE answers pass through unchanged.
    if (!upstream.ok || !upstream.body || !type.includes('text/event-stream')) {
      if (upstream.status === 503 && !server.instanceReady) {
        await upstream.body?.cancel().catch(() => undefined);
        return offlineStream(request);
      }
      return upstream;
    }
    const client = open(request);
    const reader = upstream.body.getReader();
    client.cleanups.push(() => { void reader.cancel().catch(() => undefined); });
    // Gateway frames wait while an instance frame is half written.
    const pending: string[] = [];
    let partial = '';
    const decoder = new TextDecoder();
    const flushPending = (): void => {
      for (const frame of pending.splice(0)) client.write(frame);
    };
    const stop = subscribeProgress((frame) => {
      if (partial) {
        if (pending.length < MAX_PENDING_FRAMES) pending.push(frame);
        return;
      }
      client.write(frame);
    });
    if (stop) client.cleanups.push(stop);
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done || client.finished) break;
          const text = decoder.decode(value, { stream: true });
          client.write(text);
          partial = trailingPartialFrame(partial + text);
          if (!partial) flushPending();
        }
      } catch { /* instance side ended */ }
      client.finish();
    })();
    const headers = new Headers(upstream.headers);
    headers.delete('content-length');
    return new Response(client.stream, { status: upstream.status, headers });
  };

  const offlineStream = (request: Request): Response => {
    const client = open(request);
    client.write(': gateway\n\n');
    const stop = subscribeProgress((frame) => client.write(frame));
    if (stop) client.cleanups.push(stop);
    // Reconnect to the merged stream once the instance is back.
    const unwatch = options.instance?.onChange(() => { if (server.instanceReady) client.finish(); });
    if (unwatch) client.cleanups.push(unwatch);
    return new Response(client.stream, { status: 200, headers: SSE_HEADERS });
  };

  const history = async (request: Request, context: RouteContext): Promise<Response> => {
    if (server.instanceReady) return server.forward(request, context);
    const runtimeId = context.url.searchParams.get('runtimeId') ?? 'gateway';
    const after = Number(context.url.searchParams.get('after') ?? 0);
    const cursor = Number.isSafeInteger(after) && after >= 0 ? after : 0;
    const page: ConsoleEventHistoryPage = Object.freeze({
      runtimeId,
      items: Object.freeze([]),
      oldestAvailableEventId: null,
      latestEventId: cursor,
      nextAfter: cursor,
      hasMore: false,
      gap: false,
    });
    return jsonResponse(200, { success: true, data: page }, { 'cache-control': 'no-store' });
  };

  const progress = (request: Request): Response => {
    const client = open(request);
    client.write(': gateway packages\n\n');
    const stop = subscribeProgress((frame) => client.write(frame));
    if (stop) client.cleanups.push(stop);
    return new Response(client.stream, { status: 200, headers: SSE_HEADERS });
  };

  const registrations = [
    server.route('GET', `${base}/events`, events, { summary: 'Console SSE stream (instance events merged with gateway events)', tags: ['console'] }),
    server.route('GET', `${base}/events/history`, history, { summary: 'Console event history (empty while the instance is offline)', tags: ['console'] }),
    server.route('GET', `${base}${GATEWAY_PACKAGES_PROGRESS_PATH}`, progress, { summary: 'Package transaction progress (SSE)', tags: ['gateway'] }),
  ];
  return () => { for (const unregister of registrations) unregister(); };
}

/** The text after the last complete SSE frame (empty when the buffer ends on a frame boundary). */
export function trailingPartialFrame(buffer: string): string {
  const normalized = buffer.replace(/\r\n/gu, '\n');
  const boundary = normalized.lastIndexOf('\n\n');
  return boundary < 0 ? normalized : normalized.slice(boundary + 2);
}
