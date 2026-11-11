import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createHttpRouter } from '../src/http-host.js';
import { createNodeHttpListener, type NodeHttpListener } from '../src/node/index.js';

const listeners: NodeHttpListener[] = [];
afterEach(async () => {
  await Promise.all(listeners.splice(0).map((listener) => listener.close()));
});

describe('createNodeHttpListener', () => {
  it('feeds an arbitrary handler and writes upgrade refusals with headers', async () => {
    const listener = createNodeHttpListener({
      host: '127.0.0.1',
      port: 0,
      handle: async (request, info) => new Response(`${request.method} ${new URL(request.url).pathname} ${info.remoteAddress ? 'peer' : ''}`),
      upgrade: async () => ({ accepted: false, status: 503, headers: { 'Retry-After': '3', 'bad\nname': 'x' } }),
    });
    listeners.push(listener);
    const address = await listener.listen();
    expect(await (await fetch(`${address.origin}/x`)).text()).toBe('GET /x peer');
    const refusal = await new Promise<[number | undefined, string | undefined]>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
      socket.once('unexpected-response', (_request, response) => resolve([response.statusCode, response.headers['retry-after'] as string | undefined]));
      socket.once('open', () => reject(new Error('opened')));
      socket.once('error', reject);
    });
    expect(refusal).toEqual([503, '3']);
    await listener.close();
    expect(listener.address).toBeUndefined();
  });
});

describe('createHttpRouter options', () => {
  it('can omit the built-in public routes', async () => {
    const router = createHttpRouter({ builtinRoutes: false });
    expect(router.routeCount).toBe(0);
    expect((await router.handle(new Request('http://localhost/pub/health'))).status).toBe(404);
  });

  it('exposes Retry-After to Console origins', async () => {
    const router = createHttpRouter({ corsOrigins: ['http://console.local'] });
    const response = await router.handle(new Request('http://localhost/pub/health', { headers: { origin: 'http://console.local' } }));
    expect(response.headers.get('access-control-expose-headers')).toBe('Retry-After');
  });
});
