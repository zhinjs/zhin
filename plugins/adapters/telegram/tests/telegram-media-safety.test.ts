import { getEventListeners } from 'node:events';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { TelegramEndpoint, type TelegramFetch } from '../src/endpoint.js';
import { resolveTelegramConfig } from '../src/protocol.js';

const config = resolveTelegramConfig({ id: 'media-safety', token: '123:PRIVATE-BOT-TOKEN' });
const id = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'telegram');
const reference = {
  kind: 'media' as const,
  conversation: { endpoint: { id: 'telegram', adapter: 'telegram' }, kind: 'private' as const, id: '1' },
  media: { kind: 'file' as const, value: 'telegram-file-id', file_name: 'photo.jpg' },
};
const getFileResponse = {
  ok: true, status: 200,
  text: async () => JSON.stringify({ ok: true, result: { file_path: 'photos/private.jpg', file_size: 3 } }),
  json: async () => ({}),
};
const context = (signal: AbortSignal) => ({ signal, maxDepth: 0, maxEntries: 1, maxChars: 0 });

describe('Telegram credential-bearing file download boundary', () => {
  it.each(['headers', 'body'] as const)('bounds a stalled download %s and cancels the transport', async (phase) => {
    vi.useFakeTimers();
    let downloadSignal!: AbortSignal;
    const fetch = vi.fn<TelegramFetch>(async (url, init) => {
      if (url.endsWith('/getFile')) return getFileResponse;
      downloadSignal = init!.signal!;
      if (phase === 'headers') return new Promise(() => {});
      return {
        ok: true, status: 200, text: async () => '', json: async () => ({}),
        arrayBuffer: async () => new Promise(() => {}),
      };
    });
    const endpoint = new TelegramEndpoint({ id, config, fetch, requestTimeoutMs: 10 });
    const abort = new AbortController();
    try {
      const result = endpoint.content.resolve(reference, context(abort.signal));
      await vi.advanceTimersByTimeAsync(10);
      expect(await result).toEqual({ status: 'failed', code: 'telegram_file_resolution_failed', message: 'Telegram file resolution failed' });
      expect(downloadSignal.aborted).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(getEventListeners(abort.signal, 'abort')).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally { await endpoint.stop(); vi.useRealTimers(); }
  });

  it('returns a payload-free failure for errors containing the full bot token URL', async () => {
    const fetch = vi.fn<TelegramFetch>(async (url) => {
      if (url.endsWith('/getFile')) return getFileResponse;
      throw new Error(`failed downloading ${url}; private diagnostic payload`);
    });
    const endpoint = new TelegramEndpoint({ id, config, fetch });
    const result = await endpoint.content.resolve(reference, context(new AbortController().signal));
    expect(result).toEqual({ status: 'failed', code: 'telegram_file_resolution_failed', message: 'Telegram file resolution failed' });
    expect(JSON.stringify(result)).not.toContain(config.token);
    expect(JSON.stringify(result)).not.toContain('photos/private.jpg');
    expect(JSON.stringify(result)).not.toContain('private diagnostic payload');
    expect(fetch).toHaveBeenCalledTimes(2);
    await endpoint.stop();
  });

  it('expires the download when its turn is cancelled while the body is pending', async () => {
    let downloadSignal!: AbortSignal;
    const fetch: TelegramFetch = async (url, init) => {
      if (url.endsWith('/getFile')) return getFileResponse;
      downloadSignal = init!.signal!;
      return { ok: true, status: 200, text: async () => '', json: async () => ({}),
        arrayBuffer: async () => new Promise(() => {}),
      };
    };
    const endpoint = new TelegramEndpoint({ id, config, fetch });
    const abort = new AbortController();
    const result = endpoint.content.resolve(reference, context(abort.signal));
    await new Promise((resolve) => setImmediate(resolve));
    abort.abort();
    expect(await result).toEqual({ status: 'expired', code: 'turn_aborted' });
    expect(downloadSignal.aborted).toBe(true);
    expect(getEventListeners(abort.signal, 'abort')).toHaveLength(0);
    await endpoint.stop();
  });
});
