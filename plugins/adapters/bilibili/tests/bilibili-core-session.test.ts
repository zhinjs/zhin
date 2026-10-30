import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { AdapterIndex, adapterFeatureId, endpointEventGatewayToken } from 'zhin.js/adapter';
import { createCapabilitySlot, createSnapshotView, SnapshotStore, rootPluginId, readOperationSession, type OperationSession, type SnapshotState } from 'zhin.js';
import { ImRuntime } from '@zhin.js/core/runtime';
import definition from '../adapters/bilibili/index.js';
import { BilibiliEndpoint } from '../src/endpoint.js';
import { BilibiliClient } from '../src/client.js';
import { bilibiliNotifierToken } from '../src/bilibili-runtime-state.js';

it('preserves the real HTTP Client reply object in Core Session and queues the same operation reply for review', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bili-core-'));
  const root = rootPluginId();
  const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'bilibili', source: '/project/adapters/bilibili/index.ts', definition });
  const old = { rpid: 1, oid: 170001, type: 1, root: 0, parent: 0, mid: 42, ctime: 1, member: { mid: '42', uname: 'viewer' }, content: { message: 'baseline' } };
  const incoming = { ...old, rpid: 2, root: 1, parent: 1, ctime: 2, content: { message: 'new comment' }, vendorExtension: { original: true } };
  let pages = 0, writes = 0;
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('/x/web-interface/nav')) return { ok: true, status: 200, json: async () => ({ code: 0, data: { isLogin: true, mid: 111 } }) };
    if (url.includes('/x/v2/reply?')) { pages++; return { ok: true, status: 200, json: async () => ({ code: 0, data: { replies: pages === 1 ? [old] : [old, incoming] } }) }; }
    if (url.includes('/x/v2/reply/add')) { writes++; throw new Error('Review admission must not post to a vendor'); }
    throw new Error('Unexpected offline Bilibili request');
  });
  vi.stubGlobal('fetch', fetch);
  let session: OperationSession | undefined, replyResult: unknown;
  const im = new ImRuntime({ async inboundClaim(message) {
    session = readOperationSession(message); if (!session) throw new Error('Core Session is missing');
    replyResult = await session.reply('待审核回复'); return true;
  } });
  const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/project', children: [] }]]),
    config: new Map([[root, { id: 'comments', videos: [170001], sessdata: 'offline-cookie', biliJct: 'offline-jct', dataDir: directory }]]),
    capabilities: new Map([[slot.id, slot]]), projections: new Map(), resources: new Map([[root, new Map([
      [endpointEventGatewayToken.id, im.endpointEvents], [bilibiliNotifierToken.id, async () => false],
    ])]]) };
  const index = await AdapterIndex.create([slot], createSnapshotView(0, state), new AbortController().signal);
  const snapshots = new SnapshotStore({ ...state, projections: new Map([[adapterFeatureId, index]]) }); im.attach(snapshots);
  try {
    await index.start(); index.open();
    await vi.waitFor(() => expect(pages).toBe(1));
    const endpoint = index.client<BilibiliEndpoint>('bilibili', String(slot.id));
    expect(endpoint).toBeInstanceOf(BilibiliClient); await endpoint.pollOnce();
    await vi.waitFor(() => expect(replyResult).toBeDefined());
    expect(replyResult).toMatchObject({ status: 'failed', failure: { code: 'approval_pending' } });
    expect(session?.endpoint).toBe(endpoint); expect(session?.adapter).toBe(index.adapter(slot.id));
    expect(session?.event).toBe(incoming); expect(session?.sender?.id).toBe('42');
    expect(session?.message).toMatchObject({ id: '2', text: 'new comment', platformSentAt: 2000 });
    expect(session?.scene).toMatchObject({ kind: 'channel', id: 'video:170001:1', endpoint: { adapter: 'bilibili', id: slot.id } });
    expect(endpoint.drafts.list()).toEqual([expect.objectContaining({ message: '待审核回复' })]); expect(writes).toBe(0);
  } finally {
    await index.stop(); await snapshots.close(); vi.unstubAllGlobals(); rmSync(directory, { recursive: true, force: true });
  }
});
