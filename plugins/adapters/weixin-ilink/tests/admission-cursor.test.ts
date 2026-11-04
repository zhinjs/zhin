import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { capabilityId, rootPluginId, featureId } from 'zhin.js';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { WeixinIlinkEndpoint } from '../src/endpoint.js';
import { WeixinIlinkStateStore } from '../src/credentials.js';
import { resolveWeixinIlinkConfig } from '../src/protocol.js';
import { idleIlinkTransport, idleIlinkUpdates } from './transport-fixture.js';

const message = { from_user_id: 'sender', message_id: 1, message_type: 1, message_state: 2, item_list: [{ type: 1, text_item: { text: 'same native callback' } }] };
async function fixture(receive: (event: unknown) => Promise<unknown>) {
  const directory = mkdtempSync(join(tmpdir(), 'ilink-cursor-'));
  const config = resolveWeixinIlinkConfig({ id: 'fixture', botToken: 'synthetic-token', dataDir: directory });
  const state = new WeixinIlinkStateStore(config.id, directory), save = vi.spyOn(state, 'saveSyncBuf');
  const updates = vi.fn().mockResolvedValueOnce({ get_updates_buf: 'cursor-after-message', msgs: [message] }).mockImplementation(idleIlinkUpdates);
  const harness = await createEndpointHarness(() => new WeixinIlinkEndpoint({ ...idleIlinkTransport,
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'fixture'), config, state,
    resolveCredentials: async () => ({ botToken: 'synthetic-token' }), getUpdates: updates,
  }), { capabilities: ['inbound', 'outbound'], operations: ['typing'], gateway: createTestEventGateway({ receive }) });
  return { ...harness, updates, save, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

describe('real Adapter admission owns iLink cursor acknowledgement', () => {
  it('does not poll or advance before open and waits for actual accepted dispatch before advancing', async () => {
    let release!: () => void;
    const receive = vi.fn(() => new Promise<void>(resolve => { release = resolve; })), f = await fixture(receive);
    try {
      await f.start(); expect(f.updates).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
      f.open(); await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1)); expect(f.save).not.toHaveBeenCalled();
      expect(receive.mock.calls[0]![0]).toMatchObject({ event: message });
      expect((receive.mock.calls[0]![0] as { event: unknown }).event).toBe(message);
      release(); await vi.waitFor(() => expect(f.save).toHaveBeenCalledWith('cursor-after-message'));
    } finally { release?.(); await f.stop(); f.cleanup(); }
  });
  it('retains the cursor when actual admission fails', async () => {
    const receive = vi.fn(async () => { throw new Error('synthetic admission rejected'); }), f = await fixture(receive);
    try { await f.start(); f.open(); await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1)); expect(f.save).not.toHaveBeenCalled(); }
    finally { await f.stop(); f.cleanup(); }
  });
  it('does not advance when close overlaps a pending accepted dispatch', async () => {
    let release!: () => void; const receive = vi.fn(() => new Promise<void>(resolve => { release = resolve; })), f = await fixture(receive);
    try {
      await f.start(); f.open(); await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
      const closing = f.close(); release(); await closing; expect(f.save).not.toHaveBeenCalled();
    } finally { release?.(); await f.stop(); f.cleanup(); }
  });
});
