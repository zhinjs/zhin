import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAdapterLogger } from '@zhin.js/logger';
import { capabilityId, rootPluginId, featureId } from 'zhin.js';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { WeixinIlinkEndpoint } from '../src/endpoint.js';
import { WeixinIlinkStateStore } from '../src/credentials.js';
import { resolveWeixinIlinkConfig } from '../src/protocol.js';
import { idleIlinkTransport, idleIlinkUpdates } from './transport-fixture.js';

const message = { from_user_id: 'sender', message_id: 1, message_type: 1, message_state: 2, item_list: [{ type: 1, text_item: { text: 'redelivered until acknowledged' } }] };

async function fixture(updates: ReturnType<typeof vi.fn>, receive: (event: unknown) => Promise<unknown>) {
  const directory = mkdtempSync(join(tmpdir(), 'ilink-pause-'));
  const config = resolveWeixinIlinkConfig({ id: 'pause-fixture', botToken: 'synthetic-token', dataDir: directory });
  const state = new WeixinIlinkStateStore(config.id, directory), save = vi.spyOn(state, 'saveSyncBuf');
  const error = vi.spyOn(getAdapterLogger('weixin-ilink', config.id), 'error').mockImplementation(() => undefined);
  const harness = await createEndpointHarness(() => new WeixinIlinkEndpoint({ ...idleIlinkTransport,
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'pause-fixture'), config, state,
    resolveCredentials: async () => ({ botToken: 'synthetic-token' }), getUpdates: updates,
  }), { capabilities: ['inbound', 'outbound'], operations: ['typing'], gateway: createTestEventGateway({ receive }) });
  return { ...harness, save, error, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('iLink poll loop pauses while input is closed', () => {
  it('stops re-fetching the unacknowledged batch after close and resumes on reopen', async () => {
    // The provider keeps returning the same batch until its cursor is acknowledged.
    let acknowledged = false;
    const updates = vi.fn((options: { abortSignal?: AbortSignal }) => acknowledged
      ? idleIlinkUpdates(options)
      : Promise.resolve({ get_updates_buf: 'cursor-after-message', msgs: [message] }));
    let release!: () => void;
    const receive = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const f = await fixture(updates, receive);
    f.save.mockImplementation(() => { acknowledged = true; });
    try {
      await f.start(); f.open();
      await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
      vi.useFakeTimers();
      const closing = f.close(); release(); await closing;
      const callsAtClose = updates.mock.calls.length;

      // Retry (2s) and backoff (10s+) windows pass without another poll or an error log.
      await vi.advanceTimersByTimeAsync(120_000);
      expect(updates).toHaveBeenCalledTimes(callsAtClose);
      expect(f.error).not.toHaveBeenCalled();
      expect(f.save).not.toHaveBeenCalled();

      receive.mockImplementation(async () => undefined);
      f.open();
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();
      // The batch dropped at close is fetched and admitted again, then acknowledged.
      await vi.waitFor(() => expect(f.save).toHaveBeenCalledWith('cursor-after-message'));
      expect(updates.mock.calls.length).toBeGreaterThan(callsAtClose);
      expect(receive.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally { vi.useRealTimers(); release?.(); await f.stop(); f.cleanup(); }
  });

  it('aborts the in-flight long poll on close and starts a new one on reopen', async () => {
    const signals: AbortSignal[] = [];
    const updates = vi.fn((options: { abortSignal?: AbortSignal }) => { signals.push(options.abortSignal!); return idleIlinkUpdates(options); });
    const f = await fixture(updates, async () => undefined);
    try {
      await f.start(); f.open();
      await vi.waitFor(() => expect(updates).toHaveBeenCalledTimes(1));
      expect(signals[0].aborted).toBe(false);
      await f.close();
      expect(signals[0].aborted).toBe(true);
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(updates).toHaveBeenCalledTimes(1);
      f.open();
      await vi.advanceTimersByTimeAsync(0);
      expect(updates).toHaveBeenCalledTimes(2);
      expect(signals[1].aborted).toBe(false);
      expect(f.error).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); await f.stop(); f.cleanup(); }
  });
});
