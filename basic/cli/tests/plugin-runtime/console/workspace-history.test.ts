import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdapterIndex, Adapter, endpointSpec, createEndpointSpecification, type Endpoint, adapterFeatureId, defineAdapter, endpointEventGatewayToken } from '@zhin.js/adapter';
import { createHttpHost } from '@zhin.js/host-http';
import { CONVERSATION_EVENT_MODEL, CONVERSATION_CURSOR_MODEL, DatabaseConversationEventStore, type ConversationRef } from '@zhin.js/im-contract';
import { createCapabilitySlot, createSnapshotView, SnapshotStore, rootPluginId, childPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { createDatabaseHost } from '../../../src/plugin-runtime/database-host-installer.js';
import { registerConversationHistoryRoutes } from '../../../src/plugin-runtime/console/conversation-history-routes.js';

it('reads the connected endpoint canonical history even when display names cannot select an endpoint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zhin-workspace-history-'));
  const db = createDatabaseHost({ dialect: 'sqlite', filename: join(directory, 'history.sqlite') });
  db.define('conversation_events', CONVERSATION_EVENT_MODEL);
  db.define('conversation_event_cursors', CONVERSATION_CURSOR_MODEL);
  await db.start();
  let endpointKey = 'sandbox-bot';
  class WorkspaceClient {
    connectionById(id: string) { return id === 'connected-page' ? { target: endpointKey, owner: 'owner', placeholder: false, socket: { readyState: 1 } } : undefined; }
    send(): never { throw new Error('History recovery must not send messages'); }
  }
  class TestEndpoint extends WorkspaceClient implements Endpoint {
    readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {}, send: () => this.send() });
  }
  const root = rootPluginId(), owner = childPluginId(root, 'sandbox');
  const slot = createCapabilitySlot({ owner, feature: adapterFeatureId, localName: 'sandbox', source: '/sandbox/adapters/index.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => new class extends Adapter<TestEndpoint> { protected createEndpoint() { return new TestEndpoint(); } }() }) });
  const base: SnapshotState = { root, tree: new Map([
    [root, { id: root, instanceKey: 'root', packageName: 'app', packageRoot: directory, children: [owner] }],
    [owner, { id: owner, instanceKey: 'sandbox', packageName: '@zhin.js/adapter-sandbox', packageRoot: directory, parent: root, children: [] }],
  ]), config: new Map(), resources: new Map([[owner, new Map([[endpointEventGatewayToken.id, { receive: async () => undefined }]])]]),
  capabilities: new Map([[slot.id, slot]]), projections: new Map() };
  const adapters = await AdapterIndex.create([slot], createSnapshotView(0, base), new AbortController().signal);
  await adapters.activate(new AbortController().signal);
  const snapshots = new SnapshotStore({ ...base, projections: new Map([[adapterFeatureId, adapters]]) });
  const events = new DatabaseConversationEventStore(db.models.get('conversation_events')!, db.models.get('conversation_event_cursors')!);
  const conversation: ConversationRef = { endpoint: { adapter: 'sandbox', id: String(slot.id) }, kind: 'group', id: 'scene' };
  const other: ConversationRef = { ...conversation, endpoint: { adapter: 'sandbox', id: 'different-endpoint' } };
  for (const [id, scene] of [['current endpoint', conversation], ['other endpoint', other]] as const) {
    await events.append({ type: 'message.created', eventId: id, conversation: scene, timestamp: 1,
      message: { ref: { conversation: scene, id }, timestamp: 1, segments: [{ type: 'text', data: { text: id } }] } });
  }
  const http = createHttpHost({ host: '127.0.0.1', port: 0, token: 'operator', tokens: [{ token: 'demo', scope: 'demo' }] });
  const resolveDisplayName = vi.fn(() => null);
  const im = { endpoints: { get: resolveDisplayName }, conversationEventReader: events,
    runWithSnapshotView: async (operation: () => Promise<unknown>) => operation() };
  registerConversationHistoryRoutes({ http, base: '/api', databaseHost: db, snapshots,
    im: im as unknown as NonNullable<Parameters<typeof registerConversationHistoryRoutes>[0]['im']> });
  const { origin } = await http.listen();
  const read = (sessionKey: string, connectionId: string, token = 'operator') => fetch(`${origin}/api/conversations/history?${new URLSearchParams({ sessionKey, connectionId })}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  try {
    const response = await read('sandbox:sandbox-bot:group:scene', 'connected-page');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.conversation).toEqual(conversation);
    expect(body.data.items.map((entry: { message: { ref: { id: string } } }) => entry.message.ref.id)).toEqual(['current endpoint']);
    expect(resolveDisplayName).not.toHaveBeenCalled();
    expect((await read('sandbox:other-account:group:scene', 'connected-page')).status).toBe(403);
    const retired = await read('sandbox:sandbox-bot:group:scene', 'retired-connection');
    expect(retired.status).toBe(503);
    expect((await retired.json()).code).toBe('sandbox_binding_unavailable');
    expect((await read('sandbox:sandbox-bot:group:scene', 'connected-page', 'demo')).status).toBe(403);
    endpointKey = 'a:b';
    expect((await read('sandbox:a:b:group:scene', 'connected-page')).status).toBe(200);
  } finally {
    await http.close(); await snapshots.close(); await adapters.stop(); await db.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
