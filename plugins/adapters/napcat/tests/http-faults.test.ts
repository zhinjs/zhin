import { afterEach, expect, it, vi } from 'vitest';
import { callNapCatHttpAction } from '../src/protocol.js';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each([401, 429, 500])('propagates HTTP %i without resending', async (status) => {
  const fetch = vi.fn(async () => ({ status, text: async () => 'rejected' }));
  vi.stubGlobal('fetch', fetch);
  await expect(callNapCatHttpAction({ http_url: 'http://localhost:3000' }, 'send_private_msg')).rejects.toThrow();
  expect(fetch).toHaveBeenCalledOnce();
});
it('bounds requests with a deadline signal and does not retry after a transport failure', async () => {
  let captured: AbortSignal | undefined;
  const fetch = vi.fn(async (_url: unknown, options: { signal: AbortSignal }) => {
    captured = options.signal;
    throw new Error('connection reset');
  });
  vi.stubGlobal('fetch', fetch);
  await expect(callNapCatHttpAction({ http_url: 'http://localhost:3000' }, 'send_private_msg')).rejects.toThrow('connection reset');
  expect(captured).toBeInstanceOf(AbortSignal);
  expect(fetch).toHaveBeenCalledOnce();
});
