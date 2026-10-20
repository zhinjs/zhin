import { describe, it, expect, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createHttpHost } from '@zhin.js/host-http';
import { LarkEndpoint } from '../src/endpoint.js';
import { formatOutboundBody, resolveLarkConfig } from '../src/protocol.js';

function setup(body: unknown, status = 200, networkFailure = false) {
  const attempts: string[] = [];
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('/auth/') || url.includes('/gettoken')) return { ok: true, status: 200, text: async () => '', json: async () => ({ code: 0, tenant_access_token: 'test', expire: 7200 }) };
    attempts.push(url);
    if (networkFailure) throw new Error('connection lost after request');
    return { ok: status === 200, status, text: async () => JSON.stringify(body), json: async () => body };
  });
  const endpoint = new LarkEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'lark'),
    http: createHttpHost({ host: '127.0.0.1', port: 0 }),
    config: resolveLarkConfig({ id: 'test', appId: 'app', appSecret: 'test', apiBaseUrl: 'https://example.invalid' }), fetch,
  });
  const request = { conversation: { endpoint: { id: 'test', adapter: 'lark' }, kind: 'group' as const, id: 'oc_test' }, payload: 'hello' };
  return { endpoint, request, attempts };
}

describe('lark actual outbound receipt', () => {
  it.each([undefined, '', '   ', {}, 42])('does not fabricate an ID for %j', async (id) => {
    const { endpoint, request, attempts } = setup({ code: 0, data: { message_id: id } });
    await expect(endpoint.send(request)).rejects.toMatchObject({ code: 'delivery_unconfirmed', disposition: 'unknown' });
    expect(attempts).toHaveLength(1);
  });
  it('preserves a real ID', async () => {
    const id = 'real-platform-message';
    const { endpoint, request, attempts } = setup({ code: 0, data: { message_id: id } });
    await expect(endpoint.send(request)).resolves.toBe(id);
    expect(attempts).toHaveLength(1);
  });
  it('classifies lost network outcome without a second send', async () => {
    const { endpoint, request, attempts } = setup({}, 200, true);
    await expect(endpoint.send(request)).rejects.toMatchObject({ disposition: 'unknown' });
    expect(attempts).toHaveLength(1);
  });
  it('preserves explicit platform rejection', async () => {
    const { endpoint, request, attempts } = setup({ code: 400, msg: 'denied' }, 200);
    await expect(endpoint.send(request)).rejects.toMatchObject({ disposition: 'rejected' });
    expect(attempts).toHaveLength(1);
  });
  it.each([401, 403, 429])('classifies HTTP %s as rejected without exposing response text', async (status) => {
    const { endpoint, request, attempts } = setup({ code: 99991672, msg: 'private token=secret; raw body' }, status);
    const error = await endpoint.send(request).catch((error) => error);
    expect(error).toMatchObject({ disposition: 'rejected', status, platformCode: 99991672 });
    expect(error.message).not.toContain('secret');
    expect(error.message).not.toContain('raw body');
    expect(attempts).toHaveLength(1);
  });
  it.each([408, 500, 502, 503])('keeps HTTP %s uncertain without automatic resend', async (status) => {
    const { endpoint, request, attempts } = setup({}, status);
    await expect(endpoint.send(request)).rejects.toMatchObject({ disposition: 'unknown', status });
    expect(attempts).toHaveLength(1);
  });

  it('maps canonical reply to the platform reply route and removes its text placeholder', async () => {
    const { endpoint, request, attempts } = setup({ code: 0, data: { message_id: 'om_reply' } });
    const payload = [{ type: 'reply', data: { message_id: 'om_parent/unsafe' } }, { type: 'text', data: { text: 'answer' } }];
    await expect(endpoint.send({ ...request, payload })).resolves.toBe('om_reply');
    expect(attempts).toEqual(['https://example.invalid/im/v1/messages/om_parent%2Funsafe/reply']);
    expect(formatOutboundBody(payload)).toEqual({ replyTo: 'om_parent/unsafe', msg_type: 'text', content: '{"text":"answer"}' });
  });
  it('does not confirm an image whose successful upload response lacks a key', async () => {
    const { endpoint, request, attempts } = setup({ code: 0, data: {} });
    await expect(endpoint.send({ ...request, payload: [{ type: 'image', data: { media: { kind: 'base64', value: 'QUJD', mime_type: 'image/png' } } }] })).rejects.toMatchObject({ disposition: 'unknown' });
    expect(attempts).toEqual(['https://example.invalid/im/v1/images']);
  });

  it('preserves ordered text and multiple images in a native post with optional reply', () => {
    const body = formatOutboundBody([
      { type: 'reply', data: { message_id: 'om_parent' } },
      { type: 'text', data: { text: 'acceptance:image' } },
      { type: 'image', data: { media: { kind: 'file', value: 'img_first' } } },
      { type: 'text', data: { text: 'between' } },
      { type: 'image', data: { media: { kind: 'file', value: 'img_second' } } },
    ]);
    expect(body.msg_type).toBe('post');
    expect(body.replyTo).toBe('om_parent');
    expect(JSON.parse(body.content)).toEqual({ zh_cn: { title: '', content: [
      [{ tag: 'text', text: 'acceptance:image' }],
      [{ tag: 'img', image_key: 'img_first' }],
      [{ tag: 'text', text: 'between' }],
      [{ tag: 'img', image_key: 'img_second' }],
    ] } });
  });

});
