import { describe, it, expect, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createHttpHost } from '@zhin.js/host-http';
import { DingTalkEndpoint } from '../src/endpoint.js';
import { resolveDingTalkConfig } from '../src/protocol.js';
import { bindTestEndpoint } from '../../test-utils/endpoint.js';

function setup(body: unknown, status = 200, networkFailure = false, mode: 'webhook' | 'stream' = 'webhook') {
  const attempts: string[] = [];
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('/auth/') || url.includes('/gettoken')) return { ok: true, status: 200, text: async () => '', json: async () => ({ errcode: 0, access_token: 'test', expires_in: 7200 }) };
    attempts.push(url);
    if (networkFailure) throw new Error('connection lost after request');
    return { ok: status === 200, status, text: async () => JSON.stringify(body), json: async () => body };
  });
  const endpoint = new DingTalkEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'dingtalk'),
    http: createHttpHost({ host: '127.0.0.1', port: 0 }),
    config: resolveDingTalkConfig({ id: 'test', appKey: 'app', appSecret: 'test', mode, apiBaseUrl: 'https://example.invalid' }), fetch,
  });
  const request = { conversation: { endpoint: { id: 'test', adapter: 'dingtalk' }, kind: 'group' as const, id: 'cid_test' }, payload: 'hello' };
  return { endpoint, request, attempts };
}

describe('dingtalk actual outbound receipt', () => {
  it('rejects native quote and base64 media before any request instead of confirming text fallback', async () => {
    for (const segment of [{ type: 'reply', data: { message_id: 'source' } }, { type: 'image', data: { media: { kind: 'base64', value: 'aGk=' } } }]) {
      const { endpoint, request, attempts } = setup({ errcode: 0, msgId: 'id' });
      await expect(endpoint.send({ ...request, payload: [{ type: 'text', data: { text: 'probe' } }, segment] })).rejects.toMatchObject({ code: 'unsupported_operation', disposition: 'not_sent' });
      expect(attempts).toHaveLength(0);
    }
  });
  it('does not send or switch APIs when the Stream session is missing or expired', async () => {
    const { endpoint, request, attempts } = setup({ errcode: 0, msgId: 'id' }, 200, false, 'stream');
    bindTestEndpoint(endpoint);
    endpoint.open();
    await expect(endpoint.send(request)).rejects.toMatchObject({ code: 'session_unavailable', disposition: 'not_sent' });
    await endpoint.admit({ conversationId: request.conversation.id, conversationType: '2', senderId: 'sender', msgId: 'source', msgtype: 'text', text: { content: 'probe' }, sessionWebhook: 'https://session.invalid', sessionWebhookExpiredTime: Date.now() - 1 });
    await expect(endpoint.send(request)).rejects.toMatchObject({ code: 'session_unavailable', disposition: 'not_sent' });
    expect(attempts).toHaveLength(0);
  });
  it.each([undefined, '', '   ', {}, 42])('does not fabricate an ID for %j', async (id) => {
    const { endpoint, request, attempts } = setup({ errcode: 0, msgId: id });
    await expect(endpoint.send(request)).rejects.toMatchObject({ code: 'delivery_unconfirmed', disposition: 'unknown' });
    expect(attempts).toHaveLength(1);
  });
  it('preserves a real ID', async () => {
    const id = 'real-platform-message';
    const { endpoint, request, attempts } = setup({ errcode: 0, msgId: id });
    await expect(endpoint.send(request)).resolves.toBe(id);
    expect(attempts).toHaveLength(1);
  });
  it('classifies lost network outcome without a second send', async () => {
    const { endpoint, request, attempts } = setup({}, 200, true);
    await expect(endpoint.send(request)).rejects.toMatchObject({ disposition: 'unknown' });
    expect(attempts).toHaveLength(1);
  });
  it('preserves explicit platform rejection', async () => {
    const { endpoint, request, attempts } = setup({ errcode: 400, errmsg: 'denied' }, 200);
    await expect(endpoint.send(request)).rejects.toMatchObject({ disposition: 'rejected' });
    expect(attempts).toHaveLength(1);
  });
});
