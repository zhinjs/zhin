import { describe, expect, it, vi } from 'vitest';
import type { PluginId } from '@zhin.js/plugin-runtime';
import { AdapterManagementError, createAdapterConsoleRpc, type AdapterConsoleSpec, type EndpointConfigSource } from '../src/index.js';
import { accountRuntimeFixture } from './account-runtime-fixture.js';

const SECRET = 'synthetic-resolved-secret-0123456789';
const spec: AdapterConsoleSpec = { adapterKey: 'demo', adapterDisplayName: 'Demo',
  readPermission: 'demo:read', writePermission: 'demo:write', fields: [{ key: 'token', required: true, env: true }, { key: 'label' }] };

function configFile(block: Record<string, unknown>) {
  const file = { block, revision: 'r1', writes: [] as unknown[] };
  const source: EndpointConfigSource = {
    read: vi.fn(async () => ({ config: structuredClone(file.block), revision: file.revision })),
    writeEndpoints: vi.fn(async (_owner: PluginId, endpoints, expectedRevision) => {
      file.writes.push(structuredClone(endpoints));
      if (expectedRevision !== file.revision) throw new AdapterManagementError('conflict', 'file changed');
      file.block = { ...file.block, endpoints: structuredClone(endpoints) };
      file.revision = 'r2';
      return { revision: file.revision, missingEnv: ['DEMO_SAVED_TOKEN'] };
    }),
  };
  return { file, source };
}

describe('adapter Console RPC: endpoint-drift / endpoint-import / endpoint-writeback (#1250)', () => {
  it('lists drift, imports with references kept and writes back without plaintext', async () => {
    const { file, source } = configFile({ endpoints: [{ id: 'fresh', token: '${FRESH_TOKEN}', label: 'from-yml' }] });
    const f = await accountRuntimeFixture({ persistence: { configSource: source,
      secrets: { resolve: async () => SECRET } } });
    const rpc = createAdapterConsoleRpc(spec), call = f.call();
    await rpc.methods.get('endpoint-add')!.handler(f.request({ id: 'saved', values: { token: SECRET } }), call);

    const drift = rpc.methods.get('endpoint-drift')!;
    expect(drift.readOnly).toBe(true);
    expect(drift.requiredPermissions).toEqual(['demo:read']);
    const listed = await drift.handler({}, call) as Record<string, unknown>;
    expect(listed).toMatchObject({ authority: 'snapshot', canImport: true, canWriteback: true,
      entries: [{ id: 'fresh', kind: 'config_only' }, { id: 'saved', kind: 'snapshot_only' }] });
    expect(JSON.stringify(listed)).not.toContain(SECRET);

    const imported = rpc.methods.get('endpoint-import')!;
    expect(imported.requiredPermissions).toEqual(['demo:write']);
    await expect(imported.handler({ id: 'fresh', expectedRevision: 0 }, call)).rejects.toMatchObject({ code: 'conflict' });
    // An import overwrites saved accounts: the caller must name the list revision it looked at.
    await expect(imported.handler({ id: 'fresh', start: true }, call))
      .rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining('expectedRevision') });
    expect([...f.repository.state.values()].flatMap(snapshot => snapshot.endpoints).some(record => record.endpointId === 'fresh')).toBe(false);
    await expect(imported.handler({ id: 'nobody', expectedRevision: f.adapter.revision }, call)).rejects.toMatchObject({ code: 'not_found' });
    const result = await imported.handler({ id: 'fresh', start: true, expectedRevision: f.adapter.revision }, call) as Record<string, unknown>;
    expect(result).toMatchObject({ saved: true });
    const persisted = [...f.repository.state.values()].flatMap(snapshot => snapshot.endpoints).find(record => record.endpointId === 'fresh');
    expect(persisted).toMatchObject({ desiredEnabled: true, secretRefs: { token: '${FRESH_TOKEN}' }, config: { id: 'fresh', label: 'from-yml' } });
    expect(JSON.stringify(result)).not.toContain(SECRET);

    const writeback = rpc.methods.get('endpoint-writeback')!;
    expect(writeback.requiredPermissions).toEqual(['demo:write']);
    await expect(writeback.handler({ ids: [] }, call)).rejects.toMatchObject({ code: 'invalid_input' });
    const written = await writeback.handler({ ids: ['saved'] }, call) as Record<string, unknown>;
    expect(written).toMatchObject({ saved: true, revision: 'r2', placeholders: [{ id: 'saved', path: 'token', variable: 'DEMO_SAVED_TOKEN' }],
      // The instance block reloads: every account of this Adapter instance reconnects (#1250 review G5).
      reconnectsAll: true, message: expect.stringContaining('全部账号会随配置重载重新连接') });
    expect(file.block.endpoints).toEqual([
      { id: 'fresh', token: '${FRESH_TOKEN}', label: 'from-yml' },
      { id: 'saved', token: '${DEMO_SAVED_TOKEN}' },
    ]);
    expect(JSON.stringify(file.writes)).not.toContain(SECRET);
    expect(JSON.stringify(written)).not.toContain(SECRET);
    // The file moved since the read: a clear conflict, nothing else written.
    vi.mocked(source.read).mockResolvedValueOnce({ config: structuredClone(file.block), revision: 'stale' });
    await expect(writeback.handler({ ids: ['saved'] }, call)).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('刷新') });
  });

  it('reserves the new method names and refuses them without a configuration source', async () => {
    expect(() => createAdapterConsoleRpc({ ...spec, actions: { 'endpoint-import': { label: 'x', handler: async () => ({}) } } })).toThrow(/Reserved/);
    const f = await accountRuntimeFixture();
    const rpc = createAdapterConsoleRpc(spec);
    await expect(rpc.methods.get('endpoint-drift')!.handler({}, f.call())).rejects.toMatchObject({ code: 'unsupported' });
  });
});
