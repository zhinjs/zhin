import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { jsonResponse, type HttpHost, type WsConnection } from '@zhin.js/host-http';
import { GatewayHttpServer } from '../../src/http/gateway-http-server.js';
import { createGatewayConsoleRpc } from '../../src/http/console-rpc.js';
import { createGatewayRpcDispatcher } from '../../src/packages/rpc.js';
import {
  InstanceTransportError,
  type BridgeRouteTable,
  type InstanceRequestContext,
  type InstanceTransport,
  type InstanceWsOpenInfo,
} from '@zhin.js/host-http/bridge';
import { installTestConsoleUsers } from '../utils/console-users.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalGatewayFetch } from '../../src/local/client.js';
import { createLocalRpcHandler } from '../../src/local/handler.js';
import { LocalControlServer } from '../../src/local/local-socket.js';

/** In-memory stand-in for the bridge transport: records requests, echoes WebSocket frames. */
class FakeTransport implements InstanceTransport {
  ready = true;
  table: BridgeRouteTable = {
    revision: 1,
    apiBase: '/api',
    http: [{ method: 'ALL', pattern: '/*' }],
    ws: [{ path: '/sandbox', auth: 'host' }, { path: '/adapter/reverse', auth: 'protocol' }],
  };
  readonly requests: Array<{ request: Request; context: InstanceRequestContext; body: string }> = [];
  readonly sockets: Array<{ info: InstanceWsOpenInfo; peer: WsConnection; closed?: { code: number; reason: string } }> = [];
  handler: (request: Request, context: InstanceRequestContext) => Promise<Response> = async (request) =>
    jsonResponse(200, { from: 'instance', path: new URL(request.url).pathname });
  acceptSockets = true;

  routes(): BridgeRouteTable { return this.table; }
  onRoutes(): () => void { return () => undefined; }

  async fetch(request: Request, context: InstanceRequestContext): Promise<Response> {
    const body = request.body ? await request.text() : '';
    this.requests.push({ request, context, body });
    return this.handler(request, context);
  }

  async openWebSocket(info: InstanceWsOpenInfo, peer: WsConnection): Promise<boolean> {
    // Asynchronous like the IPC round trip: early client frames must not be lost.
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (!this.acceptSockets) return false;
    const record: (typeof this.sockets)[number] = { info, peer };
    this.sockets.push(record);
    peer.onMessage((data) => {
      if (data === 'close') peer.close(4001, 'bye');
      else peer.send(typeof data === 'string' ? `echo:${data}` : data);
    });
    peer.onClose((code, reason) => { record.closed = { code, reason }; });
    return true;
  }
}

const servers: GatewayHttpServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function startServer(
  transport: FakeTransport | undefined,
  options: { state?: () => string; extra?: boolean; tls?: boolean; maxBody?: number; rpc?: boolean; trustProxy?: readonly string[] } = {},
): Promise<{ server: GatewayHttpServer; origin: string }> {
  const key = readFileSync(new URL('../../../http/tests/fixtures/localhost-key.pem', import.meta.url));
  const cert = readFileSync(new URL('../../../http/tests/fixtures/localhost-cert.pem', import.meta.url));
  const server = new GatewayHttpServer({
    http: {
      host: '127.0.0.1',
      port: 0,
      corsOrigins: ['http://console.local'],
      ...(options.trustProxy ? { trustProxy: options.trustProxy } : {}),
      ...(options.extra ? { listeners: [{ host: '127.0.0.1', port: 0, ...(options.tls ? { tls: { key, cert } } : {}) }] } : {}),
    },
    instance: { transport: () => transport, state: options.state ?? (() => (transport?.ready ? 'running' : 'stopped')) },
    retryAfterSeconds: 7,
    ...(options.maxBody !== undefined ? { maxRequestBodyBytes: options.maxBody } : {}),
    ...(options.rpc ? {
      consoleRpc: createGatewayConsoleRpc(createGatewayRpcDispatcher({
        instance: {
          start: async () => undefined,
          stop: async () => undefined,
          restart: async () => undefined,
          status: () => ({ state: 'running', lastExitCode: null, lastExitSignal: null, recentRestarts: 0 }) as never,
          logs: { tail: () => [] },
        },
      })),
    } : {}),
  });
  servers.push(server);
  const address = await server.listen();
  return { server, origin: address.origin };
}

function withUsers(server: GatewayHttpServer): void {
  installTestConsoleUsers(server as unknown as HttpHost, { 'owner-token': 'owner', 'viewer-token': 'viewer', nobody: 'none' });
}

function waitFor<T>(check: () => T | undefined | false, timeoutMs = 3_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      const value = check();
      if (value !== undefined && value !== false) { resolve(value); return; }
      if (Date.now() - started > timeoutMs) { reject(new Error('timed out')); return; }
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('GatewayHttpServer Console RPC', () => {
  const post = (origin: string, token: string, body: unknown) => fetch(`${origin}/api/console/request`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  it('answers gateway.* itself and forwards every other type unchanged', async () => {
    const transport = new FakeTransport();
    const { server, origin } = await startServer(transport, { rpc: true });
    withUsers(server);
    const own = await post(origin, 'viewer-token', { type: 'gateway.instance.status', requestId: 'q1' });
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ success: true, type: 'gateway.instance.status', requestId: 'q1', data: { instanceId: 'default', state: 'running' } });
    // viewer lacks ops.restart; an unknown gateway.* type is unmapped, not forwarded.
    const denied = await post(origin, 'viewer-token', { type: 'gateway.instance.restart', requestId: 'q2' });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ success: false, code: 'forbidden', requestId: 'q2' });
    expect((await (await post(origin, 'owner-token', { type: 'gateway.nope' })).json())).toMatchObject({ code: 'unmapped' });
    expect(transport.requests).toHaveLength(0);
    const forwardedBody = { type: 'config:get', requestId: 'q3', data: { name: 'x' } };
    const forwarded = await post(origin, 'viewer-token', forwardedBody);
    expect(forwarded.status).toBe(200);
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]!.body).toBe(JSON.stringify(forwardedBody));
    expect(transport.requests[0]!.context.principal).toMatchObject({ userId: 'viewer-token' });
    // The route is authenticated at the gateway before anything is dispatched.
    expect((await post(origin, 'wrong', { type: 'gateway.instance.status' })).status).toBe(401);
  });
});

describe('GatewayHttpServer routing', () => {
  it('serves gateway-owned routes before forwarding', async () => {
    const transport = new FakeTransport();
    const { server, origin } = await startServer(transport);
    server.route('GET', '/api/gateway/ping', () => jsonResponse(200, { from: 'gateway' }));

    const own = await fetch(`${origin}/api/gateway/ping`);
    expect(await own.json()).toEqual({ from: 'gateway' });
    const health = await fetch(`${origin}/pub/health`);
    expect(await health.json()).toMatchObject({ success: true, status: 'ok', instance: { state: 'running', ready: true } });
    expect(transport.requests).toHaveLength(0);

    const forwarded = await fetch(`${origin}/api/system/status`);
    expect(await forwarded.json()).toEqual({ from: 'instance', path: '/api/system/status' });
    expect(transport.requests).toHaveLength(1);
  });

  it('authenticates {base} requests at the gateway and forwards the principal', async () => {
    const transport = new FakeTransport();
    const { server, origin } = await startServer(transport);
    withUsers(server);

    const response = await fetch(`${origin}/api/system/status?x=1`, {
      headers: { authorization: 'Bearer owner-token', 'x-custom': 'kept' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const [forwarded] = transport.requests;
    expect(forwarded!.context.principal).toMatchObject({ kind: 'user', userId: 'owner-token' });
    expect(forwarded!.context.remoteAddress).toMatch(/127\.0\.0\.1/);
    expect(new URL(forwarded!.request.url).search).toBe('?x=1');
    expect(forwarded!.request.headers.get('x-custom')).toBe('kept');

    const posted = await fetch(`${origin}/api/console/request`, {
      method: 'POST',
      headers: { authorization: 'Bearer viewer-token', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'status.get' }),
    });
    expect(posted.status).toBe(200);
    expect(transport.requests[1]!.body).toBe('{"type":"status.get"}');
    expect(transport.requests[1]!.request.method).toBe('POST');
  });

  it('rejects unauthenticated or unauthorized {base} requests without forwarding', async () => {
    const transport = new FakeTransport();
    const { server, origin } = await startServer(transport);
    withUsers(server);

    const anonymous = await fetch(`${origin}/api/system/status`);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ success: false, code: 'unauthorized', requestOutcome: 'not-dispatched' });
    const forbidden = await fetch(`${origin}/api/system/status`, { headers: { authorization: 'Bearer nobody' } });
    expect(forbidden.status).toBe(403);
    const unmapped = await fetch(`${origin}/api/not-registered`, { headers: { authorization: 'Bearer owner-token' } });
    expect(unmapped.status).toBe(403);
    expect(transport.requests).toHaveLength(0);
  });

  it('forwards non-Console routes (webhooks) as-is without Console auth', async () => {
    const transport = new FakeTransport();
    transport.handler = async (request) => new Response(`hook:${await Promise.resolve(request.method)}`, {
      status: 202,
      headers: { 'x-plugin': 'yes', 'set-cookie': 'a=1', connection: 'close' },
    });
    const { server, origin } = await startServer(transport);
    withUsers(server);

    const response = await fetch(`${origin}/webhook/github?sig=abc`, {
      method: 'POST',
      headers: { 'x-hub-signature': 'sha256=1' },
      body: 'payload',
    });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('hook:POST');
    expect(response.headers.get('x-plugin')).toBe('yes');
    expect(response.headers.get('set-cookie')).toBe('a=1');
    const [forwarded] = transport.requests;
    expect(forwarded!.context.principal).toBeUndefined();
    expect(forwarded!.body).toBe('payload');
    expect(forwarded!.request.headers.get('x-hub-signature')).toBe('sha256=1');
  });

  it('rejects forwarded bodies over the limit', async () => {
    const transport = new FakeTransport();
    const { origin } = await startServer(transport, { maxBody: 8 });
    const declared = await fetch(`${origin}/webhook`, { method: 'POST', body: 'x'.repeat(64) });
    expect(declared.status).toBe(413);
    expect(await declared.json()).toMatchObject({ code: 'payload_too_large' });
    expect(transport.requests).toHaveLength(0);

    let sent = 0;
    const streamed = await fetch(`${origin}/webhook`, {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          sent += 1;
          if (sent > 4) controller.close();
          else controller.enqueue(new Uint8Array(6));
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect(streamed.status).toBe(413);
  });
});

describe('GatewayHttpServer streaming', () => {
  it('streams SSE through and aborts the forwarded request on client disconnect', async () => {
    const transport = new FakeTransport();
    let cancelled = false;
    let forwardedSignal: AbortSignal | undefined;
    transport.handler = async (request) => {
      forwardedSignal = request.signal;
      let timer: ReturnType<typeof setInterval> | undefined;
      let count = 0;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: hello\ndata: 0\n\n'));
          timer = setInterval(() => {
            count += 1;
            controller.enqueue(new TextEncoder().encode(`data: ${count}\n\n`));
          }, 20);
        },
        cancel() {
          cancelled = true;
          clearInterval(timer);
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    };
    const { server, origin } = await startServer(transport);
    withUsers(server);

    const abort = new AbortController();
    const response = await fetch(`${origin}/api/events`, {
      headers: { authorization: 'Bearer viewer-token' },
      signal: abort.signal,
    });
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    let text = '';
    while (!text.includes('data: 2')) {
      const next = await reader.read();
      if (next.done) break;
      text += new TextDecoder().decode(next.value);
    }
    expect(text).toContain('event: hello');
    expect(text).toContain('data: 1');
    abort.abort();
    await waitFor(() => cancelled && forwardedSignal?.aborted);
    expect(forwardedSignal!.aborted).toBe(true);
  });
});

describe('GatewayHttpServer WebSocket passthrough', () => {
  function connect(url: string, options?: ConstructorParameters<typeof WebSocket>[2]): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, options);
      socket.once('open', () => resolve(socket));
      socket.once('error', reject);
      socket.once('unexpected-response', (_request, response) => reject(new Error(`HTTP ${response.statusCode}`)));
    });
  }

  function nextMessage(socket: WebSocket): Promise<{ data: Buffer; binary: boolean }> {
    return new Promise((resolve) => socket.once('message', (data, binary) => resolve({ data: data as Buffer, binary })));
  }

  it('forwards protocol-authenticated sockets with text, binary and close', async () => {
    const transport = new FakeTransport();
    const { server, origin } = await startServer(transport);
    withUsers(server);
    const socket = await connect(`${origin.replace('http', 'ws')}/adapter/reverse?access_token=plugin-own`);
    // Sent before the instance side subscribed: must still arrive.
    socket.send('early');
    const early = await nextMessage(socket);
    expect(early.data.toString()).toBe('echo:early');

    socket.send(Buffer.from([1, 2, 3]));
    const binary = await nextMessage(socket);
    expect(binary.binary).toBe(true);
    expect([...binary.data]).toEqual([1, 2, 3]);

    const [record] = transport.sockets;
    expect(record!.info.principal).toBeUndefined();
    expect(record!.info.url.searchParams.get('access_token')).toBe('plugin-own');

    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    socket.send('close');
    expect(await closed).toEqual({ code: 4001, reason: 'bye' });
  });

  it('closing the client reaches the instance side', async () => {
    const transport = new FakeTransport();
    const { origin } = await startServer(transport);
    const socket = await connect(`${origin.replace('http', 'ws')}/adapter/reverse`);
    await waitFor(() => transport.sockets[0]);
    socket.close(4002, 'client done');
    const record = await waitFor(() => transport.sockets[0]?.closed && transport.sockets[0]);
    expect(record.closed).toEqual({ code: 4002, reason: 'client done' });
  });

  it('authenticates host-authenticated instance sockets at the gateway', async () => {
    const transport = new FakeTransport();
    const { server, origin } = await startServer(transport);
    withUsers(server);
    const base = origin.replace('http', 'ws');
    await expect(connect(`${base}/sandbox`)).rejects.toThrow('HTTP 401');
    await expect(connect(`${base}/sandbox?token=viewer-token`)).rejects.toThrow('HTTP 401');
    await expect(connect(`${base}/unknown`)).rejects.toThrow();
    const socket = await connect(`${base}/sandbox`, { headers: { authorization: 'Bearer owner-token' } });
    await waitFor(() => transport.sockets[0]);
    expect(transport.sockets[0]!.info.principal).toMatchObject({ userId: 'owner-token' });
    socket.close();
  });

  it('closes the client when the instance refuses the socket', async () => {
    const transport = new FakeTransport();
    transport.acceptSockets = false;
    const { origin } = await startServer(transport);
    const socket = await connect(`${origin.replace('http', 'ws')}/adapter/reverse`);
    const code = await new Promise<number>((resolve) => socket.once('close', (value) => resolve(value)));
    expect(code).toBe(1013);
  });
});

describe('GatewayHttpServer instance availability', () => {
  it('answers 503 with Retry-After (exposed via CORS) while the instance is offline', async () => {
    const transport = new FakeTransport();
    transport.ready = false;
    const { server, origin } = await startServer(transport, { state: () => 'backoff' });
    server.route('GET', '/api/gateway/ping', () => jsonResponse(200, { ok: true }));

    const offline = await fetch(`${origin}/webhook/x`, { headers: { origin: 'http://console.local' } });
    expect(offline.status).toBe(503);
    expect(offline.headers.get('retry-after')).toBe('7');
    expect(offline.headers.get('access-control-allow-origin')).toBe('http://console.local');
    expect(offline.headers.get('access-control-expose-headers')).toMatch(/Retry-After/i);
    expect(await offline.json()).toMatchObject({ success: false, code: 'instance_unavailable', state: 'backoff' });

    // Gateway-owned routes keep working.
    expect((await fetch(`${origin}/api/gateway/ping`)).status).toBe(200);
    const health = await fetch(`${origin}/pub/health`);
    expect(health.headers.get('cache-control')).toBe('no-store');
    expect(await health.json()).toMatchObject({ success: true, status: 'ok', instance: { state: 'backoff', ready: false } });

    await expect(new Promise((resolve, reject) => {
      const socket = new WebSocket(`${origin.replace('http', 'ws')}/adapter/reverse`);
      socket.once('open', () => reject(new Error('opened')));
      socket.once('unexpected-response', (_request, response) => resolve([response.statusCode, response.headers['retry-after']]));
      socket.once('error', reject);
    })).resolves.toEqual([503, '7']);

    transport.ready = true;
    expect((await fetch(`${origin}/webhook/x`)).status).toBe(200);
  });

  it('answers 503 when no instance transport exists yet', async () => {
    const { origin } = await startServer(undefined, { state: () => 'starting' });
    const response = await fetch(`${origin}/api/system/status`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'instance_unavailable', state: 'starting' });
  });

  it('maps a transport failure after the instance went away to 503', async () => {
    const transport = new FakeTransport();
    transport.handler = async () => {
      transport.ready = false;
      throw new Error('channel closed');
    };
    const { origin } = await startServer(transport);
    const response = await fetch(`${origin}/webhook/x`);
    expect(response.status).toBe(503);
    transport.ready = true;
    transport.handler = async () => { throw new Error('boom'); };
    expect((await fetch(`${origin}/webhook/x`)).status).toBe(502);
  });

  it('maps InstanceTransportError codes to 503 / 504 / 502', async () => {
    const transport = new FakeTransport();
    const { origin } = await startServer(transport, { state: () => 'stopping' });
    transport.handler = async () => { throw new InstanceTransportError('instance-offline', 'gone'); };
    const offline = await fetch(`${origin}/webhook/x`);
    expect(offline.status).toBe(503);
    expect(offline.headers.get('retry-after')).toBe('7');
    expect(await offline.json()).toEqual({ success: false, code: 'instance_unavailable', requestOutcome: 'not-dispatched', state: 'stopping', error: expect.any(String) });
    transport.handler = async () => { throw new InstanceTransportError('timeout', 'slow'); };
    const timeout = await fetch(`${origin}/webhook/x`);
    expect(timeout.status).toBe(504);
    expect(timeout.headers.get('retry-after')).toBeNull();
    expect(await timeout.json()).toEqual({ success: false, code: 'instance_timeout', requestOutcome: 'unknown', state: 'stopping', error: expect.any(String) });
    transport.handler = async () => { throw new InstanceTransportError('instance-error', 'handler failed'); };
    const failed = await fetch(`${origin}/webhook/x`);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ success: false, code: 'instance_error', requestOutcome: 'unknown', state: 'stopping', error: expect.any(String) });
    transport.handler = async () => { throw new InstanceTransportError('overloaded', 'busy'); };
    const busy = await fetch(`${origin}/webhook/x`);
    expect(busy.status).toBe(502);
    expect(busy.headers.get('retry-after')).toBe('7');
    expect(await busy.json()).toMatchObject({ code: 'instance_error', requestOutcome: 'not-dispatched' });
  });
});

describe('GatewayHttpServer listeners', () => {
  it('serves the same surface on an extra TLS listen port', async () => {
    const transport = new FakeTransport();
    const { server } = await startServer(transport, { extra: true, tls: true });
    const [primary, extra] = server.addresses;
    expect(primary!.protocol).toBe('http');
    expect(extra).toMatchObject({ protocol: 'https', secure: true });
    expect(server.address).toEqual(primary);
    const ca = readFileSync(new URL('../../../http/tests/fixtures/localhost-cert.pem', import.meta.url));
    const body = await new Promise<string>((resolve, reject) => {
      const request = httpsRequest({ host: '127.0.0.1', port: extra!.port, path: '/webhook/tls', ca, servername: 'localhost' }, (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => resolve(text));
      });
      request.once('error', reject);
      request.end();
    });
    expect(JSON.parse(body)).toEqual({ from: 'instance', path: '/webhook/tls' });
  });

  it('closes every listener', async () => {
    const transport = new FakeTransport();
    const { server } = await startServer(transport, { extra: true });
    const [, extra] = server.addresses;
    await server.close();
    expect(server.addresses).toHaveLength(0);
    await expect(fetch(`${extra!.origin}/pub/health`)).rejects.toThrow();
  });
});

describe('GatewayHttpServer http.trustProxy', () => {
  const reverseSocket = (origin: string, headers: Record<string, string>) => new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`${origin.replace('http', 'ws')}/adapter/reverse`, { headers });
    socket.once('open', () => { socket.close(); resolve(); });
    socket.once('error', reject);
  });

  it('ignores a spoofed X-Forwarded-For when trustProxy is off', async () => {
    const transport = new FakeTransport();
    const { server, origin } = await startServer(transport);
    server.route('GET', '/gw/ip', (_request, context) => new Response(context.remoteAddress ?? ''));
    expect(await (await fetch(`${origin}/gw/ip`, { headers: { 'x-forwarded-for': '198.51.100.7' } })).text()).toMatch(/127\.0\.0\.1$/u);
    await fetch(`${origin}/plugin/x`, { headers: { 'x-forwarded-for': '198.51.100.7' } });
    expect(transport.requests[0]!.context.remoteAddress).toMatch(/127\.0\.0\.1$/u);
    // The forwarding header still reaches the instance, so its loopback-only sockets refuse it.
    expect(transport.requests[0]!.request.headers.get('x-forwarded-for')).toBe('198.51.100.7');
  });

  it('derives the client address from a trusted proxy for gateway routes, forwarded requests and reverse sockets', async () => {
    const transport = new FakeTransport();
    const { server, origin } = await startServer(transport, { trustProxy: ['loopback'] });
    server.route('GET', '/gw/ip', (_request, context) => new Response(context.remoteAddress ?? ''));
    expect(await (await fetch(`${origin}/gw/ip`, { headers: { 'x-forwarded-for': '203.0.113.5' } })).text()).toBe('203.0.113.5');
    await fetch(`${origin}/plugin/x`, { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.6' } });
    expect(transport.requests[0]!.context.remoteAddress).toBe('203.0.113.6');
    await reverseSocket(origin, { 'x-forwarded-for': '203.0.113.7' });
    expect((await waitFor(() => transport.sockets[0])).info.remoteAddress).toBe('203.0.113.7');
  });
});

describe.runIf(process.platform !== 'win32')('GatewayHttpServer local requests (gateway.http.request)', () => {
  it('runs {base} requests from the local socket as the local owner, without a token', async () => {
    const transport = new FakeTransport();
    const { server } = await startServer(transport, { rpc: true });
    withUsers(server);
    const root = await mkdtemp(join(tmpdir(), 'zgw-'));
    const control = await LocalControlServer.open({ path: join(root, '.zhin', 'gateway.sock') });
    try {
      control.setHandler(createLocalRpcHandler({
        dispatch: async () => ({ ok: false, error: { code: 'unmapped', message: 'n/a', status: 403 } }),
        info: () => { throw new Error('unused'); },
        shutdown: () => undefined,
        http: (request) => server.localRequest(request),
      }));
      const local = createLocalGatewayFetch({ root });
      // Forwarded to the instance with the owner principal (the instance authorizes it).
      const jobs = await local('http://127.0.0.1:1/api/assistant/jobs?limit=2');
      expect(jobs.status).toBe(200);
      expect(await jobs.json()).toMatchObject({ from: 'instance', path: '/api/assistant/jobs' });
      expect(transport.requests.at(-1)!.context.principal).toMatchObject({ kind: 'user', userId: 'local', roles: ['owner'] });
      expect(new URL(transport.requests.at(-1)!.request.url).search).toBe('?limit=2');
      // Console RPC keeps its split: gateway.* answered by the gateway, the rest forwarded.
      const status = await local('http://x/api/console/request', { method: 'POST', body: JSON.stringify({ type: 'gateway.instance.status', requestId: 1 }) });
      expect(await status.json()).toMatchObject({ success: true, data: { state: 'running' } });
      const config = await local('http://x/api/console/request', { method: 'POST', body: JSON.stringify({ type: 'config:get-project', requestId: 2 }) });
      expect(config.status).toBe(200);
      expect(transport.requests.at(-1)!.body).toContain('config:get-project');
      // Only {base}/… is reachable; the instance being offline keeps the documented reply.
      expect((await local('http://x/webhook/x')).status).toBe(404);
      transport.ready = false;
      const offline = await local('http://x/api/system/status');
      expect(offline.status).toBe(503);
      expect(offline.headers.get('retry-after')).toBe('7');
      expect(await offline.json()).toMatchObject({ code: 'instance_unavailable' });
    } finally {
      await control.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects like a refused connection when no gateway runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zgw-'));
    try {
      await expect(createLocalGatewayFetch({ root })('http://x/api/stats')).rejects.toMatchObject({ cause: { code: 'ECONNREFUSED' } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
