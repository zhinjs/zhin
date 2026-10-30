import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { AdapterIndex, AdapterManagementError, adapterFeatureId, endpointEventGatewayToken, type EndpointDesiredRepository, type EndpointDesiredSnapshot } from 'zhin.js/adapter';
import { createCapabilitySlot, createSnapshotView, rootPluginId, type SnapshotState } from 'zhin.js';
import definition from '../adapters/weixin-ilink/index.js';
import { WeixinIlinkStateStore } from '../src/credentials.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ilink-account-identity-')), owner = rootPluginId();
  const previousDirectory = join(directory, 'previous'), otherDirectory = join(directory, 'other');
  const old = new WeixinIlinkStateStore('same-label', previousDirectory), other = new WeixinIlinkStateStore('same-label', otherDirectory);
  old.saveCredentials({ botToken: 'synthetic-old' }); old.saveSyncBuf('synthetic-old-cursor');
  other.saveCredentials({ botToken: 'synthetic-other' }); other.saveSyncBuf('synthetic-other-cursor');
  const before = await Promise.all([old.credentialsPath(), old.syncBufPath(), other.credentialsPath(), other.syncBufPath()].map(path => readFile(path, 'utf8')));
  const slot = createCapabilitySlot({ owner, feature: adapterFeatureId, localName: 'weixin-ilink', source: '/fixture/adapters/weixin-ilink/index.ts', definition });
  let saved: EndpointDesiredSnapshot = { revision: 3, endpoints: [{ instanceId: 'old-instance', canonicalId: slot.id, endpointId: 'same-label', revision: 1, desiredEnabled: false, config: { id: 'same-label', dataDir: previousDirectory } }] };
  const write = vi.fn<EndpointDesiredRepository['compareAndSet']>(async (_id, revision, endpoints, commitId) => {
    if (revision !== saved.revision) throw new AdapterManagementError('conflict', 'synthetic conflict');
    return saved = structuredClone({ revision: revision + 1, endpoints, commitId });
  });
  const repository: EndpointDesiredRepository = { load: async () => saved, compareAndSet: write };
  const state: SnapshotState = { root: owner, tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: 'fixture', packageRoot: directory, children: [] }]]), config: new Map([[owner, { endpoints: [] }]]), resources: new Map([[owner, new Map([[endpointEventGatewayToken.id, { receive: async () => undefined }]])]]), capabilities: new Map([[slot.id, slot]]), projections: new Map() };
  const index = await AdapterIndex.create([slot], createSnapshotView(1, state), new AbortController().signal, { repository });
  await index.activate(new AbortController().signal); const adapter = index.adapter(slot.id)!;
  return { adapter, slot, old, other, otherDirectory, before, write, saved: () => saved,
    close: async () => { await index.stop(); await rm(directory, { recursive: true, force: true }); } };
}

it('does not save a directory-based principal switch without readonly identity verification', async () => {
  const f = await fixture();
  try {
    await expect(f.adapter.patchConfiguration('old-instance', 3, { dataDir: f.otherDirectory })).rejects.toMatchObject({ code: 'unsupported' });
    expect(f.write).not.toHaveBeenCalled(); expect(f.saved().revision).toBe(3);
  } finally { await f.close(); }
});
it('explicit replacement receives a fresh isolated state namespace and preserves both existing accounts on disk', async () => {
  const f = await fixture();
  try {
    await f.adapter.replace('old-instance', 3, { endpointId: 'same-label', config: { id: 'same-label', dataDir: f.otherDirectory } });
    const replacement = f.saved().endpoints[0]!;
    expect(f.write).toHaveBeenCalledTimes(1); expect(replacement.instanceId).not.toBe('old-instance'); expect(replacement.canonicalId).not.toBe(f.slot.id); expect(replacement.desiredEnabled).toBe(false);
    expect(replacement.config.dataDir).toBe(join(f.otherDirectory, 'accounts', replacement.instanceId));
    const fresh = new WeixinIlinkStateStore('same-label', String(replacement.config.dataDir));
    expect(fresh.loadCredentials()).toBeNull(); expect(fresh.loadSyncBuf()).toBe(''); expect(f.adapter.getEndpoint(replacement.instanceId)).toBeUndefined();
    expect(await Promise.all([f.old.credentialsPath(), f.old.syncBufPath(), f.other.credentialsPath(), f.other.syncBufPath()].map(path => readFile(path, 'utf8')))).toEqual(f.before);
  } finally { await f.close(); }
});
