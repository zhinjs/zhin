import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { AdapterIndex, adapterFeatureId, endpointEventGatewayToken, type AdapterDefinition, type EndpointDesiredRecord,
  type EndpointDesiredRepository, type EndpointDesiredSnapshot } from 'zhin.js/adapter';
import { createCapabilitySlot, createSnapshotView, SnapshotStore, rootPluginId, readOperationSession, type OperationSession, type CapabilityId, type SnapshotState } from 'zhin.js';
import { ImRuntime } from '@zhin.js/core/runtime';
import napcat from '../../napcat/adapters/napcat/index.js';
import onebot11 from '../adapters/onebot11/index.js';
import onebot12 from '../../onebot12/adapters/onebot12/index.js';
import milky from '../../milky/adapters/milky/index.js';
import satori from '../../satori/adapters/satori/index.js';

const vendors: WebSocketServer[] = [];
afterEach(async () => { for (const vendor of vendors.splice(0)) { for (const socket of vendor.clients) socket.terminate(); await new Promise<void>(resolve => vendor.close(() => resolve())); } });

async function scenario<Config>(name: string, definition: AdapterDefinition<Config>,
  configuration: (url: string, id: string) => Config & Readonly<Record<string, unknown>>, wire: (id: string) => unknown) {
  const vendor = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  vendors.push(vendor);
  const sockets: WebSocket[] = [];
  vendor.on('connection', socket => {
    const self = String(111 + sockets.length * 111); sockets.push(socket);
    socket.on('message', raw => {
      const request = JSON.parse(String(raw)) as { action?: string; echo?: string };
      if (request.action) socket.send(JSON.stringify({ status: 'ok', retcode: 0, echo: request.echo, data: { user_id: self } }));
    });
  });
  await new Promise<void>(resolve => vendor.once('listening', resolve));
  const address = vendor.address(); if (!address || typeof address === 'string') throw new Error('Missing local vendor address');
  const url = `http://127.0.0.1:${address.port}`, root = rootPluginId();
  const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: name,
    source: `/project/adapters/${name}/index.ts`, definition });
  const configs = ['111', '222'].map(id => configuration(url, id));
  const records: EndpointDesiredRecord[] = configs.map((config, index) => ({
    instanceId: `instance-${index}`, canonicalId: `${slot.id}~instance-${index}` as CapabilityId,
    endpointId: String(config.id), revision: 1, desiredEnabled: true, config,
  }));
  let desired: EndpointDesiredSnapshot = { revision: 1, endpoints: records };
  const repository: EndpointDesiredRepository = { load: async () => structuredClone(desired),
    async compareAndSet(_id, expected, endpoints, commitId) {
      expect(expected).toBe(desired.revision); desired = structuredClone({ revision: desired.revision + 1, endpoints, commitId }); return desired;
    } };
  const rows: Array<{ session: OperationSession; finish(): void }> = [];
  const im = new ImRuntime({ inboundClaim(message) {
    const session = readOperationSession(message); if (!session) throw new Error('Real Core ingress did not bind its OperationSession');
    return new Promise<boolean>(resolve => {
      const finish = () => resolve(true); session.signal.addEventListener('abort', finish, { once: true }); rows.push({ session, finish });
    });
  } });
  const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/project', children: [] }]]),
    config: new Map([[root, { endpoints: configs }]]), capabilities: new Map([[slot.id, slot]]), projections: new Map(),
    resources: new Map([[root, new Map([[endpointEventGatewayToken.id, im.endpointEvents]])]]) };
  const index = await AdapterIndex.create([slot], createSnapshotView(0, state), new AbortController().signal, { repository });
  const snapshots = new SnapshotStore({ ...state, projections: new Map([[adapterFeatureId, index]]) }); im.attach(snapshots);
  try {
    await index.start(); index.open();
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    const adapter = index.adapter(slot.id)!;
    const native = records.map(record => adapter.getEndpoint(record.instanceId)!);
    const raw: unknown[][] = [[], []];
    for (let i = 0; i < native.length; i++) {
      const endpoint = native[i]!;
      if (!('on' in endpoint) || typeof endpoint.on !== 'function') throw new Error('Actual native Client event API is unavailable');
      endpoint.on('event', (event: unknown) => raw[i]!.push(event));
      sockets[i]!.send(JSON.stringify(wire(String(111 + i * 111))));
    }
    await vi.waitFor(() => expect(rows).toHaveLength(2));
    for (let i = 0; i < records.length; i++) {
      const row = rows.find(row => row.session.scene.endpoint.id === records[i]!.canonicalId)!;
      expect(row.session.endpoint).toBe(native[i]); expect(row.session.adapter).toBe(adapter);
      expect(row.session.adapterName).toBe(name); expect(row.session.event).toBe(raw[i]![0]);
      expect(row.session.sender?.id).toBe('42'); expect(row.session.message.text).toBe('same group message');
      expect(row.session.scene).toMatchObject({ kind: 'group', endpoint: { adapter: name, id: records[i]!.canonicalId } });
    }
    const first = rows.find(row => row.session.scene.endpoint.id === records[0]!.canonicalId)!;
    const other = rows.find(row => row.session.scene.endpoint.id === records[1]!.canonicalId)!;
    await adapter.stop(records[0]!.instanceId, adapter.revision);
    expect(first.session.signal.aborted).toBe(true); expect(other.session.signal.aborted).toBe(false);
    expect(adapter.getEndpoint(records[1]!.instanceId)).toBe(native[1]);
    await expect(Promise.resolve().then(() => first.session.reply('late reply'))).rejects.toThrow();
    other.finish();
  } finally {
    for (const row of rows) row.finish();
    await index.stop(); await snapshots.close();
    for (const socket of vendor.clients) socket.terminate(); await new Promise<void>(resolve => vendor.close(() => resolve()));
  }
}
const qq = (id: string) => ({ post_type: 'message', message_type: 'group', message_id: 1, self_id: Number(id), group_id: 100,
  user_id: 42, sender: { user_id: 42, nickname: 'viewer' }, raw_message: 'same group message', message: [{ type: 'text', data: { text: 'same group message' } }] });
describe('actual protocol convention Adapter → SDK Endpoint → Core OperationSession', () => {
  it('isolates NapCat native objects, account cancellation, and group identity', () => scenario('napcat', napcat,
    (url, id) => ({ id, connection: 'ws', url: url.replace('http:', 'ws:') }), qq));
  it('isolates OneBot11 native objects, account cancellation, and group identity', () => scenario('onebot11', onebot11,
    (url, id) => ({ id, connection: 'ws', url: url.replace('http:', 'ws:') }), qq));
  it('isolates OneBot12 native objects, account cancellation, and group identity', () => scenario('onebot12', onebot12,
    (url, id) => ({ id, platform: 'qq', userId: id, connection: 'ws', url: url.replace('http:', 'ws:') }), id => ({ id: 'event', time: 1, type: 'message', detail_type: 'group', sub_type: '',
      self: { platform: 'qq', user_id: id }, group_id: '100', user_id: '42', message_id: 'same-id', alt_message: 'same group message', message: [{ type: 'text', data: { text: 'same group message' } }] })));
  it('isolates Milky native objects, account cancellation, and group identity', () => scenario('milky', milky,
    (url, id) => ({ id, connection: 'ws', baseUrl: url }), id => ({ event_type: 'message_receive', time: 1, self_id: Number(id),
      data: { message_scene: 'group', peer_id: 100, message_seq: 1, sender_id: 42, segments: [{ type: 'text', data: { text: 'same group message' } }] } })));
  it('isolates selected Satori logins with the same group/channel IDs and preserves SDK identity', () => scenario('satori', satori,
    (url, id) => ({ id, platform: 'qq', userId: id, connection: 'ws', baseUrl: url }), id => ({ op: 0, body: { type: 'message-created', timestamp: 1,
      login: { platform: 'qq', user: { id } }, channel: { id: '100', type: 0 }, guild: { id: 'parent' }, user: { id: '42' }, message: { id: 'same-id', content: 'same group message' } } })));
});
