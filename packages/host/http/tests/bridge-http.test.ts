import { describe, expect, it } from 'vitest';
import { createResponseStream, jsonResponse, SSE_HEADERS } from '@zhin.js/host-http-contract';
import type { ConsolePrincipal, WsConnection } from '../src/index.js';
import {
  BridgeProtocolMismatchError,
  createBridgedHttpHost,
  DEFAULT_BRIDGE_LIMITS,
  EMPTY_ROUTE_TABLE,
  INSTANCE_BRIDGE_PROTOCOL_VERSION,
  INSTANCE_CHILD_ENV,
  InstanceTransportError,
  IpcInstanceTransport,
  openInstanceControlChannel,
  parseGatewayMessage,
  parseInstanceMessage,
  type BridgeChannel,
  type BridgeRouteTable,
  type GatewayToInstanceMessage,
  type InstanceIpcPort,
  type InstanceToGatewayMessage,
} from '../src/bridge/index.js';

const WINDOW = DEFAULT_BRIDGE_LIMITS.initialCreditBytes;
const CHUNK = DEFAULT_BRIDGE_LIMITS.maxChunkBytes;

/**
 * Delivers like Node IPC with `serialization: 'advanced'`: structured clone, asynchronously, in
 * order, and — like one socket read — everything queued in a tick is dispatched in one batch.
 */
function batched(deliver: (message: unknown) => void): (message: unknown) => void {
  const queue: unknown[] = [];
  return (message) => {
    queue.push(structuredClone(message));
    if (queue.length > 1) return;
    setImmediate(() => { for (const next of queue.splice(0)) deliver(next); });
  };
}

function link(options: { responseTimeoutMs?: number; wsOpenTimeoutMs?: number } = {}) {
  const toInstance: GatewayToInstanceMessage[] = [];
  const toGateway: InstanceToGatewayMessage[] = [];
  /** Both directions in send order. */
  const all: { type: string; payload: unknown }[] = [];
  const messageListeners = new Set<(message: GatewayToInstanceMessage) => void>();
  const disconnectListeners = new Set<() => void>();
  const transport = new IpcInstanceTransport(options);
  let connected = true;
  const toTransport = batched((copy) => { if (connected) transport.receive(copy); });
  const toHost = batched((copy) => {
    if (!connected) return;
    const parsed = parseGatewayMessage(copy);
    if (!parsed) throw new Error('gateway sent an invalid message');
    for (const listener of [...messageListeners]) listener(parsed);
  });
  const channel: BridgeChannel = {
    send(message) {
      if (!connected) return;
      toGateway.push(message);
      all.push(message);
      toTransport(message);
    },
    onMessage(listener) {
      messageListeners.add(listener);
      return () => { messageListeners.delete(listener); };
    },
    onDisconnect(listener) {
      disconnectListeners.add(listener);
      return () => { disconnectListeners.delete(listener); };
    },
  };
  transport.attach({
    send(message) {
      if (!connected) return;
      toInstance.push(message);
      all.push(message);
      toHost(message);
    },
  });
  return {
    transport,
    channel,
    toInstance,
    toGateway,
    all,
    /** Raw gateway → instance message, bypassing the transport (protocol violation tests). */
    inject(message: unknown) {
      const parsed = parseGatewayMessage(message);
      if (parsed) for (const listener of [...messageListeners]) listener(parsed);
      return parsed;
    },
    disconnect() {
      connected = false;
      transport.detach('Instance exited');
      for (const listener of [...disconnectListeners]) listener();
    },
  };
}

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(check: () => boolean, label: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await tick(2);
  }
}

async function started(options: Parameters<typeof link>[0] = {}) {
  const wire = link(options);
  const host = createBridgedHttpHost({ channel: wire.channel });
  return { ...wire, host };
}

async function opened(context: Awaited<ReturnType<typeof started>>) {
  await context.host.listen();
  await until(() => context.transport.ready, 'route table');
}

/** Bytes in flight on one stream direction: body bytes sent minus credit granted. */
function maxInFlight(messages: readonly { type: string; id?: string; payload: unknown }[], bodyType: string, creditType: string): number {
  let inFlight = 0;
  let max = 0;
  for (const message of messages) {
    if (message.type === bodyType) inFlight += (message.payload as { chunk: Uint8Array }).chunk.byteLength;
    if (message.type === creditType) inFlight -= (message.payload as { bytes: number }).bytes;
    max = Math.max(max, inFlight);
  }
  return max;
}

function pattern(size: number, seed = 7): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (index * 31 + seed) & 0xff;
  return bytes;
}

async function readAll(stream: ReadableStream<Uint8Array>, delayMs = 0): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    parts.push(next.value);
    size += next.value.byteLength;
    if (delayMs) await tick(delayMs);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.byteLength; }
  return out;
}

function lazyBody(total: number, produced: { bytes: number; cancelled?: unknown }): ReadableStream<Uint8Array> {
  const source = pattern(total);
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced.bytes >= total) {
        controller.close();
        return;
      }
      const size = Math.min(100_000, total - produced.bytes);
      controller.enqueue(source.slice(produced.bytes, produced.bytes + size));
      produced.bytes += size;
    },
    cancel(reason) { produced.cancelled = reason ?? true; },
  }, { highWaterMark: 0 });
}

const user = (permissions: readonly string[]): ConsolePrincipal => Object.freeze({
  kind: 'user',
  userId: 'u1',
  username: 'alice',
  displayName: 'Alice',
  credentialId: 'session-1',
  roles: ['viewer'],
  grants: [{ role: 'viewer', scope: { kind: 'global' }, permissions }],
});

class FakePeer implements WsConnection {
  readonly url = new URL('http://gateway/ws');
  readonly headers = new Headers();
  readonly sent: (string | Uint8Array)[] = [];
  closed?: { code?: number; reason?: string };
  bufferedAmount = 0;
  readonly #message = new Set<(data: string | Uint8Array) => void>();
  readonly #close = new Set<(code: number, reason: string) => void>();
  send(data: string | Uint8Array): void { this.sent.push(data); }
  close(code?: number, reason?: string): void {
    if (this.closed) return;
    this.closed = { code, reason };
    for (const listener of [...this.#close]) listener(code ?? 1005, reason ?? '');
  }
  onMessage(listener: (data: string | Uint8Array) => void) { this.#message.add(listener); return () => { this.#message.delete(listener); }; }
  onClose(listener: (code: number, reason: string) => void) { this.#close.add(listener); return () => { this.#close.delete(listener); }; }
  /** The browser sent a frame. */
  receive(data: string | Uint8Array): void { for (const listener of [...this.#message]) listener(data); }
  /** The browser closed. */
  clientClose(code: number, reason = ''): void {
    this.closed = { code, reason };
    for (const listener of [...this.#close]) listener(code, reason);
  }
}

describe('bridge route table', () => {
  it('announces routes on listen, updates on registration changes and generation commits', async () => {
    const context = await started();
    const tables: BridgeRouteTable[] = [];
    context.transport.onRoutes((table) => tables.push(table));
    context.host.route('GET', '/hello', () => new Response('hi'), { summary: 'Hello' });
    context.host.ws('/adapter/reverse', { auth: 'protocol' }).onConnection(() => undefined);
    expect(context.transport.ready).toBe(false);
    await opened(context);
    const first = context.transport.routes();
    expect(first.apiBase).toBe('/api');
    expect(first.http).toContainEqual({ method: 'GET', pattern: '/hello', meta: { summary: 'Hello' } });
    expect(first.ws).toEqual([{ path: '/adapter/reverse', auth: 'protocol' }]);

    // Hot reload: a new generation registers, the old one disposes.
    const dispose = context.host.route('POST', '/plugin/hook/*', () => new Response(null, { status: 204 }));
    await until(() => context.transport.routes().http.some((route) => route.pattern === '/plugin/hook/*'), 'added route');
    dispose();
    await until(() => !context.transport.routes().http.some((route) => route.pattern === '/plugin/hook/*'), 'removed route');
    context.host.publishRoutes(7);
    await until(() => context.transport.routes().generation === 7, 'generation');
    const revisions = tables.map((table) => table.revision);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    expect(new Set(revisions).size).toBe(revisions.length);

    // A registration burst coalesces into one table.
    const before = context.toGateway.filter((message) => message.type === 'routes').length;
    for (let index = 0; index < 20; index += 1) context.host.route('GET', `/burst/${index}`, () => new Response(null));
    await until(() => context.transport.routes().http.some((route) => route.pattern === '/burst/19'), 'burst');
    expect(context.toGateway.filter((message) => message.type === 'routes').length).toBe(before + 1);

    // Withdrawn on close; offline on exit.
    await context.host.close();
    await until(() => context.transport.routes().http.length === 0, 'withdrawn table');
    context.disconnect();
    expect(context.transport.ready).toBe(false);
    expect(tables.at(-1)).toBe(EMPTY_ROUTE_TABLE);
  });

  it('carries the route table in ready and rejects an incompatible instance', async () => {
    const transport = new IpcInstanceTransport();
    transport.attach({ send: () => undefined });
    const table: BridgeRouteTable = { revision: 1, apiBase: '/api', http: [{ method: 'GET', pattern: '/x' }], ws: [] };
    transport.receive({ type: 'ready', payload: { version: 1, pid: 3, routes: table } });
    expect(transport.ready).toBe(false);
    await expect(transport.fetch(new Request('http://gateway/x'))).rejects.toMatchObject({ code: 'instance-offline' });
    transport.attach({ send: () => undefined });
    transport.receive({ type: 'ready', payload: { version: INSTANCE_BRIDGE_PROTOCOL_VERSION, pid: 4, routes: table } });
    expect(transport.ready).toBe(true);
    expect(transport.routes().http).toEqual([{ method: 'GET', pattern: '/x' }]);
  });
});

describe('bridge HTTP', () => {
  it('round-trips method, URL, headers (repeated set-cookie), status and body', async () => {
    const context = await started();
    context.host.route('PUT', '/echo', async (request, routeContext) => {
      const headers = new Headers({ 'x-method': request.method, 'x-query': routeContext.url.searchParams.get('q') ?? '' });
      headers.append('set-cookie', 'a=1');
      headers.append('set-cookie', 'b=2');
      return new Response(await request.text(), { status: 201, statusText: 'Made', headers });
    });
    await opened(context);
    const response = await context.transport.fetch(new Request('http://gateway.local/echo?q=1', {
      method: 'PUT', body: 'payload', headers: { 'x-custom': 'yes' },
    }), { remoteAddress: '10.0.0.1' });
    expect(response.status).toBe(201);
    expect(response.statusText).toBe('Made');
    expect(response.headers.get('x-method')).toBe('PUT');
    expect(response.headers.get('x-query')).toBe('1');
    expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe('payload');
    const request = context.toInstance.find((message) => message.type === 'http.request');
    expect(request?.payload).toMatchObject({ method: 'PUT', url: 'http://gateway.local/echo?q=1', body: true, remoteAddress: '10.0.0.1' });
    expect(context.host.activeStreams).toBe(0);
    expect(context.transport.activeStreams).toBe(0);
    await context.host.close();
  });

  it('streams a large request body in bounded chunks with credit-based backpressure', async () => {
    const context = await started();
    const total = 2 * 1024 * 1024 + 123;
    let received: Uint8Array | undefined;
    context.host.route('POST', '/upload', async (request) => {
      // Slow consumer: the gateway must wait for credit instead of flooding the channel.
      received = await readAll(request.body!, 1);
      return jsonResponse(200, { size: received.byteLength });
    });
    await opened(context);
    const body = pattern(total);
    const response = await context.transport.fetch(new Request('http://gateway/upload', {
      method: 'POST', body: new Blob([body]).stream(), duplex: 'half',
    } as RequestInit));
    expect(await response.json()).toEqual({ size: total });
    // Byte comparison: a deep toEqual over megabytes is needlessly slow.
    expect(Buffer.from(received!).equals(Buffer.from(body))).toBe(true);
    const chunks = context.toInstance.filter((message) => message.type === 'http.request.body');
    expect(chunks.length).toBeGreaterThanOrEqual(Math.ceil(total / CHUNK));
    for (const chunk of chunks) {
      const bytes = (chunk.payload as { chunk: Uint8Array }).chunk;
      expect(bytes.byteLength).toBeLessThanOrEqual(CHUNK);
      expect(bytes.byteOffset).toBe(0);
      expect(bytes.buffer.byteLength).toBe(bytes.byteLength);
    }
    // Credit is granted only after the instance consumed; the gateway never had more than the
    // window in flight (the instance would have failed the exchange otherwise).
    const inFlight = maxInFlight(context.all, 'http.request.body', 'http.request.credit');
    expect(inFlight).toBeGreaterThan(0);
    expect(inFlight).toBeLessThanOrEqual(WINDOW);
    expect(context.toGateway.some((message) => message.type === 'http.request.credit')).toBe(true);
    expect(context.toInstance.at(-1)?.type).toBe('http.request.end');
    await context.host.close();
  });

  it('pulls a streamed response only as fast as the gateway reads it', async () => {
    const context = await started();
    const total = 3 * 1024 * 1024;
    const produced = { bytes: 0 };
    context.host.route('GET', '/download', () => new Response(lazyBody(total, produced), {
      headers: { 'content-type': 'application/octet-stream' },
    }));
    await opened(context);
    const response = await context.transport.fetch(new Request('http://gateway/download'));
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    // Nobody reads now: the instance stops after one window (plus the source's own chunk).
    await tick(50);
    expect(produced.bytes).toBeLessThanOrEqual(WINDOW + 200_000);
    expect(produced.bytes).toBeLessThan(total);
    let size = first.value!.byteLength;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
    }
    expect(size).toBe(total);
    expect(produced.bytes).toBe(total);
    const sizes = context.toGateway.filter((message) => message.type === 'http.response.body')
      .map((message) => (message.payload as { chunk: Uint8Array }).chunk.byteLength);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(CHUNK);
    expect(context.toInstance.some((message) => message.type === 'http.response.credit')).toBe(true);
    expect(maxInFlight(context.all, 'http.response.body', 'http.response.credit')).toBeLessThanOrEqual(WINDOW);
    await context.host.close();
  });

  it('delivers SSE events as they are written', async () => {
    const context = await started();
    let stream: ReturnType<typeof createResponseStream> | undefined;
    let closed = false;
    context.host.route('GET', '/events', () => {
      stream = createResponseStream();
      stream.onClose(() => { closed = true; });
      stream.write('event: hello\ndata: 1\n\n');
      return new Response(stream.stream, { headers: SSE_HEADERS });
    });
    await opened(context);
    const response = await context.transport.fetch(new Request('http://gateway/events'));
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    expect((await reader.read()).value).toBe('event: hello\ndata: 1\n\n');
    stream!.write('data: 2\n\n');
    expect((await reader.read()).value).toBe('data: 2\n\n');
    // The browser goes away: the instance producer is told.
    await reader.cancel();
    await until(() => closed, 'SSE close in the instance');
    await until(() => context.host.activeStreams === 0, 'instance exchange released');
    expect(context.toInstance.some((message) => message.type === 'http.request.abort')).toBe(true);
    await context.host.close();
  });

  it('cancels the instance handler when the client aborts', async () => {
    const context = await started();
    let handlerSignal: AbortSignal | undefined;
    const produced = { bytes: 0 } as { bytes: number; cancelled?: unknown };
    context.host.route('GET', '/slow', (request) => {
      handlerSignal = request.signal;
      return new Response(lazyBody(50 * 1024 * 1024, produced));
    });
    context.host.route('GET', '/never', (request) => new Promise<Response>((resolve) => {
      handlerSignal = request.signal;
      request.signal.addEventListener('abort', () => resolve(new Response(null)));
    }));
    await opened(context);
    // Aborted mid-body.
    const controller = new AbortController();
    const response = await context.transport.fetch(new Request('http://gateway/slow', { signal: controller.signal }));
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort(new Error('client went away'));
    await expect(reader.read()).rejects.toThrow();
    await until(() => produced.cancelled !== undefined, 'response source cancelled');
    expect(handlerSignal?.aborted).toBe(true);
    // Aborted before the head.
    const early = new AbortController();
    const pending = context.transport.fetch(new Request('http://gateway/never', { signal: early.signal }));
    await until(() => context.host.activeStreams === 1, 'handler running');
    early.abort(new Error('gone'));
    await expect(pending).rejects.toThrow('gone');
    await until(() => handlerSignal?.aborted === true && context.host.activeStreams === 0, 'handler aborted');
    await context.host.close();
  });

  it('propagates an instance-side body failure and instance shutdown to the gateway', async () => {
    const context = await started();
    let stream: ReturnType<typeof createResponseStream> | undefined;
    context.host.route('GET', '/broken', () => {
      stream = createResponseStream();
      stream.write('partial');
      return new Response(stream.stream);
    });
    await opened(context);
    const broken = await context.transport.fetch(new Request('http://gateway/broken'));
    const reader = broken.body!.getReader();
    await reader.read();
    stream!.error(new Error('disk on fire'));
    await expect(reader.read()).rejects.toMatchObject({ code: 'instance-error', message: 'disk on fire' });

    const sse = await context.transport.fetch(new Request('http://gateway/broken'));
    const sseReader = sse.body!.getReader();
    await sseReader.read();
    await context.host.close();
    await expect(sseReader.read()).rejects.toMatchObject({ code: 'instance-error', message: 'Instance stopping' });
  });

  it('fails exchanges when the instance goes away and times out a silent handler', async () => {
    const context = await started({ responseTimeoutMs: 80 });
    let aborted = false;
    context.host.route('GET', '/hang', (request) => new Promise<Response>(() => {
      request.signal.addEventListener('abort', () => { aborted = true; });
    }));
    await opened(context);
    await expect(context.transport.fetch(new Request('http://gateway/hang'))).rejects.toMatchObject({ code: 'timeout' });
    await until(() => aborted, 'instance handler aborted after timeout');

    const pending = context.transport.fetch(new Request('http://gateway/hang'));
    await until(() => context.host.activeStreams > 0, 'in flight');
    context.disconnect();
    await expect(pending).rejects.toBeInstanceOf(InstanceTransportError);
    await expect(pending).rejects.toMatchObject({ code: 'instance-offline' });
    await expect(context.transport.fetch(new Request('http://gateway/hang'))).rejects.toMatchObject({ code: 'instance-offline' });
    await context.host.close();
  });

  it('carries the gateway principal and still authorizes against the permission map', async () => {
    const context = await started();
    const seen: (ConsolePrincipal | undefined)[] = [];
    context.host.route('GET', '/api/system/status', (_request, routeContext) => {
      seen.push(routeContext.principal);
      return jsonResponse(200, { ok: true });
    });
    context.host.route('GET', '/api/unlisted', () => jsonResponse(200, { ok: true }));
    context.host.route('GET', '/page', (_request, routeContext) => jsonResponse(200, { kind: routeContext.principal?.kind ?? null }));
    await opened(context);
    const get = (path: string, principal?: ConsolePrincipal, headers?: HeadersInit) => context.transport.fetch(
      new Request(`http://gateway${path}`, headers ? { headers } : {}),
      principal ? { principal } : {},
    );
    // Anonymous: 401 — the instance never parses credentials itself in forwarded mode.
    expect((await get('/api/system/status', undefined, { authorization: 'Bearer whatever' })).status).toBe(401);
    // Signed in without the permission: 403.
    const denied = await get('/api/system/status', user(['feature.view']));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: 'forbidden' });
    // Granted.
    const allowed = await get('/api/system/status', user(['status.view']));
    expect(allowed.status).toBe(200);
    expect(seen.at(-1)).toMatchObject({ kind: 'user', userId: 'u1', grants: [{ permissions: ['status.view'] }] });
    // Unlisted routes are denied to every signed-in principal.
    expect((await get('/api/unlisted', user(['status.view']))).status).toBe(403);
    // Open bootstrap host (before setup).
    expect((await get('/api/system/status', { kind: 'bootstrap', open: true })).status).toBe(200);
    // Public routes still see a presented principal.
    expect(await (await get('/page', user([]))).json()).toEqual({ kind: 'user' });
    expect(await (await get('/page')).json()).toEqual({ kind: null });
    await context.host.close();
  });
});

describe('bridge WebSocket', () => {
  it('bridges text and binary frames both ways and propagates closes', async () => {
    const context = await started();
    const instanceClosed: [number, string][] = [];
    let connection: WsConnection | undefined;
    context.host.ws('/adapter/reverse', { auth: 'protocol' }).onConnection((conn) => {
      connection = conn;
      conn.send('welcome');
      conn.onMessage((data) => conn.send(typeof data === 'string' ? `echo:${data}` : new Uint8Array([...data].reverse())));
      conn.onClose((code, reason) => instanceClosed.push([code, reason]));
    });
    await opened(context);
    const peer = new FakePeer();
    const opening = context.transport.openWebSocket({
      url: new URL('http://gateway/adapter/reverse?x=1'), headers: new Headers({ 'x-adapter': 'qq' }), remoteAddress: '10.1.1.1',
    }, peer);
    peer.receive('early'); // before acceptance: queued
    expect(await opening).toBe(true);
    expect(connection?.url.searchParams.get('x')).toBe('1');
    expect(connection?.headers.get('x-adapter')).toBe('qq');
    expect(connection?.remoteAddress).toBe('10.1.1.1');
    await until(() => peer.sent.length >= 2, `welcome + early echo ${JSON.stringify(peer.sent)} ${JSON.stringify(context.all.map(m => m.type))}`);
    expect(peer.sent.slice(0, 2)).toEqual(['welcome', 'echo:early']);
    peer.receive(new Uint8Array([1, 2, 3]));
    await until(() => peer.sent.length >= 3, 'binary echo');
    expect(peer.sent[2]).toEqual(new Uint8Array([3, 2, 1]));
    // Browser closes → instance listener sees the code.
    peer.clientClose(4001, 'bye');
    await until(() => instanceClosed.length === 1, 'instance close');
    expect(instanceClosed[0]).toEqual([4001, 'bye']);
    await until(() => context.host.activeStreams === 0, 'socket released');

    // Instance closes → peer closed with the code.
    const second = new FakePeer();
    expect(await context.transport.openWebSocket({ url: new URL('http://gateway/adapter/reverse'), headers: new Headers() }, second)).toBe(true);
    connection!.close(4002, 'done');
    await until(() => second.closed !== undefined, 'peer close');
    expect(second.closed).toEqual({ code: 4002, reason: 'done' });
    await context.host.close();
  });

  it('rejects unknown paths and unauthenticated host sockets; accepts authorized principals', async () => {
    const context = await started();
    let principal: ConsolePrincipal | undefined;
    context.host.ws('/sandbox').onConnection((conn) => { principal = conn.principal; });
    await opened(context);
    const open = (path: string, who?: ConsolePrincipal) => context.transport.openWebSocket(
      { url: new URL(`http://gateway${path}`), headers: new Headers({ authorization: 'Bearer ignored' }), ...(who ? { principal: who } : {}) },
      new FakePeer(),
    );
    expect(await open('/nowhere')).toBe(false);
    expect(await open('/sandbox')).toBe(false);
    expect(await open('/sandbox', user(['status.view']))).toBe(false);
    expect(await open('/sandbox', user(['endpoint.operate']))).toBe(true);
    expect(principal).toMatchObject({ userId: 'u1' });
    expect(context.toGateway.filter((message) => message.type === 'ws.rejected').map((message) => message.payload))
      .toEqual([{ status: 404 }, { status: 401 }, { status: 401 }]);
    await until(() => context.host.activeStreams === 1, 'one open socket');
    await context.host.close();
  });

  it('reports bufferedAmount until the client socket drained (backpressure)', async () => {
    const context = await started();
    let connection: WsConnection | undefined;
    context.host.ws('/feed', { auth: 'protocol' }).onConnection((conn) => { connection = conn; });
    await opened(context);
    const peer = new FakePeer();
    expect(await context.transport.openWebSocket({ url: new URL('http://gateway/feed'), headers: new Headers() }, peer)).toBe(true);
    peer.bufferedAmount = 10 * 1024 * 1024; // slow browser
    connection!.send(new Uint8Array(1000));
    expect(connection!.bufferedAmount).toBe(1000);
    await until(() => peer.sent.length === 1, 'delivered to peer');
    await tick(60);
    expect(connection!.bufferedAmount).toBe(1000);
    peer.bufferedAmount = 0;
    await until(() => connection!.bufferedAmount === 0, 'drained');
    // Oversized frames close the socket instead of travelling.
    connection!.send('x'.repeat(DEFAULT_BRIDGE_LIMITS.maxWsMessageBytes));
    await until(() => peer.closed !== undefined, 'closed for size');
    expect(peer.closed?.code).toBe(1009);
    await context.host.close();
  });

  it('closes bridged sockets when the instance goes away', async () => {
    const context = await started();
    context.host.ws('/feed', { auth: 'protocol' }).onConnection(() => undefined);
    await opened(context);
    const peer = new FakePeer();
    expect(await context.transport.openWebSocket({ url: new URL('http://gateway/feed'), headers: new Headers() }, peer)).toBe(true);
    context.disconnect();
    expect(peer.closed?.code).toBe(1012);
    expect(await context.transport.openWebSocket({ url: new URL('http://gateway/feed'), headers: new Headers() }, new FakePeer())).toBe(false);
    await context.host.close();
  });
});

describe('bridge protocol limits and versions', () => {
  it('rejects oversized frames and malformed stream messages', () => {
    const big = new Uint8Array(DEFAULT_BRIDGE_LIMITS.maxChunkBytes + 1);
    expect(parseGatewayMessage({ type: 'http.request.body', id: 'h1', payload: { chunk: big } })).toBeUndefined();
    expect(parseInstanceMessage({ type: 'http.response.body', id: 'h1', payload: { chunk: big } })).toBeUndefined();
    expect(parseInstanceMessage({ type: 'http.response.body', payload: { chunk: new Uint8Array(1) } })).toBeUndefined();
    expect(parseGatewayMessage({ type: 'http.request', id: 'h1', payload: { method: 'GET', url: 'http://x/', headers: [['a', 'x'.repeat(70_000)]], body: false } })).toBeUndefined();
    expect(parseGatewayMessage({ type: 'http.request', id: 'h1', payload: { method: 'GET', url: 'http://x/', headers: [], body: false, principal: { kind: 'user' } } })).toBeUndefined();
    expect(parseGatewayMessage({ type: 'http.response.credit', id: 'h1', payload: { bytes: 0 } })).toBeUndefined();
    expect(parseGatewayMessage({ type: 'ws.close', id: 'w1', payload: { code: 999, reason: '' } })).toBeUndefined();
    expect(parseInstanceMessage({ type: 'http.response.head', id: 'h1', payload: { status: 101, headers: [], body: false } })).toBeUndefined();
    expect(parseInstanceMessage({ type: 'routes', payload: { table: { revision: 1, apiBase: '/api', http: [{ method: 'GET' }], ws: [] } } })).toBeUndefined();
  });

  it('fails a request whose body overruns the granted credit', async () => {
    const context = await started();
    context.host.route('POST', '/sink', () => new Promise<Response>(() => undefined));
    await opened(context);
    context.inject({ type: 'http.request', id: 'x1', payload: { method: 'POST', url: 'http://gateway/sink', headers: [], body: true } });
    for (let sent = 0; sent <= WINDOW; sent += CHUNK) {
      context.inject({ type: 'http.request.body', id: 'x1', payload: { chunk: new Uint8Array(CHUNK) } });
    }
    await until(() => context.toGateway.some((message) => message.type === 'http.response.error' && message.id === 'x1'), 'credit violation');
    await context.host.close();
  });

  it('refuses a gateway that announces an incompatible protocol version', () => {
    const port = {
      send: () => true,
      on: () => undefined,
      off: () => undefined,
      connected: true,
    } as unknown as InstanceIpcPort;
    expect(() => openInstanceControlChannel(port, 1, { [INSTANCE_CHILD_ENV]: '1' })).toThrow(BridgeProtocolMismatchError);
    const channel = openInstanceControlChannel(port, 1, { [INSTANCE_CHILD_ENV]: String(INSTANCE_BRIDGE_PROTOCOL_VERSION) });
    expect(channel?.gatewayVersion).toBe(INSTANCE_BRIDGE_PROTOCOL_VERSION);
    channel?.close();
  });
});
