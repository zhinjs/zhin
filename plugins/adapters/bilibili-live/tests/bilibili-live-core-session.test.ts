import WebSocket, { WebSocketServer } from 'ws';
import { expect, it, vi } from 'vitest';
import { AdapterIndex, adapterFeatureId, endpointEventGatewayToken, type EndpointEvent, type EndpointEventGateway } from 'zhin.js/adapter';
import { createCapabilitySlot, createSnapshotView, SnapshotStore, rootPluginId, readOperationSession, type OperationSession, type SnapshotState } from 'zhin.js';
import { ImRuntime } from '@zhin.js/core/runtime';
import definition from '../adapters/bilibili-live/index.js';
import { BilibiliLiveClient } from '../src/client.js';
import { BilibiliLiveEndpoint } from '../src/endpoint.js';

function packet(op: number, data: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(data)), header = Buffer.alloc(16);
  header.writeUInt32BE(16 + body.length, 0); header.writeUInt16BE(16, 4); header.writeUInt16BE(0, 6);
  header.writeUInt32BE(op, 8); header.writeUInt32BE(1, 12); return Buffer.concat([header, body]);
}
it('preserves the actual custom Client danmaku event in a Core channel Session with account and room kept distinct', async () => {
  const vendor = new WebSocketServer({ port: 0, host: '127.0.0.1' }); let socket: WebSocket | undefined;
  vendor.on('connection', client => { socket = client; client.on('message', raw => {
    if (!Buffer.isBuffer(raw)) throw new Error('Expected a binary protocol frame');
    const frame = raw; if (frame.readUInt32BE(8) === 7) client.send(packet(8, { code: 0 }));
  }); });
  await new Promise<void>(resolve => vendor.once('listening', resolve));
  const address = vendor.address(); if (!address || typeof address === 'string') throw new Error('Missing offline danmaku peer');
  let nativeFrames = 0;
  vi.stubGlobal('WebSocket', class extends WebSocket {
    constructor(url: string) {
      const target = new URL(url); if (target.hostname !== '127.0.0.1' || target.port !== String(address.port)) throw new Error('Unexpected real platform connection');
      super(`ws://127.0.0.1:${address.port}${target.pathname}`);
      this.on('message', () => { nativeFrames++; });
    }
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    let data: unknown;
    if (url.includes('/room_init')) data = { room_id: 100, uid: 7 };
    else if (url.includes('/nav')) data = { isLogin: true, mid: 111 };
    else if (url.includes('/getDanmuInfo')) data = { token: 'offline-fixture', host_list: [{ host: '127.0.0.1', wss_port: address.port }] };
    else throw new Error('Unexpected offline Bilibili HTTP request');
    return { ok: true, status: 200, json: async () => ({ code: 0, data }) };
  }));
  const root = rootPluginId(), sessions: OperationSession[] = []; let nativeEvent: unknown;
  const im = new ImRuntime({ inboundClaim(message) { const session = readOperationSession(message); if (!session) throw new Error('Core Session is missing'); sessions.push(session); return true; } });
  const receive = async (event: EndpointEvent, dispatch: EndpointEventGateway['receive']) => {
    const payload = event.payload;
    if (event.name === 'platform.receive' && payload && typeof payload === 'object' && 'name' in payload && payload.name === 'danmaku' && 'event' in payload) nativeEvent = payload.event;
    return dispatch(event);
  };
  const gateway: EndpointEventGateway = {
    run: execute => im.endpointEvents.run(receipt => execute({ receive: event => receive(event, receipt.receive) })),
    receive: event => receive(event, im.endpointEvents.receive),
  };
  const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'bilibili-live', source: '/project/adapters/bilibili-live/index.ts', definition });
  const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/project', children: [] }]]),
    config: new Map([[root, { id: 'live-account', roomId: 100, sessdata: 'offline-cookie', biliJct: 'offline-jct', buvid3: 'offline-buvid', apiBaseUrl: 'https://offline.invalid', liveApiBaseUrl: 'https://offline.invalid' }]]),
    capabilities: new Map([[slot.id, slot]]), projections: new Map(), resources: new Map([[root, new Map([[endpointEventGatewayToken.id, gateway]])]]) };
  const index = await AdapterIndex.create([slot], createSnapshotView(0, state), new AbortController().signal);
  const snapshots = new SnapshotStore({ ...state, projections: new Map([[adapterFeatureId, index]]) }); im.attach(snapshots);
  try {
    await index.start(); index.open();
    socket!.send(packet(5, { cmd: 'DANMU_MSG', info: [[0, 1, 25, 0, 1700000000000, 0, 0, '', 0, 0, 0, '', 0, '{}', '{}', { extra: JSON.stringify({ id_str: 'native-danmaku' }) }], 'live input', [42, 'viewer']] }));
    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    const endpoint = index.client<BilibiliLiveEndpoint>('bilibili-live', String(slot.id));
    expect(endpoint).toBeInstanceOf(BilibiliLiveClient); expect(sessions[0]?.endpoint).toBe(endpoint);
    expect(sessions[0]?.adapter).toBe(index.adapter(slot.id)); expect(sessions[0]?.event).toBe(nativeEvent);
    expect(nativeEvent).toMatchObject({ id: 'native-danmaku', uid: '42', text: 'live input' });
    expect(sessions[0]?.sender?.id).toBe('42'); expect(sessions[0]?.message).toMatchObject({ id: 'native-danmaku', text: 'live input', platformSentAt: 1700000000000 });
    expect(sessions[0]?.scene).toMatchObject({ kind: 'channel', id: '100', endpoint: { adapter: 'bilibili-live', id: slot.id } });
    expect(index.connection('bilibili-live', String(slot.id))?.selfUserId).toBe('111');
    const closedFrame = packet(5, { cmd: 'DANMU_MSG', info: [[0, 1, 25, 0, 2, 0, 0, '', 0, 0, 0, '', 0, '{}', '{}', { extra: JSON.stringify({ id_str: 'closed-native-id' }) }], 'late closed input', [43, 'other']] });
    await index.close();
    const beforeClosedFrame = nativeFrames; socket!.send(closedFrame);
    await vi.waitFor(() => expect(nativeFrames).toBe(beforeClosedFrame + 1));
    expect(sessions).toHaveLength(1);
    index.open(); socket!.send(closedFrame);
    await vi.waitFor(() => expect(sessions).toHaveLength(2));
    expect(sessions[1]?.message.id).toBe('closed-native-id');
  } finally {
    await index.stop(); await snapshots.close(); vi.unstubAllGlobals();
    for (const client of vendor.clients) client.terminate(); await new Promise<void>(resolve => vendor.close(() => resolve()));
  }
});
