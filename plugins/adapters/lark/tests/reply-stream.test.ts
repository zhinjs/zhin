import { vi } from 'vitest';
import { createEndpointHarness } from '../../test-utils/endpoint.js';
import { createHttpHost } from '@zhin.js/host-http';
import { LarkEndpoint } from '../src/endpoint.js';
import { resolveLarkConfig } from '../src/protocol.js';
import type { EndpointStreamRequest } from 'zhin.js/adapter';

async function setup(streaming?: boolean, fail?: 'card' | 'message' | 'card-capacity') {
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const fetch = vi.fn(async (url: string, init?: { method?: string; body?: unknown }) => {
    const path = new URL(url).pathname;
    if (path.includes('/auth/')) return new Response(JSON.stringify({ code: 0, tenant_access_token: 'synthetic', expire: 7200 }));
    calls.push({ path, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body)) });
    if (fail === 'card-capacity' && path.endsWith('/cards')) return new Response(JSON.stringify({ code: 200860 }), { status: 400 });
    if (fail === 'card' && path.endsWith('/cards') || fail === 'message' && path.includes('/im/v1/messages')) throw new Error('connection lost');
    return new Response(JSON.stringify({ code: 0, data: path.endsWith('/cards') ? { card_id: 'card-1' }
      : path.includes('/im/v1/messages') ? { message_id: 'om-1' } : {} }));
  });
  const f = await createEndpointHarness(() => new LarkEndpoint({ id: 'lark-stream-fixture' as never,
    config: resolveLarkConfig({ id: 'fixture', appId: 'synthetic', appSecret: 'synthetic', apiBaseUrl: 'https://example.invalid/open-apis', streaming }),
    http: createHttpHost({ host: '127.0.0.1', port: 0 }), fetch,
  }), { name: 'lark', capabilities: ['inbound', 'outbound'], operations: ['recall'] });
  await f.start(); f.open();
  const lease = f.index.acquire(f.canonicalId);
  const request: EndpointStreamRequest = { conversation: { endpoint: { adapter: 'lark', id: f.canonicalId }, kind: 'group', id: 'oc-1' },
    format: 'markdown', prefix: [{ type: 'reply', data: { message_id: 'om-parent' } }, { type: 'mention', data: { target: 'ou-1' } }],
  };
  return { calls, fetch, lease, request, async close() { lease.release(); await f.stop(); } };
}

it('publishes one CardKit entity, updates full Markdown and closes streaming with a monotonic sequence', async () => {
  const s = await setup();
  try {
    expect(s.lease.streaming!.supports!({ conversation: s.request.conversation })).toBe(true);
    expect(s.lease.streaming!.supports!({ conversation: { ...s.request.conversation, threadId: 'topic' } })).toBe(false);
    expect(s.lease.streaming!.supports!({ conversation: { ...s.request.conversation, parent: { kind: 'channel', id: 'parent' } } })).toBe(false);
    const stream = s.lease.streaming!.open(s.request)!;
    expect(s.calls).toHaveLength(0);
    expect(await stream.write('**first')).toEqual({ status: 'sent', messageId: 'om-1', acceptedText: '**first' });
    await stream.write('**first second**'); await stream.finish('**first second**'); await stream.finish('**first second**');
    expect(s.calls.map(call => [call.method, call.path])).toEqual([
      ['POST', '/open-apis/cardkit/v1/cards'], ['POST', '/open-apis/im/v1/messages/om-parent/reply'],
      ['PUT', '/open-apis/cardkit/v1/cards/card-1/elements/zhin_reply/content'], ['PATCH', '/open-apis/cardkit/v1/cards/card-1/settings'],
    ]);
    const card = JSON.parse(String(s.calls[0].body.data));
    expect(card.config).toEqual({ streaming_mode: true, update_multi: true });
    expect(card.body.elements).toEqual([
      { tag: 'markdown', element_id: 'zhin_prefix', content: '<at id="ou-1"></at>' },
      { tag: 'markdown', element_id: 'zhin_reply', content: '**first' },
    ]);
    expect(s.calls[2].body).toEqual({ content: '**first second**', sequence: 1 });
    expect(s.calls[3].body).toEqual({ settings: '{"config":{"streaming_mode":false}}', sequence: 2 });
  } finally { await s.close(); }
});

it.each(['card', 'message'] as const)('never recreates or republishes after a %s outcome becomes uncertain', async fail => {
  const s = await setup(undefined, fail);
  try {
    const stream = s.lease.streaming!.open(s.request)!;
    await expect(stream.write('first')).rejects.toMatchObject({ disposition: fail === 'card' ? 'not_sent' : 'unknown' });
    const count = s.calls.length;
    await expect(stream.write('first again')).rejects.toBeDefined();
    await expect(stream.finish('first again')).rejects.toBeDefined();
    stream.cancel(); expect(s.calls).toHaveLength(count);
  } finally { await s.close(); }
});

it('keeps streaming off and cancels locally without publishing a hidden final frame', async () => {
  const off = await setup(false);
  try { expect(off.lease.streaming).toBeUndefined(); } finally { await off.close(); }
  const s = await setup();
  try {
    const stream = s.lease.streaming!.open(s.request)!;
    await stream.write('first'); stream.cancel();
    await expect(stream.finish('first')).rejects.toMatchObject({ code: 'stream_cancelled' });
    expect(s.calls).toHaveLength(2);
  } finally { await s.close(); }
});

it.each([200850, 200860])('rolls only the confirmed prefix after the platform rejects an update with %s', async code => {
  const s = await setup();
  try {
    const first = s.lease.streaming!.open({ ...s.request, format: 'text', prefix: [] })!;
    await first.write('confirmed');
    s.fetch.mockImplementationOnce(async (url, init) => {
      s.calls.push({ path: new URL(url).pathname, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ code }), { status: 400 });
    });
    expect(await first.write('confirmed tail')).toMatchObject({ status: 'sent', acceptedText: 'confirmed', exhausted: true });
    expect(await first.finish('confirmed')).toMatchObject({ status: 'sent', acceptedText: 'confirmed', exhausted: true });
    expect(s.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
    expect(s.calls.filter(call => call.method === 'PATCH')).toHaveLength(code === 200850 ? 0 : 1);
    const next = s.lease.streaming!.open({ ...s.request, format: 'text', prefix: [], continuation: { precedingText: 'confirmed' } })!;
    expect(await next.finish(' tail')).toMatchObject({ status: 'sent', acceptedText: ' tail' });
    const creates = s.calls.filter(call => call.path.endsWith('/cards'));
    expect(creates).toHaveLength(2);
    expect(JSON.parse(String(creates[1].body.data)).body.elements[0].content).toBe(' tail');
  } finally { await s.close(); }
});

it('keeps initial capacity rejection and a manually closed stream distinct from confirmed expiry', async () => {
  const tooLarge = await setup(undefined, 'card-capacity');
  try {
    const stream = tooLarge.lease.streaming!.open(tooLarge.request)!;
    await expect(stream.write('initial body')).rejects.toMatchObject({ disposition: 'not_sent' });
    await expect(stream.finish('initial body')).rejects.toMatchObject({ disposition: 'not_sent' });
    expect(tooLarge.calls).toHaveLength(1);
  } finally { await tooLarge.close(); }
  const closed = await setup();
  try {
    const stream = closed.lease.streaming!.open(closed.request)!;
    await stream.write('confirmed');
    closed.fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ code: 300309 }), { status: 400 }));
    await expect(stream.write('confirmed tail')).rejects.toMatchObject({ disposition: 'rejected' });
    const count = closed.fetch.mock.calls.length;
    await expect(stream.finish('confirmed tail')).rejects.toMatchObject({ disposition: 'rejected' });
    expect(closed.fetch).toHaveBeenCalledTimes(count);
  } finally { await closed.close(); }
});
