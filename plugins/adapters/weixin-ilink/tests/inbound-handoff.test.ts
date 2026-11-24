import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { capabilityId, rootPluginId, featureId } from 'zhin.js';
import { createEndpointHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import { WeixinIlinkEndpoint } from '../src/endpoint.js';
import { WeixinIlinkStateStore } from '../src/credentials.js';
import { resolveWeixinIlinkConfig } from '../src/protocol.js';
import { idleIlinkTransport, idleIlinkUpdates } from './transport-fixture.js';

const text = (id: number, value: string) => ({ from_user_id: 'sender', message_id: id, message_type: 1, message_state: 2,
  item_list: [{ type: 1, text_item: { text: value } }] });

// #1250 adapter-inbound-deadlock: the first message's dispatch (an Agent turn) waits for the user's answer,
// which only the next getupdates long-poll can fetch.
it('long-polls for the next message while the previous dispatch still waits for it, advancing the cursor on hand-over', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ilink-handoff-'));
  const config = resolveWeixinIlinkConfig({ id: 'fixture', botToken: 'synthetic-token', dataDir: directory });
  const state = new WeixinIlinkStateStore(config.id, directory), save = vi.spyOn(state, 'saveSyncBuf');
  const updates = vi.fn()
    .mockResolvedValueOnce({ get_updates_buf: 'cursor-1', msgs: [text(1, 'run it')] })
    .mockResolvedValueOnce({ get_updates_buf: 'cursor-2', msgs: [text(2, 'yes')] })
    .mockImplementation(idleIlinkUpdates);
  let answered!: () => void;
  const answer = new Promise<void>(resolve => { answered = resolve; });
  const receive = vi.fn(async (payload: { content?: string }) => {
    if (payload.content === 'yes') { answered(); return; }
    await answer; // the turn waits for the user's reply
  });
  const f = await createEndpointHarness(() => new WeixinIlinkEndpoint({ ...idleIlinkTransport,
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'fixture'), config, state,
    resolveCredentials: async () => ({ botToken: 'synthetic-token' }), getUpdates: updates,
  }), { capabilities: ['inbound', 'outbound'], operations: ['typing'], gateway: createTestEndpointEventGateway({ receive: async (event) => {
    if (event.name !== 'message.receive') return undefined;
    event.accepted?.(); // as the Runtime does once the message is recorded, before its dispatch
    return receive(event.payload as { content?: string });
  } }) });
  try {
    await f.start(); f.open();
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    await answer;
    await vi.waitFor(() => expect(save.mock.calls.map(call => call[0])).toEqual(['cursor-1', 'cursor-2']));
  } finally { answered(); await f.stop(); rmSync(directory, { recursive: true, force: true }); }
});
