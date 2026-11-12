/**
 * Node `http` / `ws` ↔ Web standard conversion (ADR 0054 §2). This module and the
 * server built on it are the only places in `@zhin.js/host-http` that load
 * `node:http` or `ws`; the gateway reuses them for its listener.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebSocket, type RawData } from 'ws';
import type { WsTransport } from '../http-host.js';

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

export interface NodeRequestOptions {
  /** Absolute request URL. */
  readonly url: URL;
  /** Aborted when the client goes away before the response finished. */
  readonly signal?: AbortSignal;
  /** Bytes buffered from the socket before reading pauses (default 64 KiB). */
  readonly highWaterMark?: number;
}

/** Headers of a Node request as a Web `Headers` (repeated headers preserved). */
export function nodeRequestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  const raw = request.rawHeaders;
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const name = raw[index]!;
    if (name.startsWith(':')) continue;
    try {
      headers.append(name, raw[index + 1]!);
    } catch { /* invalid for the Fetch API: skip */ }
  }
  return headers;
}

/**
 * A Web `Request` over a Node request. The body streams from the socket with
 * backpressure; cancelling it (or reading it to the end) never destroys the
 * socket, so the response can still be written on the same connection.
 */
export function createNodeRequest(request: IncomingMessage, options: NodeRequestOptions): Request {
  const method = (request.method ?? 'GET').toUpperCase();
  const body = BODYLESS_METHODS.has(method) ? null : nodeBodyStream(request, options.highWaterMark ?? 65_536);
  return new Request(options.url, {
    method,
    headers: nodeRequestHeaders(request),
    ...(body ? { body, duplex: 'half' } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  } as RequestInit);
}

function nodeBodyStream(request: IncomingMessage, highWaterMark: number): ReadableStream<Uint8Array> {
  let settled = false;
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      request.on('data', (chunk: Buffer | string) => {
        if (cancelled) return;
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        controller.enqueue(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        if ((controller.desiredSize ?? 0) <= 0) request.pause();
      });
      request.once('end', () => {
        if (settled) return;
        settled = true;
        if (!cancelled) controller.close();
      });
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        if (!cancelled) controller.error(error);
      };
      request.once('error', fail);
      request.once('close', () => {
        if (!request.complete) fail(new Error('Request aborted'));
      });
      request.pause();
    },
    pull() {
      request.resume();
    },
    cancel() {
      // Discard the rest instead of destroying the socket.
      cancelled = true;
      request.resume();
    },
  }, new ByteLengthQueuingStrategy({ highWaterMark }));
}

/**
 * Writes a Web `Response` to a Node response: status, headers (`set-cookie`
 * kept separate) and the body, honouring `drain` backpressure. A body that is
 * immediately complete is sent with `Content-Length`; otherwise headers are
 * flushed at once (SSE) and the body is chunked. A body stream error destroys
 * the connection; a client disconnect cancels the body.
 */
export async function writeNodeResponse(target: ServerResponse, response: Response): Promise<void> {
  target.statusCode = response.status;
  if (response.statusText) target.statusMessage = response.statusText;
  const cookies = response.headers.getSetCookie();
  for (const [name, value] of response.headers) {
    if (name === 'set-cookie') continue;
    target.setHeader(name, value);
  }
  if (cookies.length > 0) target.setHeader('set-cookie', cookies);
  const body = response.body;
  if (!body) {
    target.end();
    return;
  }
  const reader = body.getReader();
  let disconnected = false;
  let cancelled: Promise<void> | undefined;
  const onClose = (): void => {
    if (target.writableFinished) return;
    disconnected = true;
    cancelled = reader.cancel(new Error('Client disconnected')).catch(() => undefined);
  };
  target.once('close', onClose);
  try {
    let read = reader.read();
    let first = await raceImmediate(read);
    if (first === PENDING) {
      // Nothing to send yet (SSE): commit the headers now.
      target.flushHeaders();
      first = await read;
    }
    if (first.done) {
      target.end();
      return;
    }
    let chunk: Uint8Array = first.value;
    read = reader.read();
    const second = await raceImmediate(read);
    if (second !== PENDING && second.done) {
      target.end(chunk);
      return;
    }
    for (;;) {
      if (disconnected || target.destroyed) return;
      if (!target.write(chunk)) await waitForDrain(target);
      if (disconnected || target.destroyed) return;
      const next = await read;
      if (next.done) break;
      chunk = next.value;
      read = reader.read();
    }
    if (!target.destroyed) target.end();
  } catch (error) {
    if (!disconnected && !target.destroyed) target.destroy(error instanceof Error ? error : new Error(String(error)));
  } finally {
    target.off('close', onClose);
    // A disconnect cancels the body: let its source finish cleaning up first.
    await cancelled;
    try { reader.releaseLock(); } catch { /* read still pending after disconnect */ }
  }
}

const PENDING = Symbol('pending');

/** Settles with the promise's value if it is ready before the next macrotask, else PENDING. */
function raceImmediate<T>(promise: Promise<T>): Promise<T | typeof PENDING> {
  return new Promise((resolve, reject) => {
    const timer = setImmediate(() => resolve(PENDING));
    promise.then((value) => {
      clearImmediate(timer);
      resolve(value);
    }, (error: unknown) => {
      clearImmediate(timer);
      reject(error);
    });
  });
}

function waitForDrain(target: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      target.off('drain', done);
      target.off('close', done);
      resolve();
    };
    target.once('drain', done);
    target.once('close', done);
  });
}

export interface NodeWebSocketOptions {
  /** Protocol ping interval; a peer that misses one pong is terminated. 0 disables. Default 30 s. */
  readonly keepAliveMs?: number;
}

/** A {@link WsTransport} over a `ws` server socket. */
export function wrapNodeWebSocket(socket: WebSocket, options: NodeWebSocketOptions = {}): WsTransport {
  const messageListeners = new Set<(data: string | Uint8Array) => void>();
  const closeListeners = new Set<(code: number, reason: string) => void>();
  let closedWith: { code: number; reason: string } | undefined;
  socket.on('message', (data: RawData, isBinary: boolean) => {
    const value = isBinary ? rawBytes(data) : rawBytes(data).toString('utf8');
    for (const listener of [...messageListeners]) {
      try { listener(value); } catch { /* isolate listener failures */ }
    }
  });
  socket.on('error', () => { /* followed by close */ });
  let alive = true;
  const keepAliveMs = options.keepAliveMs ?? 30_000;
  const timer = keepAliveMs > 0
    ? setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      try { socket.ping(); } catch { /* closing */ }
    }, keepAliveMs)
    : undefined;
  timer?.unref?.();
  socket.on('pong', () => { alive = true; });
  socket.once('close', (code: number, reason: Buffer) => {
    if (timer) clearInterval(timer);
    closedWith = { code, reason: reason.toString('utf8') };
    messageListeners.clear();
    for (const listener of [...closeListeners]) {
      try { listener(closedWith.code, closedWith.reason); } catch { /* isolate listener failures */ }
    }
    closeListeners.clear();
  });
  return {
    send(data) {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(data);
    },
    close(code, reason) {
      if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) return;
      try {
        socket.close(code, reason);
      } catch {
        socket.terminate();
      }
    },
    onMessage(listener) {
      if (closedWith) return () => undefined;
      messageListeners.add(listener);
      return () => { messageListeners.delete(listener); };
    },
    onClose(listener) {
      if (closedWith) {
        const { code, reason } = closedWith;
        queueMicrotask(() => listener(code, reason));
        return () => undefined;
      }
      closeListeners.add(listener);
      return () => { closeListeners.delete(listener); };
    },
    get bufferedAmount() {
      return socket.bufferedAmount;
    },
  };
}

function rawBytes(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
