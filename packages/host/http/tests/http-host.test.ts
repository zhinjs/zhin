import { describe, expect, it, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer, createConnection } from 'node:net';
import { request as httpsRequest } from 'node:https';
import WebSocket from 'ws';
import {
  SnapshotStore,
  bindGenerationAdmission,
  createGenerationAdmissionGate,
  featureId,
  generationAdmissionSource,
  rootPluginId,
  type GenerationAdmissionGate,
  type SnapshotState,
} from '@zhin.js/plugin-runtime';
import { type HttpHost, type HttpHandler, type WsConnection } from '../src/http-host.js';
import { createHttpHost } from '../src/node/server.js';
import { createHttpHostGroup } from '../src/node/listener-group.js';
import { listHttpHostAddresses } from '../src/addresses.js';
import { createResponseStream, jsonResponse } from '@zhin.js/host-http-contract';
import {
  type ConsoleAccessProvider,
  type ConsoleAuditEntry,
  type ConsoleUserPrincipal,
} from '../src/access-control.js';
import { CONSOLE_BUILTIN_ROLES } from '@zhin.js/console-protocol';

const hosts: Array<ReturnType<typeof createHttpHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('HttpHost', () => {
  it('treats close before listen as terminal and never binds a new listener', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    const closing = host.close();
    await closing;
    await expect(host.listen()).rejects.toThrow('HTTP Host is closed');
    expect(host.close()).toBe(closing);
    expect(host.address).toBeUndefined();
  });

  it('shares concurrent listen calls and releases the actual TCP port on terminal close', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    const first = host.listen();
    expect(host.listen()).toBe(first);
    const address = await first;
    expect((await fetch(`${address.origin}/pub/health`)).status).toBe(200);
    await host.close();
    await expect(host.listen()).rejects.toThrow('HTTP Host is closed');
    await expect(tcpConnect(address.port)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });

  it('waits for pending listen to settle during close and cannot leave a late listener behind', async () => {
    const reservation = createServer();
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    const host = createHttpHost({ host: '127.0.0.1', port });
    hosts.push(host);
    const listening = host.listen();
    const rejection = expect(listening).rejects.toThrow('HTTP Host closed before listen completed');
    const closing = host.close();
    expect(host.close()).toBe(closing);
    await rejection;
    await closing;
    expect(host.address).toBeUndefined();
    await expect(tcpConnect(port)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });

  it('serves authenticated HTTPS health and WSS routes with explicit secure address metadata', async () => {
    const key = readFileSync(new URL('./fixtures/localhost-key.pem', import.meta.url));
    const cert = readFileSync(new URL('./fixtures/localhost-cert.pem', import.meta.url));
    const host = createHttpHost({ host: '127.0.0.1', port: 0, tls: {key, cert} });
    hosts.push(host);
    host.ws('/secure').onConnection((connection) => connection.send('secure'));
    const address = await host.listen();

    expect(address).toEqual({
      host: '127.0.0.1', port: expect.any(Number), protocol: 'https', secure: true,
      origin: `https://127.0.0.1:${address.port}`,
    });
    await expect(httpsText(address.port, '/pub/health', cert)).resolves.toContain('"status":"ok"');
    await expect(new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`wss://127.0.0.1:${address.port}/secure`, {
        ca: cert, servername: 'localhost',
      });
      socket.once('message', value => { resolve(value.toString()); socket.close(); });
      socket.once('error', reject);
    })).resolves.toBe('secure');
  });

  it('keeps candidate HTTP and WS routes invisible until atomic generation admission', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    const previous = createGenerationAdmissionGate();
    const next = createGenerationAdmissionGate();
    const previousHost = bindGenerationAdmission<HttpHost>(host, previous);
    const nextHost = bindGenerationAdmission<HttpHost>(host, next);
    const wsSeen: string[] = [];
    previousHost.route('GET', '/generation', () => new Response('previous'));
    previousHost.ws('/generation').onConnection((connection) => {
      wsSeen.push('previous');
      connection.close();
    });
    const store = new SnapshotStore(admissionState(previous));
    const { port } = await host.listen();

    nextHost.route('GET', '/generation', () => new Response('next'));
    nextHost.ws('/generation').onConnection((connection) => {
      wsSeen.push('next');
      connection.close();
    });
    expect(await (await fetch(`http://127.0.0.1:${port}/generation`)).text()).toBe('previous');
    await connectWebSocket(port, '/generation');
    expect(wsSeen).toEqual(['previous']);

    store.commit(0, { snapshot: admissionState(next), dispose: () => undefined });
    expect(await (await fetch(`http://127.0.0.1:${port}/generation`)).text()).toBe('next');
    await connectWebSocket(port, '/generation');
    expect(wsSeen).toEqual(['previous', 'next']);
    await store.close();
  });

  it('pins accepted HTTP and WebSocket work until their owner completes it after replacement', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    const previous = createGenerationAdmissionGate();
    const next = createGenerationAdmissionGate();
    const previousHost = bindGenerationAdmission<HttpHost>(host, previous);
    let releaseHttp!: () => void;
    const httpGate = new Promise<void>((resolve) => { releaseHttp = resolve; });
    let enteredHttp!: () => void;
    const httpEntered = new Promise<void>((resolve) => { enteredHttp = resolve; });
    previousHost.route('GET', '/slow', async () => {
      enteredHttp();
      await httpGate;
      return new Response('done');
    });
    let ownedSocket!: WsConnection;
    previousHost.ws('/slow').onConnection((connection) => {
      ownedSocket = connection;
      connection.onMessage(() => connection.send('previous-owner'));
    });
    const store = new SnapshotStore(admissionState(previous));
    let disposed = false;
    store.commit(0, {
      snapshot: admissionState(previous),
      dispose: () => { disposed = true; },
    });
    const { port } = await host.listen();

    const http = fetch(`http://127.0.0.1:${port}/slow`);
    await httpEntered;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/slow`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    store.commit(1, { snapshot: admissionState(next), dispose: () => undefined });
    expect(disposed).toBe(false);

    const retained = new Promise<string>(resolve => {
      ws.once('message', data => resolve(String(data)));
      ws.once('close', () => resolve('closed-before-owner-finished'));
    });
    ws.send('continue accepted work');
    expect(await retained).toBe('previous-owner');
    expect(disposed).toBe(false);
    const closed = new Promise<void>(resolve => ws.once('close', () => resolve()));
    ownedSocket.close();
    await closed;

    releaseHttp();
    expect(await (await http).text()).toBe('done');
    await vi.waitFor(() => expect(disposed).toBe(true));
    await store.close();
  });

  it('closes accepted WebSockets on explicit Root stop before waiting for their lease disposal', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 }); hosts.push(host);
    const previous = createGenerationAdmissionGate(), next = createGenerationAdmissionGate();
    const owned = bindGenerationAdmission<HttpHost>(host, previous);
    owned.ws('/root-stop').onConnection(() => undefined);
    const store = new SnapshotStore(admissionState(previous));
    let disposed = false;
    store.commit(0, { snapshot: admissionState(previous), dispose: () => { disposed = true; } });
    const { port } = await host.listen();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/root-stop`);
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    store.commit(1, { snapshot: admissionState(next), dispose() {} });
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(disposed).toBe(false);
    const closed = new Promise<number>(resolve => socket.once('close', code => resolve(code)));
    const stopping = store.close();
    try {
      await expect(closed).resolves.toBe(1012);
      await stopping;
      expect(disposed).toBe(true);
    } finally { await host.close(); await stopping; }
  });

  it('keeps a generation leased until a streaming response closes', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    const previous = createGenerationAdmissionGate();
    const next = createGenerationAdmissionGate();
    const previousHost = bindGenerationAdmission<HttpHost>(host, previous);
    const response = createResponseStream();
    let started!: () => void;
    const streamStarted = new Promise<void>((resolve) => { started = resolve; });
    previousHost.route('GET', '/stream', () => {
      response.write('data: ready\n\n');
      started();
      return new Response(response.stream, { headers: { 'content-type': 'text/event-stream' } });
    });
    const store = new SnapshotStore(admissionState(previous));
    let disposed = false;
    store.commit(0, {
      snapshot: admissionState(previous),
      dispose: () => { disposed = true; },
    });
    const { port } = await host.listen();
    const request = fetch(`http://127.0.0.1:${port}/stream`);
    await streamStarted;

    store.commit(1, { snapshot: admissionState(next), dispose: () => undefined });
    expect(disposed).toBe(false);
    response.close();
    await (await request).text();
    await vi.waitFor(() => expect(disposed).toBe(true));
    await store.close();
  });

  it('listens and routes websocket upgrades by path', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    const sandbox = host.ws('/sandbox');
    const other = host.ws('/other');
    const seen: string[] = [];
    sandbox.onConnection(() => { seen.push('sandbox'); });
    other.onConnection(() => { seen.push('other'); });
    const { port } = await host.listen();

    await new Promise<void>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${port}/sandbox`);
      client.once('open', () => {
        expect(seen).toEqual(['sandbox']);
        client.close();
      });
      client.once('close', () => resolve());
      client.once('error', reject);
    });
  });

  it('closes listeners and rejects unknown upgrade paths', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    const handle = host.ws('/sandbox');
    let count = 0;
    handle.onConnection(() => { count += 1; });
    const { port } = await host.listen();
    handle.close();

    await expect(new Promise<void>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${port}/sandbox`);
      client.once('open', () => reject(new Error('unexpected open')));
      client.once('error', () => resolve());
      setTimeout(() => reject(new Error('timeout')), 1000);
    })).resolves.toBeUndefined();

    expect(count).toBe(0);
  });

  it('routes HTTP GET by exact and prefix paths', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    host.route('GET', '/console/api/pages', () => new Response('{"pages":[]}', {
      headers: { 'content-type': 'application/json' },
    }));
    host.route('GET', '/assets/client/*', (_request, { url, params }) => new Response(`${url.pathname}|${params['*']}`, {
      headers: { 'content-type': 'text/plain' },
    }));
    const { port } = await host.listen();

    const pages = await fetch(`http://127.0.0.1:${port}/console/api/pages`);
    expect(pages.status).toBe(200);
    expect(await pages.json()).toEqual({ pages: [] });

    const asset = await fetch(`http://127.0.0.1:${port}/assets/client/demo.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('/assets/client/demo.js|demo.js');

    const missing = await fetch(`http://127.0.0.1:${port}/missing`);
    expect(missing.status).toBe(404);
  });

  it('normalizes trailing slashes when matching routes', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    host.route('GET', '/console/api/pages', () => new Response('{"pages":[]}', {
      headers: { 'content-type': 'application/json' },
    }));
    const { port } = await host.listen();

    const pages = await fetch(`http://127.0.0.1:${port}/console/api/pages///`);
    expect(pages.status).toBe(200);
  });

  it('handles paths with long slash runs in linear time (no ReDoS)', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    host.route('GET', '/console/api/pages', () => new Response('{"pages":[]}', {
      headers: { 'content-type': 'application/json' },
    }));
    const { port } = await host.listen();

    // 中段长串 `/` 不以字符串结尾：旧正则 /\/+$/ 在此呈二次方回溯。
    const path = `/x${'/'.repeat(8_000)}tail`;
    const start = performance.now();
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    expect(performance.now() - start).toBeLessThan(100);
    expect(response.status).toBe(404);
  });

  it('serves /pub/health without auth and limits the bootstrap token to setup before an owner exists', async () => {
    const host = createHttpHost({
      host: '127.0.0.1',
      port: 0,
      token: 'secret-full-token',
      corsOrigins: ['https://example.test'],
    });
    hosts.push(host);
    host.route('GET', '/api/system/status', (_request, { principal }) => jsonResponse(200, { kind: principal?.kind }));
    host.route('GET', '/api/auth/setup', (_request, { principal }) => jsonResponse(200, { principal }));
    const { port } = await host.listen();

    const health = await fetch(`http://127.0.0.1:${port}/pub/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ success: true, status: 'ok' });

    const denied = await fetch(`http://127.0.0.1:${port}/api/system/status`);
    expect(denied.status).toBe(401);

    const setupOnly = await fetch(`http://127.0.0.1:${port}/api/system/status`, {
      headers: { Authorization: 'Bearer secret-full-token' },
    });
    expect(setupOnly.status).toBe(403);
    expect(await setupOnly.json()).toMatchObject({ code: 'setup_required', requestOutcome: 'not-dispatched' });

    const allowed = await fetch(`http://127.0.0.1:${port}/api/auth/setup`, {
      headers: { Authorization: 'Bearer secret-full-token' },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ principal: { kind: 'bootstrap', open: false } });

    const preflight = await fetch(`http://127.0.0.1:${port}/api/system/status`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.test' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://example.test');
  });

  it('authorizes WS upgrades by principal: only mapped Console sockets, never the bootstrap token', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0, token: 'secret-full-token' });
    hosts.push(host);
    const provider = fakeProvider({ initialized: false });
    host.tokenRegistry.useAccessProvider(provider);
    const opened: string[] = [];
    host.ws('/sandbox').onConnection((connection) => { opened.push(`sandbox:${connection.principal?.kind}`); connection.close(); });
    host.ws('/sandbox/bot-2').onConnection((connection) => { opened.push(`sandbox/bot-2:${connection.principal?.kind}`); connection.close(); });
    // A host-authenticated plugin socket is not a Console socket: nobody but an open Host may use it.
    host.ws('/plugin-socket').onConnection((connection) => { opened.push(`plugin:${connection.principal?.kind}`); connection.close(); });
    const { port } = await host.listen();

    expect(await wsOutcome(`ws://127.0.0.1:${port}/sandbox`)).toBe('rejected');
    expect(await wsOutcome(`ws://127.0.0.1:${port}/sandbox?token=secret-full-token`)).toBe('rejected');
    expect(await wsOutcome(`ws://127.0.0.1:${port}/plugin-socket?token=secret-full-token`)).toBe('rejected');

    provider.state.initialized = true;
    expect(await wsOutcome(`ws://127.0.0.1:${port}/sandbox?token=secret-full-token`)).toBe('rejected');
    expect(await wsOutcome(`ws://127.0.0.1:${port}/sandbox?token=operator-session`)).toBe('opened');
    expect(await wsOutcome(`ws://127.0.0.1:${port}/sandbox/bot-2?token=operator-session`)).toBe('opened');
    expect(await wsOutcome(`ws://127.0.0.1:${port}/sandbox?token=viewer-session`)).toBe('rejected');
    expect(await wsOutcome(`ws://127.0.0.1:${port}/plugin-socket?token=operator-session`)).toBe('rejected');
    expect(opened).toEqual(['sandbox:user', 'sandbox/bot-2:user']);
    expect(provider.audits.filter(entry => entry.outcome === 'denied').map(entry => entry.action)).toContain('ws:/sandbox');
  });

  it('serves an open Host (no credential configured) on any host-authenticated socket', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    host.ws('/plugin-socket').onConnection((connection) => { connection.close(); });
    const { port } = await host.listen();
    expect(await wsOutcome(`ws://127.0.0.1:${port}/plugin-socket`)).toBe('opened');
  });

  it('allows a protocol-authenticated WS route to perform its own handshake', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0, token: 'host-token' });
    hosts.push(host);
    let connected = false;
    host.ws('/device/v1', { auth: 'protocol' }).onConnection((connection) => {
      connected = true;
      expect(connection.principal).toBeUndefined();
      connection.close(1000, 'protocol handshake test');
    });
    const { port } = await host.listen();

    await new Promise<void>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${port}/device/v1`);
      client.once('close', () => resolve());
      client.once('error', reject);
    });
    expect(connected).toBe(true);
  });

  it('close() resolves within 1s even with long-lived SSE and WS connections', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    // Not tracked in `hosts`: this test closes the host itself.
    host.route('GET', '/api/events', () => {
      // Mimic the Console SSE stream: headers flushed, response never ends.
      const stream = createResponseStream();
      stream.write(': connected\n\n');
      return new Response(stream.stream, {
        headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
      });
    });
    const sandbox = host.ws('/sandbox');
    sandbox.onConnection(() => { /* keep the socket open */ });
    const { port } = await host.listen();

    const sse = fetch(`http://127.0.0.1:${port}/api/events`).catch(() => undefined);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/sandbox`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    // Let the SSE response flush so the socket is definitively long-lived.
    await new Promise((resolve) => { setTimeout(resolve, 50); });

    const startedAt = Date.now();
    const closing = host.close();
    expect(host.close()).toBe(closing);
    await closing;
    expect(host.close()).toBe(closing);
    expect(Date.now() - startedAt).toBeLessThan(1_000);

    ws.once('close', () => undefined);
    await sse;
  });

  it('serves OpenAPI catalog and parses JSON bodies', async () => {
    // No credential configured: the Host is open before setup, so the unmapped route is reachable.
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    const { readJsonBody } = await import('../src/json-body.js');
    host.route('POST', '/api/echo', async (request, { principal }) => {
      const body = await readJsonBody<{ message?: string }>(request);
      return jsonResponse(200, { kind: principal?.kind, message: body?.message ?? null });
    }, { summary: 'Echo JSON', tags: ['echo'] });
    const { port } = await host.listen();

    const openapi = await fetch(`http://127.0.0.1:${port}/pub/openapi.json`);
    expect(openapi.status).toBe(200);
    const doc = await openapi.json() as {
      openapi: string;
      paths: Record<string, Record<string, { summary?: string; security?: unknown }>>;
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths['/pub/health']?.get).toBeTruthy();
    expect(doc.paths['/api/echo']?.post?.summary).toBe('Echo JSON');
    expect(doc.paths['/api/echo']?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(host.listRoutes().some((route) => route.pattern === '/api/echo')).toBe(true);

    const echo = await fetch(`http://127.0.0.1:${port}/api/echo`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: 'hi' }),
    });
    expect(echo.status).toBe(200);
    expect(await echo.json()).toEqual({ kind: 'bootstrap', message: 'hi' });
  });

  it('returns HttpBodyError status codes for handlers that do not catch them', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    const { readJsonBody } = await import('../src/json-body.js');
    // 模拟 console-rest-pages / console-api-installer 中未捕获 HttpBodyError 的端点。
    host.route('POST', '/api/body', async (request) => {
      const body = await readJsonBody(request, { limit: 16 });
      return jsonResponse(200, { body: body ?? null });
    });
    const { port } = await host.listen();

    // 超限：连接保留，客户端能实际收到 413 JSON（旧实现 destroy socket 后客户端收不到）。
    const tooLarge = await fetch(`http://127.0.0.1:${port}/api/body`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(1024) }),
    });
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({
      success: false,
      error: 'Request body exceeds 16 bytes',
    });

    // 非法 JSON：统一映射 400 而非 500 空响应。
    const invalid = await fetch(`http://127.0.0.1:${port}/api/body`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ success: false, error: 'Invalid JSON body' });

    // 正常小 body 仍可用（连接未被前两次请求破坏）。
    const ok = await fetch(`http://127.0.0.1:${port}/api/body`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ body: { a: 1 } });
  });

  it('never sends an unexpected handler error message or stack to the client', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    host.route('GET', '/boom', () => { throw new Error('secret detail from the handler'); });
    const { port } = await host.listen();
    const response = await fetch(`http://127.0.0.1:${port}/boom`);
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toBe('');
    expect(body).not.toContain('secret detail');
  });

  it('after setup checks every /api route against the permission map and rejects the bootstrap token', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0, token: 'full-token' });
    hosts.push(host);
    const provider = fakeProvider({ initialized: true });
    host.tokenRegistry.useAccessProvider(provider);
    const seen: unknown[] = [];
    for (const [method, path] of [['POST', '/api/console/request'], ['GET', '/api/system/status'], ['GET', '/api/secret'], ['POST', '/api/message/send'], ['GET', '/api/auth/me']] as const) {
      host.route(method, path, (_request, { principal }) => {
        seen.push(path);
        return jsonResponse(200, { kind: principal?.kind ?? null });
      });
    }
    const { port } = await host.listen();
    const call = (path: string, token?: string, method = 'GET') => fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    expect((await call('/api/system/status', 'full-token')).status).toBe(401);
    expect((await call('/api/console/request', 'full-token', 'POST')).status).toBe(401);
    expect(await (await call('/api/system/status', 'viewer-session')).json()).toEqual({ kind: 'user' });
    expect((await call('/api/console/request', 'viewer-session', 'POST')).status).toBe(200);
    const unmapped = await call('/api/secret', 'operator-session');
    expect(unmapped.status).toBe(403);
    expect(await unmapped.json()).toMatchObject({ code: 'forbidden', requestOutcome: 'not-dispatched' });
    expect((await call('/api/message/send', 'viewer-session', 'POST')).status).toBe(403);
    // Adapter-scoped endpoint.operate is not enough for a route without a knowable target.
    expect((await call('/api/message/send', 'scoped-session', 'POST')).status).toBe(403);
    expect((await call('/api/message/send', 'operator-session', 'POST')).status).toBe(200);
    expect(await (await call('/api/auth/me')).json()).toEqual({ kind: null });
    const invalid = await call('/api/system/status', 'invalid-token');
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toMatchObject({ requestOutcome: 'not-dispatched', code: 'unauthorized' });
    expect(seen).not.toContain('/api/secret');
    expect(provider.audits.filter(entry => entry.outcome === 'denied')).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: 'user:operator', action: 'http:GET /secret' }),
      expect.objectContaining({ actor: 'user:viewer', action: 'http:POST /message/send' }),
    ]));
  });

  it('keeps a Host without any credential open before setup', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    host.tokenRegistry.useAccessProvider(fakeProvider({ initialized: false }));
    host.route('GET', '/api/anything', (_request, { principal }) => jsonResponse(200, principal));
    const { port } = await host.listen();
    const response = await fetch(`http://127.0.0.1:${port}/api/anything`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: 'bootstrap', open: true });
  });

  it('proves only a matched admission rejection was not dispatched and preserves the 503 status', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 }); hosts.push(host);
    const admission = createGenerationAdmissionGate();
    const bound = bindGenerationAdmission<HttpHost>(host, admission), handler = vi.fn<HttpHandler>(() => new Response('unexpected'));
    bound.route('POST', '/mutation', handler);
    const store = new SnapshotStore(admissionState(admission));
    const { port } = await host.listen();
    vi.spyOn(admission, 'acquire').mockReturnValueOnce(undefined);
    const rejected = await fetch(`http://127.0.0.1:${port}/mutation`, { method: 'POST' });
    expect(rejected.status).toBe(503);
    expect(await rejected.json()).toEqual({ success: false, code: 'unavailable', requestOutcome: 'not-dispatched' });
    expect(handler).not.toHaveBeenCalled();
    await store.close();
  });

  it('injects the token-bound principal into handlers without accepting it from the body', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    host.tokenRegistry.useAccessProvider(fakeProvider({ initialized: true }));
    host.route('POST', '/api/message/send', async (request, { principal }) => jsonResponse(200, {
      principal: principal?.kind === 'user' ? `user:${principal.userId}` : null,
      body: await request.json(),
    }));
    const { port } = await host.listen();

    const result = await fetch(`http://127.0.0.1:${port}/api/message/send`, {
      method: 'POST',
      headers: { Authorization: 'Bearer operator-session', 'content-type': 'application/json' },
      body: JSON.stringify({ principalId: 'human:mallory' }),
    });
    expect(await result.json()).toEqual({
      principal: 'user:operator',
      body: { principalId: 'human:mallory' },
    });
  });

  it('shares one authentication state across a listener group', async () => {
    const group = createHttpHostGroup([{ host: '127.0.0.1', port: 0, token: 't' }, { host: '127.0.0.1', port: 0, token: 't' }]);
    hosts.push(group as never);
    group.tokenRegistry.useAccessProvider(fakeProvider({ initialized: true }));
    group.route('GET', '/api/system/status', () => new Response('ok'));
    await group.listen();
    for (const address of listHttpHostAddresses(group)) {
      const response = await fetch(`${address.origin}/api/system/status`, { headers: { Authorization: 'Bearer viewer-session' } });
      expect(response.status).toBe(200);
    }
  });
});

type FakeProvider = ConsoleAccessProvider & { state: { initialized: boolean }; audits: ConsoleAuditEntry[] };

/** Sessions: viewer (global viewer), operator (global operator), scoped (operator on adapter qq). */
function fakeProvider(state: { initialized: boolean }): FakeProvider {
  const audits: ConsoleAuditEntry[] = [];
  const user = (id: string, permissions: readonly string[], scope: ConsoleUserPrincipal['grants'][number]['scope'] = { kind: 'global' }): ConsoleUserPrincipal => ({
    kind: 'user', userId: id, username: id, displayName: id, credentialId: `${id}-session`,
    grants: [{ role: id, scope, permissions }], roles: [id],
  });
  const sessions: Record<string, ConsoleUserPrincipal> = {
    'viewer-session': user('viewer', CONSOLE_BUILTIN_ROLES.viewer.permissions),
    'operator-session': user('operator', CONSOLE_BUILTIN_ROLES.operator.permissions),
    'scoped-session': user('scoped', CONSOLE_BUILTIN_ROLES.operator.permissions, { kind: 'adapter', key: 'qq' }),
  };
  return {
    state,
    audits,
    initialized: () => state.initialized,
    authenticate: async token => sessions[token] ?? null,
    audit: entry => { audits.push(entry); },
  };
}

function wsOutcome(url: string): Promise<'opened' | 'rejected'> {
  return new Promise((resolve) => {
    const client = new WebSocket(url);
    client.once('open', () => { client.close(); resolve('opened'); });
    client.once('error', () => resolve('rejected'));
    setTimeout(() => resolve('rejected'), 1000);
  });
}

function httpsText(port: number, path: string, ca: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest({
      host: '127.0.0.1', port, path, ca, servername: 'localhost', method: 'GET',
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => response.statusCode === 200
        ? resolve(body) : reject(new Error(`HTTPS ${response.statusCode}: ${body}`)));
    });
    request.once('error', reject);
    request.end();
  });
}

function admissionState(gate: GenerationAdmissionGate): SnapshotState {
  return {
    root: rootPluginId(),
    tree: new Map(),
    config: new Map(),
    resources: new Map(),
    capabilities: new Map(),
    projections: new Map([[
      featureId('test.http-admission'),
      { [generationAdmissionSource]: [gate] },
    ]]),
  };
}

async function connectWebSocket(port: number, path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    socket.once('close', () => resolve());
    socket.once('error', reject);
  });
}

async function tcpConnect(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('error', reject);
  });
}
