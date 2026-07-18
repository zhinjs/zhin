import { describe, expect, it, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createHttpHost } from '../src/http-host.js';

const hosts: Array<ReturnType<typeof createHttpHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('HttpHost', () => {
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
    await host.close();
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
});
