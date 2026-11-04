import { createTestEventGateway } from '../../test-utils/endpoint.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdapterIndex, AdapterManagementError, adapterFeatureId, endpointEventGatewayToken,
  type EndpointDesiredSnapshot } from 'zhin.js/adapter';
import { createCapabilitySlot, createSnapshotView, rootPluginId, type PluginConsoleRpcCall, type SnapshotState } from 'zhin.js';
import emailDefinition from '../adapters/email/index.js';
import { createEmailConsoleRpc } from '../src/console.js';
import { EmailAdapter } from '../src/adapter.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(close => close())); });
const values = { 'smtp.host': 'smtp.fixture', 'smtp.port': '465', 'smtp.secure': 'true',
  'smtp.auth.user': 'sender', 'smtp.auth.pass': 'synthetic-smtp', 'imap.host': 'imap.fixture',
  'imap.port': '993', 'imap.tls': 'true', 'imap.user': 'reader', 'imap.password': 'synthetic-imap' };

async function fixture() {
  const root = rootPluginId(), source = { endpoints: [] };
  let saved: EndpointDesiredSnapshot = { revision: 0, endpoints: [] };
  const repository = { load: vi.fn(async () => saved), compareAndSet: vi.fn(async (_id, revision, endpoints, commitId) => {
    if (saved.revision !== revision) throw new AdapterManagementError('conflict', 'synthetic revision conflict');
    return saved = structuredClone({ revision: revision + 1, endpoints, commitId });
  }) };
  const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'email', source: '/fixture/email/adapters/email/index.ts', definition: emailDefinition });
  const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[root, source]]), capabilities: new Map([[slot.id, slot]]), projections: new Map(),
    resources: new Map([[root, new Map([[endpointEventGatewayToken.id, createTestEventGateway()]])]]) };
  const index = await AdapterIndex.create([slot], createSnapshotView(1, state), new AbortController().signal, { repository });
  await index.activate(new AbortController().signal); cleanup.push(() => index.stop());
  const adapter = index.adapter(slot.id)!;
  const rpc = createEmailConsoleRpc({ has: () => false, use: () => { throw new Error('No legacy file store'); } }, () => source);
  const call: PluginConsoleRpcCall = { signal: new AbortController().signal, runtime: { owner: root, generation: 1, operator: true, project: () => index.forOwner(root) } };
  const invoke = (name: string, input = {}) => rpc.methods.get(name)!.handler(input, call);
  return { adapter, repository, source, invoke, saved: () => saved };
}

describe('Email convention definition → Console RPC → owning Adapter persistence', () => {
  it('declares editable leaves and persists typed patches without replacing parents, credentials or startup source', async () => {
    const f = await fixture(); expect(f.adapter).toBeInstanceOf(EmailAdapter);
    await expect(f.invoke('status')).resolves.toMatchObject({ runtime: { canUpdate: true, mutableFields: expect.arrayContaining(['smtp.port', 'imap.mailbox']) } });
    await expect(f.invoke('endpoint-add', { expectedGeneration: 1, expectedRevision: 0, id: 'mail', values })).resolves.toMatchObject({ saved: true, restartRequired: false });
    const original = f.adapter.list()[0]!; expect(original.desiredEnabled).toBe(false);
    expect(f.adapter.getEndpoint(original.instanceId)).toBeUndefined();
    await expect(f.invoke('endpoint-update', { expectedGeneration: 1, expectedRevision: 1, instanceId: original.instanceId,
      values: { 'smtp.port': '587', 'smtp.secure': 'false', 'smtp.auth.pass': '', 'imap.password': '••••••', 'imap.mailbox': 'Archive' } })).resolves.toMatchObject({ saved: true });
    expect(f.saved().endpoints[0]!.config).toMatchObject({ id: 'mail', smtp: { host: 'smtp.fixture', port: 587, secure: false, auth: { user: 'sender', pass: 'synthetic-smtp' } }, imap: { password: 'synthetic-imap', mailbox: 'Archive' } });
    expect(f.adapter.list()[0]!.instanceId).toBe(original.instanceId);
    expect(f.source).toEqual({ endpoints: [] }); expect(f.adapter.getEndpoint(original.instanceId)).toBeUndefined();
    const view = JSON.stringify(await f.invoke('status')); expect(view).not.toContain('synthetic-smtp'); expect(view).not.toContain('synthetic-imap');
  });
  it('rejects undeclared parents, invalid typed values and identity edits before CAS', async () => {
    const f = await fixture(); await f.invoke('endpoint-add', { expectedGeneration: 1, expectedRevision: 0, id: 'mail', values });
    const target = f.adapter.list()[0]!;
    for (const patch of [{ smtp: '{"port":587}' }, { 'smtp.secure': 'yes' }, { 'smtp.port': 'NaN' }, { 'smtp.auth.user': 'another-principal' }, { master: 'operator' }]) {
      await expect(f.invoke('endpoint-update', { expectedGeneration: 1, expectedRevision: 1, instanceId: target.instanceId, values: patch })).rejects.toMatchObject({ code: 'invalid_input' });
    }
    expect(f.repository.compareAndSet).toHaveBeenCalledTimes(1); expect(f.saved().revision).toBe(1);
  });
});
