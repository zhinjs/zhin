import { vi } from 'vitest';
import { createSlackNativeStream } from '../src/native-stream.js';

function client() {
  return {
    startStream: vi.fn(async () => ({ ok: true, ts: '1700000000.001' })),
    appendStream: vi.fn(async () => ({ ok: true })),
    stopStream: vi.fn(async () => ({ ok: true })),
  };
}
const target = { channel: 'C1', thread_ts: '1700000000.000', recipient_user_id: 'U1', recipient_team_id: 'T1' };

it('starts once, appends only new Markdown, and finalizes the same native message once', async () => {
  const chat = client(), stream = createSlackNativeStream(chat, target);
  expect(await stream.append({ markdown_text: '**hello' })).toBe('1700000000.001');
  expect(await stream.append({ markdown_text: ' world**' })).toBe('1700000000.001');
  expect(chat.startStream).toHaveBeenCalledExactlyOnceWith({ ...target, markdown_text: '**hello' });
  expect(chat.appendStream).toHaveBeenCalledExactlyOnceWith({ channel: 'C1', ts: '1700000000.001', markdown_text: ' world**' });
  await stream.stop(); await stream.stop();
  expect(chat.stopStream).toHaveBeenCalledExactlyOnceWith({ channel: 'C1', ts: '1700000000.001' });
});

it('keeps rich chunks mode when complete blocks follow Markdown chunks', async () => {
  const chat = client(), stream = createSlackNativeStream(chat, target);
  await stream.append({ chunks: [{ type: 'markdown_text', text: 'first' }] });
  await stream.append({ chunks: [{ type: 'blocks', blocks: [{ type: 'divider' }] }] });
  await expect(stream.append({ markdown_text: 'mode switch' })).rejects.toMatchObject({ code: 'invalid_payload', disposition: 'not_sent' });
  expect(chat.startStream).toHaveBeenCalledExactlyOnceWith({ ...target, chunks: [{ type: 'markdown_text', text: 'first' }] });
  expect(chat.appendStream).toHaveBeenCalledExactlyOnceWith({ channel: 'C1', ts: '1700000000.001',
    chunks: [{ type: 'blocks', blocks: [{ type: 'divider' }] }],
  });
  await stream.stop();
});

it('never starts a replacement or retries after the first request outcome becomes unknown', async () => {
  const chat = client(); chat.startStream.mockRejectedValueOnce(new Error('connection lost'));
  const stream = createSlackNativeStream(chat, target);
  await expect(stream.append({ markdown_text: 'first' })).rejects.toMatchObject({ disposition: 'unknown' });
  await expect(stream.append({ markdown_text: 'again' })).rejects.toMatchObject({ disposition: 'unknown' });
  await expect(stream.stop()).rejects.toMatchObject({ disposition: 'unknown' });
  expect(chat.startStream).toHaveBeenCalledOnce();
  expect(chat.appendStream).not.toHaveBeenCalled(); expect(chat.stopStream).not.toHaveBeenCalled();
});

it('does not invent a stream id from a successful but incomplete response', async () => {
  const chat = client(); chat.startStream.mockResolvedValueOnce({ ok: true, ts: '' });
  const stream = createSlackNativeStream(chat, target);
  await expect(stream.append({ markdown_text: 'first' })).rejects.toMatchObject({ disposition: 'unknown' });
  expect(stream.messageTs).toBeUndefined();
  await expect(stream.stop()).rejects.toMatchObject({ disposition: 'unknown' });
  expect(chat.stopStream).not.toHaveBeenCalled();
});

it('does not send a placeholder on creation or a terminal request before any content', async () => {
  const chat = client(), stream = createSlackNativeStream(chat, target);
  expect(chat.startStream).not.toHaveBeenCalled();
  await stream.stop(); expect(chat.stopStream).not.toHaveBeenCalled();
});
