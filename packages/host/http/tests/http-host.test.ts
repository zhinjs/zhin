import { describe, expect, it, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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
import { createHttpHost, type HttpHost } from '../src/http-host.js';

const hosts: Array<ReturnType<typeof createHttpHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('HttpHost', () => {
  it('serves authenticated HTTPS health and WSS routes with explicit secure address metadata', async () => {
    const key = readFileSync(new URL('./fixtures/localhost-key.pem', import.meta.url));
    const cert = readFileSync(new URL('./fixtures/localhost-cert.pem', import.meta.url));
    const host = createHttpHost({ host: '127.0.0.1', port: 0, tls: {key, cert} });
    hosts.push(host);
    host.ws('/secure').onConnection(({socket}) => socket.send('secure'));
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
    previousHost.route('GET', '/generation', (_request, response) => response.end('previous'));
    previousHost.ws('/generation').onConnection(({ socket }) => {
      wsSeen.push('previous');
      socket.close();
    });
    const store = new SnapshotStore(admissionState(previous));
    const { port } = await host.listen();

    nextHost.route('GET', '/generation', (_request, response) => response.end('next'));
    nextHost.ws('/generation').onConnection(({ socket }) => {
      wsSeen.push('next');
      socket.close();
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

  it('pins HTTP responses and retires WebSockets when their generation is replaced', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    const previous = createGenerationAdmissionGate();
    const next = createGenerationAdmissionGate();
    const previousHost = bindGenerationAdmission<HttpHost>(host, previous);
    let releaseHttp!: () => void;
    const httpGate = new Promise<void>((resolve) => { releaseHttp = resolve; });
    let enteredHttp!: () => void;
    const httpEntered = new Promise<void>((resolve) => { enteredHttp = resolve; });
    previousHost.route('GET', '/slow', async (_request, response) => {
      enteredHttp();
      await httpGate;
      response.end('done');
    });
    previousHost.ws('/slow').onConnection(() => undefined);
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

    await new Promise<void>((resolve) => ws.once('close', () => resolve()));
    expect(disposed).toBe(false);

    releaseHttp();
    expect(await (await http).text()).toBe('done');
    await vi.waitFor(() => expect(disposed).toBe(true));
    await store.close();
  });

  it('keeps a generation leased until a streaming response closes', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    const previous = createGenerationAdmissionGate();
    const next = createGenerationAdmissionGate();
    const previousHost = bindGenerationAdmission<HttpHost>(host, previous);
    let response!: import('node:http').ServerResponse;
    let started!: () => void;
    const streamStarted = new Promise<void>((resolve) => { started = resolve; });
    previousHost.route('GET', '/stream', (_request, current) => {
      response = current;
      current.writeHead(200, { 'content-type': 'text/event-stream' });
      current.write('data: ready\n\n');
      started();
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
    response.end();
    await request;
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
    host.route('GET', '/console/api/pages', (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"pages":[]}');
    });
    host.route('GET', '/assets/client/*', (_request, response, url) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(url.pathname);
    });
    const { port } = await host.listen();

    const pages = await fetch(`http://127.0.0.1:${port}/console/api/pages`);
    expect(pages.status).toBe(200);
    expect(await pages.json()).toEqual({ pages: [] });

    const asset = await fetch(`http://127.0.0.1:${port}/assets/client/demo.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('/assets/client/demo.js');

    const missing = await fetch(`http://127.0.0.1:${port}/missing`);
    expect(missing.status).toBe(404);
  });

  it('normalizes trailing slashes when matching routes', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    host.route('GET', '/console/api/pages', (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"pages":[]}');
    });
    const { port } = await host.listen();

    const pages = await fetch(`http://127.0.0.1:${port}/console/api/pages///`);
    expect(pages.status).toBe(200);
  });

  it('handles paths with long slash runs in linear time (no ReDoS)', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    host.route('GET', '/console/api/pages', (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"pages":[]}');
    });
    const { port } = await host.listen();

    // 中段长串 `/` 不以字符串结尾：旧正则 /\/+$/ 在此呈二次方回溯。
    const path = `/x${'/'.repeat(8_000)}tail`;
    const start = performance.now();
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    expect(performance.now() - start).toBeLessThan(100);
    expect(response.status).toBe(404);
  });

  it('serves /pub/health without auth and protects /api when token is configured', async () => {
    const host = createHttpHost({
      host: '127.0.0.1',
      port: 0,
      token: 'secret-full-token',
      corsOrigins: ['https://example.test'],
    });
    hosts.push(host);
    host.route('GET', '/api/secure', (_request, response, _url, scope) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ scope }));
    });
    const { port } = await host.listen();

    const health = await fetch(`http://127.0.0.1:${port}/pub/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ success: true, status: 'ok' });

    const denied = await fetch(`http://127.0.0.1:${port}/api/secure`);
    expect(denied.status).toBe(401);

    const allowed = await fetch(`http://127.0.0.1:${port}/api/secure`, {
      headers: { Authorization: 'Bearer secret-full-token' },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ scope: 'full' });

    const preflight = await fetch(`http://127.0.0.1:${port}/api/secure`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.test' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://example.test');
  });

  it('requires WS token when registry is configured and accepts query token for sandbox', async () => {
    const host = createHttpHost({
      host: '127.0.0.1',
      port: 0,
      token: 'secret-full-token',
      tokens: [{ token: 'demo-token', scope: 'demo' }],
    });
    hosts.push(host);
    const sandbox = host.ws('/sandbox');
    const other = host.ws('/other');
    const scopes: string[] = [];
    sandbox.onConnection((connection) => { scopes.push(`sandbox:${connection.authScope}`); });
    other.onConnection((connection) => { scopes.push(`other:${connection.authScope}`); });
    const { port } = await host.listen();

    await expect(new Promise<void>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${port}/sandbox`);
      client.once('open', () => reject(new Error('unexpected open without token')));
      client.once('error', () => resolve());
      setTimeout(() => reject(new Error('timeout')), 1000);
    })).resolves.toBeUndefined();

    await new Promise<void>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${port}/sandbox?token=demo-token`);
      client.once('open', () => {
        client.close();
      });
      client.once('close', () => resolve());
      client.once('error', reject);
    });
    expect(scopes).toContain('sandbox:demo');

    await expect(new Promise<void>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${port}/other?token=demo-token`);
      client.once('open', () => reject(new Error('demo must not open non-sandbox')));
      client.once('error', () => resolve());
      setTimeout(() => reject(new Error('timeout')), 1000);
    })).resolves.toBeUndefined();
  });

  it('allows a protocol-authenticated WS route to perform its own handshake', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0, token: 'host-token' });
    hosts.push(host);
    let connected = false;
    host.ws('/device/v1', { auth: 'protocol' }).onConnection(({ socket }) => {
      connected = true;
      socket.close(1000, 'protocol handshake test');
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
    host.route('GET', '/api/events', (_request, response) => {
      // Mimic the Console SSE stream: headers flushed, response never ends.
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
      });
      response.write(': connected\n\n');
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
    const host = createHttpHost({ host: '127.0.0.1', port: 0, token: 'secret' });
    hosts.push(host);
    const { readJsonBody } = await import('../src/json-body.js');
    host.route('POST', '/api/echo', async (request, response, _url, scope) => {
      const body = await readJsonBody<{ message?: string }>(request);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ scope, message: body?.message ?? null }));
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
    expect(await echo.json()).toEqual({ scope: 'full', message: 'hi' });
  });

  it('returns HttpBodyError status codes for handlers that do not catch them', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(host);
    const { readJsonBody } = await import('../src/json-body.js');
    // 模拟 console-rest-pages / console-api-installer 中未捕获 HttpBodyError 的端点。
    host.route('POST', '/api/body', async (request, response) => {
      const body = await readJsonBody(request, { limit: 16 });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ body: body ?? null }));
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

  it('allows demo scope on console RPC path and rejects other /api routes', async () => {
    const host = createHttpHost({
      host: '127.0.0.1',
      port: 0,
      token: 'full-token',
      tokens: [{ token: 'demo-token', scope: 'demo' }],
    });
    hosts.push(host);
    host.route('POST', '/api/console/request', (_request, response, _url, scope) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ scope }));
    });
    host.route('GET', '/api/secret', (_request, response) => {
      response.writeHead(200);
      response.end('nope');
    });
    const { port } = await host.listen();

    const ok = await fetch(`http://127.0.0.1:${port}/api/console/request`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer demo-token',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ scope: 'demo' });

    const denied = await fetch(`http://127.0.0.1:${port}/api/secret`, {
      headers: { Authorization: 'Bearer demo-token' },
    });
    expect(denied.status).toBe(401);
  });

  it('injects the token-bound principal into handlers without accepting it from the body', async () => {
    const host = createHttpHost({
      host: '127.0.0.1',
      port: 0,
      tokens: [{ token: 'sponsor-token', scope: 'full', principalId: 'human:alice' }],
    });
    hosts.push(host);
    host.route('POST', '/api/sponsor', async (request, response, _url, _scope, principal) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ principal, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    const { port } = await host.listen();

    const result = await fetch(`http://127.0.0.1:${port}/api/sponsor`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sponsor-token', 'content-type': 'application/json' },
      body: JSON.stringify({ principalId: 'human:mallory' }),
    });
    expect(await result.json()).toEqual({
      principal: { principalId: 'human:alice', scope: 'full' },
      body: { principalId: 'human:mallory' },
    });
  });
});

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
