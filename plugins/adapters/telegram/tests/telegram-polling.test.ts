import { getEventListeners } from 'node:events';
import { runTelegramPollLoop, type TelegramPollingHost } from '../src/polling.js';
import type { TelegramUpdate } from '../src/protocol.js';

function createHost(callApi: TelegramPollingHost['callApi']): TelegramPollingHost {
  return {
    allowedUpdates: [], callApi,
    getUpdateOffset: () => 0,
    setUpdateOffset: vi.fn(),
    handleUpdate: vi.fn(),
  };
}

describe('Telegram polling cancellation', () => {
  it('does not dispatch or acknowledge a batch that resolves after stop', async () => {
    const abort = new AbortController();
    let resolve!: (updates: TelegramUpdate[]) => void;
    const pending = new Promise<TelegramUpdate[]>((done) => { resolve = done; });
    const host = createHost(vi.fn().mockReturnValue(pending));
    const loop = runTelegramPollLoop(host, abort.signal);
    abort.abort();
    resolve([{ update_id: 123 }]);
    await loop;
    expect(host.handleUpdate).not.toHaveBeenCalled();
    expect(host.setUpdateOffset).not.toHaveBeenCalled();
    expect(host.callApi).toHaveBeenCalledTimes(1);
  });

  it('stops between updates when delivery cancels the endpoint', async () => {
    const abort = new AbortController();
    const host = createHost(vi.fn().mockResolvedValue([{ update_id: 123 }, { update_id: 124 }]));
    host.handleUpdate = vi.fn(() => abort.abort());
    await runTelegramPollLoop(host, abort.signal);
    expect(host.handleUpdate).toHaveBeenCalledTimes(1);
    expect(host.setUpdateOffset).toHaveBeenCalledExactlyOnceWith(124);
  });

  it('releases retry listeners and cancels backoff without another request', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const host = createHost(vi.fn().mockRejectedValue(new Error('offline')));
    const loop = runTelegramPollLoop(host, abort.signal);
    try {
      await vi.advanceTimersByTimeAsync(0);
      for (let attempt = 0; attempt < 12; attempt += 1) {
        expect(getEventListeners(abort.signal, 'abort')).toHaveLength(1);
        await vi.advanceTimersToNextTimerAsync();
      }
      const calls = vi.mocked(host.callApi).mock.calls.length;
      abort.abort();
      await loop;
      expect(getEventListeners(abort.signal, 'abort')).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(host.callApi).toHaveBeenCalledTimes(calls);
    } finally {
      abort.abort();
      await loop;
      vi.useRealTimers();
    }
  });
});
