import { afterEach, expect, it, vi } from 'vitest';
import { withTestUsers } from '../utils/console-users.js';
import { createHttpHost } from '@zhin.js/host-http/node';
import { CONSOLE_ERROR_ID_PATTERN, CONSOLE_SEND_FAILURE_MESSAGES, isConsoleApiErrorBody } from '@zhin.js/console-protocol';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { registerMessageSendRoutes } from '../../../src/instance/console/message-send-routes.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function start(send = vi.fn(async () => ({ messageId: 'm-1', receipt: {} as never })), withIm = true) {
  const http = withTestUsers(createHttpHost({ host: '127.0.0.1', port: 0 }), { operator: 'owner', demo: 'none' });
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
  // The platform's failure detail is logged, not returned; the body carries a log correlation id.
  const body = await response.json();
  expect(body).toEqual({ success: false, code: 'internal_error', error: 'Internal error', errorId: expect.stringMatching(CONSOLE_ERROR_ID_PATTERN) });
  expect(JSON.stringify(body)).not.toContain('platform rejected');
});

it('answers an expected delivery failure with a classified code and a Chinese reason (#1250)', async () => {
  const failed = await start(vi.fn(async () => {
    throw new EndpointDeliveryError('sandbox_delivery_unavailable', 'no sandbox tab is subscribed to sandbox-user', 'not_sent', {
      receipt: { status: 'failed', failure: { code: 'sandbox_delivery_unavailable', message: 'x', retryable: false } } as never,
    });
  }));
  const response = await failed.post({ ...valid, adapter: 'sandbox', type: 'private', id: 'sandbox-user' });
  expect(response.status).toBe(502);
  const body = await response.json();
  expect(body).toEqual({
    success: false,
    code: 'delivery_failed',
    error: CONSOLE_SEND_FAILURE_MESSAGES.no_live_client,
    data: { code: 'sandbox_delivery_unavailable', reason: 'no_live_client', status: 'failed' },
  });
  expect(isConsoleApiErrorBody(body)).toBe(true);
  expect(JSON.stringify(body)).not.toContain('subscribed');

  const missing = await start(vi.fn(async () => { throw new Error('endpoint not found'); }));
  expect(await (await missing.post(valid)).json()).toMatchObject({
    code: 'endpoint_not_found', data: { reason: 'endpoint_not_found' }, error: CONSOLE_SEND_FAILURE_MESSAGES.endpoint_not_found,
  });

  const unknown = await start(vi.fn(async () => { throw new EndpointDeliveryError('delivery_unconfirmed', 'timeout', 'unknown'); }));
  expect(await (await unknown.post(valid)).json()).toMatchObject({ code: 'delivery_failed', data: { reason: 'delivery_unknown', status: 'unknown' } });
});

it('names the invalid argument in a structured 400', async () => {
  const f = await start();
  expect(await (await f.post({ ...valid, type: 'guild' })).json()).toMatchObject({ success: false, code: 'invalid_argument', error: expect.stringContaining('参数不合法') });
});

it('answers 503 when no IM runtime is attached', async () => {
  const f = await start(undefined, false);
  expect((await f.post(valid)).status).toBe(503);
});
