import { vi } from 'vitest';
import { slackFixture } from './fixture.js';
import { resolveSlackConfig } from '../src/protocol.js';
import type { EndpointStreamRequest } from 'zhin.js/adapter';
import { ErrorCode } from '@slack/web-api';

async function setup(streaming?: boolean) {
  const calls = { startStream: vi.fn(async (_args: unknown) => ({ ts: '1700000000.2' })),
    appendStream: vi.fn(async (_args: unknown) => ({})), stopStream: vi.fn(async (_args: unknown) => ({})) };
  const f = await slackFixture({ id: 'stream-fixture' as never,
    config: resolveSlackConfig({ id: 'fixture', token: 'synthetic', signingSecret: 'synthetic', socketMode: false, streaming }),
    http: (await import('@zhin.js/host-http')).createHttpHost({ host: '127.0.0.1', port: 0 }),
  }, () => ({ auth: { test: async () => ({ user_id: 'BOT' }) }, chat: calls }));
  await f.start(); f.open();
  const lease = f.index.acquire(f.canonicalId);
  const request: EndpointStreamRequest = { conversation: { endpoint: { adapter: 'slack', id: f.canonicalId },
    kind: 'group', id: 'C1', threadId: '1700000000.1' }, format: 'markdown',
    source: { senderId: 'U1', event: { team_id: 'T1' } },
    prefix: [{ type: 'mention', data: { target: 'U2' } }],
  };
  return { f, lease, request, calls, async close() { lease.release(); await f.stop(); } };
}

it('streams through the real Endpoint lease, retaining thread, recipients and a single mention prefix', async () => {
  const s = await setup();
  try {
    const stream = s.lease.streaming!.open(s.request)!;
    expect(s.calls.startStream).not.toHaveBeenCalled();
    expect(await stream.write('**hello')).toEqual({ status: 'sent', messageId: 'C1:1700000000.2', acceptedText: '**hello' });
    await stream.write('**hello world**'); await stream.finish('**hello world**');
    expect(s.calls.startStream).toHaveBeenCalledExactlyOnceWith({ channel: 'C1', thread_ts: '1700000000.1',
      recipient_team_id: 'T1', recipient_user_id: 'U1', chunks: [{ type: 'markdown_text', text: '<@U2>**hello' }] });
    expect(s.calls.appendStream).toHaveBeenCalledExactlyOnceWith({ channel: 'C1', ts: '1700000000.2',
      chunks: [{ type: 'markdown_text', text: ' world**' }] });
    expect(s.calls.stopStream).toHaveBeenCalledOnce();
  } finally { await s.close(); }
});

it('does not invent recipient information or move ordinary channel messages into a thread', async () => {
  const s = await setup();
  try {
    expect(s.lease.streaming!.supports!({ conversation: s.request.conversation, source: s.request.source })).toBe(true);
    expect(s.lease.streaming!.supports!({ conversation: s.request.conversation, source: { senderId: 'U1' } })).toBe(false);
    expect(s.lease.streaming!.open({ ...s.request, source: { senderId: 'U1' } })).toBeUndefined();
    const { threadId: _thread, ...conversation } = s.request.conversation;
    expect(s.lease.streaming!.open({ ...s.request, conversation })).toBeUndefined();
    expect(s.calls.startStream).not.toHaveBeenCalled();
  } finally { await s.close(); }
});

it('keeps off disabled and rejects further operations after its originating lease retires', async () => {
  const off = await setup(false);
  try { expect(off.lease.streaming).toBeUndefined(); } finally { await off.close(); }
  const s = await setup();
  try {
    const stream = s.lease.streaming!.open(s.request)!;
    await stream.write('first'); s.lease.release();
    await expect(stream.write('first again')).rejects.toMatchObject({ code: 'endpoint_inactive' });
    stream.cancel(); expect(s.calls.appendStream).not.toHaveBeenCalled(); expect(s.calls.stopStream).not.toHaveBeenCalled();
  } finally { await s.close(); }
});

it('rolls an expired native container using only its confirmed prefix, without retrying the rejected delta', async () => {
  const s = await setup();
  try {
    const first = s.lease.streaming!.open({ ...s.request, format: 'text' })!;
    await first.write('confirmed');
    s.calls.appendStream.mockRejectedValueOnce(Object.assign(new Error('platform rejected append'), {
      code: ErrorCode.PlatformError, data: { ok: false, error: 'message_not_in_streaming_state' },
    }));
    expect(await first.write('confirmed tail')).toEqual({ status: 'sent', messageId: 'C1:1700000000.2', acceptedText: 'confirmed', exhausted: true });
    expect(await first.finish('confirmed')).toMatchObject({ acceptedText: 'confirmed', exhausted: true });
    expect(s.calls.stopStream).not.toHaveBeenCalled();
    s.calls.startStream.mockResolvedValueOnce({ ts: '1700000000.3' });
    const next = s.lease.streaming!.open({ ...s.request, format: 'text', prefix: [], continuation: { precedingText: 'confirmed' } })!;
    expect(await next.finish(' tail')).toMatchObject({ messageId: 'C1:1700000000.3', acceptedText: ' tail' });
    expect(s.calls.startStream).toHaveBeenCalledTimes(2);
    expect(s.calls.startStream.mock.calls[1]![0]).toMatchObject({ channel: 'C1', thread_ts: '1700000000.1',
      recipient_team_id: 'T1', recipient_user_id: 'U1', chunks: [{ type: 'markdown_text', text: ' tail' }] });
    expect(s.calls.appendStream).toHaveBeenCalledTimes(1);
    expect(s.calls.stopStream).toHaveBeenCalledTimes(1);
  } finally { await s.close(); }
});

it('accepts platform auto-finalization at stop without issuing another stop or losing the confirmed text', async () => {
  const s = await setup();
  try {
    const stream = s.lease.streaming!.open(s.request)!;
    await stream.write('confirmed');
    s.calls.stopStream.mockRejectedValueOnce(Object.assign(new Error('already finalized'), {
      code: ErrorCode.PlatformError, data: { ok: false, error: 'message_not_in_streaming_state' },
    }));
    expect(await stream.finish('confirmed')).toMatchObject({ acceptedText: 'confirmed', exhausted: true });
    await stream.finish('confirmed');
    expect(s.calls.stopStream).toHaveBeenCalledOnce();
  } finally { await s.close(); }
});

it('does not turn an unknown append or an unconfirmed start into an expired-container rollover', async () => {
  const s = await setup();
  try {
    s.calls.startStream.mockRejectedValueOnce(Object.assign(new Error('no original identity'), {
      code: ErrorCode.PlatformError, data: { ok: false, error: 'message_not_in_streaming_state' },
    }));
    const noIdentity = s.lease.streaming!.open(s.request)!;
    await expect(noIdentity.write('not confirmed')).rejects.toMatchObject({ disposition: 'rejected' });
    await expect(noIdentity.finish('not confirmed')).rejects.toMatchObject({ disposition: 'rejected' });
    expect(s.calls.startStream).toHaveBeenCalledOnce();
    const unknown = s.lease.streaming!.open(s.request)!;
    await unknown.write('confirmed');
    s.calls.appendStream.mockRejectedValueOnce(new Error('socket lost'));
    await expect(unknown.write('confirmed tail')).rejects.toMatchObject({ disposition: 'unknown' });
    await expect(unknown.finish('confirmed tail')).rejects.toMatchObject({ disposition: 'unknown' });
    expect(s.calls.startStream).toHaveBeenCalledTimes(2);
    expect(s.calls.appendStream).toHaveBeenCalledOnce();
    expect(s.calls.stopStream).not.toHaveBeenCalled();
  } finally { await s.close(); }
});

it('reports an oversized first Markdown container as not sent without attempting a native request', async () => {
  const s = await setup();
  try {
    const stream = s.lease.streaming!.open({ ...s.request, prefix: [] })!;
    await expect(stream.finish('x'.repeat(12_001))).rejects.toMatchObject({ code: 'stream_capacity', disposition: 'not_sent' });
    expect(s.calls.startStream).not.toHaveBeenCalled();
    expect(s.calls.appendStream).not.toHaveBeenCalled();
    expect(s.calls.stopStream).not.toHaveBeenCalled();
  } finally { await s.close(); }
});
