import { afterEach, expect, it, vi } from 'vitest';
import { createHttpHost } from '@zhin.js/host-http';
import { registerMessageSendRoutes } from '../../../src/plugin-runtime/console/message-send-routes.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function start(send = vi.fn(async () => ({ messageId: 'm-1', receipt: {} as never })), withIm = true) {
  const http = createHttpHost({ host: '127.0.0.1', port: 0, token: 'operator', tokens: [{ token: 'demo', scope: 'demo' }] });
  cleanups.push(() => http.close());
  registerMessageSendRoutes({ http, base: '/api', im: withIm ? { endpoints: { send } } : undefined });
  const { port } = await http.listen();
  const post = (body: unknown, token: string | null = 'operator') => fetch(`http://127.0.0.1:${port}/api/message/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { post, send };
}

const valid = { adapter: 'sandbox', endpoint: 'bot', id: '10001', type: 'group', content: 'hello' };

it('delivers through the ImRuntime endpoint send port', async () => {
  const f = await start();
  const response = await f.post(valid);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, data: { messageId: 'm-1' } });
  expect(f.send).toHaveBeenCalledWith({
    adapter: 'sandbox', endpointKey: 'bot', conversation: { kind: 'group', id: '10001' }, content: 'hello',
  });
});

it('defaults the conversation kind to private', async () => {
  const f = await start();
  const { type: _type, ...body } = valid;
  expect((await f.post(body)).status).toBe(200);
  expect(f.send.mock.calls[0]![0]).toMatchObject({ conversation: { kind: 'private', id: '10001' } });
});

it('requires Bearer authentication and full scope', async () => {
  const f = await start();
  expect((await f.post(valid, null)).status).toBe(401);
  expect((await f.post(valid, 'demo')).status).toBe(403);
  expect(f.send).not.toHaveBeenCalled();
});

it.each([
  [{ ...valid, adapter: '' }],
  [{ ...valid, endpoint: undefined }],
  [{ ...valid, id: '' }],
  [{ ...valid, type: 'guild' }],
  [{ ...valid, content: '' }],
  [[]],
])('rejects an invalid body %#', async (body) => {
  const f = await start();
  expect((await f.post(body)).status).toBe(400);
  expect(f.send).not.toHaveBeenCalled();
});

it('maps malformed JSON to 400', async () => {
  const f = await start();
  expect((await f.post('{oops')).status).toBe(400);
});

it('reports an unknown endpoint as 404 and a delivery failure as 502', async () => {
  const missing = await start(vi.fn(async () => { throw new Error('endpoint not found'); }));
  expect((await missing.post(valid)).status).toBe(404);
  const failed = await start(vi.fn(async () => { throw new Error('platform rejected'); }));
  const response = await failed.post(valid);
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ success: false, error: 'platform rejected' });
});

it('answers 503 when no IM runtime is attached', async () => {
  const f = await start(undefined, false);
  expect((await f.post(valid)).status).toBe(503);
});
