import { describe, it, expect, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createHttpHost } from '@zhin.js/host-http';
import { LineEndpoint } from '../src/endpoint.js';
import { resolveLineConfig } from '../src/protocol.js';

function setup(body: unknown, status = 200, networkFailure = false) {
  const attempts: string[] = [];
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('/auth/') || url.includes('/gettoken')) return { ok: true, status: 200, text: async () => '', json: async () => ({ errcode: 0, access_token: 'test', expires_in: 7200 }) };
    attempts.push(url);
    if (networkFailure) throw new Error('connection lost after request');
    return { ok: status === 200, status, text: async () => JSON.stringify(body), json: async () => body };
  });
  const endpoint = new LineEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'line'),
    http: createHttpHost({ host: '127.0.0.1', port: 0 }),
    config: resolveLineConfig({ id: 'test', channelAccessToken: 'test', channelSecret: 'test', apiBaseUrl: 'https://example.invalid' }), fetch,
  });
  const request = { conversation: { endpoint: { id: 'test', adapter: 'line' }, kind: 'group' as const, id: 'Utest' }, payload: 'hello' };
  return { endpoint, request, attempts };
}

describe('line actual outbound receipt', () => {
  it.each([undefined, '', '   ', {}, 42])('does not fabricate an ID for %j', async (id) => {
    const { endpoint, request, attempts } = setup({ sentMessages: [{ id }] });
    await expect(endpoint.send(request)).rejects.toMatchObject({ code: 'delivery_unconfirmed', disposition: 'unknown' });
    expect(attempts).toHaveLength(1);
  });
  it('preserves a real ID', async () => {
    const id = 'real-platform-message';
    const { endpoint, request, attempts } = setup({ sentMessages: [{ id }] });
    await expect(endpoint.send(request)).resolves.toBe(id);
    expect(attempts).toHaveLength(1);
  });
  it('classifies lost network outcome without a second send', async () => {
    const { endpoint, request, attempts } = setup({}, 200, true);
    await expect(endpoint.send(request)).rejects.toMatchObject({ disposition: 'unknown' });
    expect(attempts).toHaveLength(1);
  });
  it('preserves explicit platform rejection', async () => {
    const { endpoint, request, attempts } = setup({ message: 'denied' }, 400);
    await expect(endpoint.send(request)).rejects.toMatchObject({ disposition: 'rejected' });
    expect(attempts).toHaveLength(1);
  });
});

it('treats a LINE error carrying sentMessages as partial unknown', async () => {
  const { endpoint, request, attempts } = setup({ message: 'partial error', sentMessages: [{ id: 'already-sent' }] }, 400);
  await expect(endpoint.send(request)).rejects.toMatchObject({ disposition: 'unknown' });
  expect(attempts).toHaveLength(1);
});

it('rejects an invalid recipient before any request', async () => {
  const { endpoint, request, attempts } = setup({});
  await expect(endpoint.send({ ...request, conversation: { ...request.conversation, id: 'invalid' } })).rejects.toMatchObject({ disposition: 'not_sent' });
  expect(attempts).toHaveLength(0);
});
