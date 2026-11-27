import { describe, expect, it, vi } from 'vitest';
import { PluginConsoleRpcError } from '@zhin.js/plugin-runtime';
import { createAdapterConsoleRpc, AdapterIdentityUnsupportedError, AdapterManagementError, type AdapterConsoleSpec } from '../src/index.js';
import { accountRuntimeFixture } from './account-runtime-fixture.js';

const spec: AdapterConsoleSpec = { adapterKey: 'demo', adapterDisplayName: 'Demo',
  readPermission: 'demo:read', writePermission: 'demo:write', fields: [{ key: 'token', required: true, env: true }, { key: 'label' }] };


describe('createAdapterConsoleRpc uses the exact owned runtime account authority', () => {
  it('reports only owned configuration/runtime metadata and masks both inline credentials and env references', async () => {
    const f = await accountRuntimeFixture(); const rpc = createAdapterConsoleRpc(spec), call = f.call();
    const add = rpc.methods.get('endpoint-add')!;
    await add.handler(f.request({ id: 'inline', values: { token: 'synthetic-secret', label: 'before' } }), call);
    await add.handler(f.request({ id: 'reference', values: { token: '${SYNTHETIC_TOKEN}' } }), call);
    await f.otherAdapter.add(f.otherAdapter.revision, { endpointId: 'other-account', config: { id: 'other-account', token: 'other-secret' } });
    const status = await rpc.methods.get('status')!.handler({}, call);
    expect(status).toMatchObject({ adapterKey: 'demo', displayName: 'Demo', canAdd: true, canRemove: true, configStore: true,
      readPermission: 'demo:read', writePermission: 'demo:write', running: [],
      configured: [expect.objectContaining({ id: 'inline', instanceId: expect.any(String), values: { token: '••••••', label: 'before' } }), expect.objectContaining({ id: 'reference', values: { token: '••••••' } })] });
    expect(JSON.stringify(status)).not.toContain('synthetic-secret'); expect(JSON.stringify(status)).not.toContain('SYNTHETIC_TOKEN'); expect(JSON.stringify(status)).not.toContain('other-account');
    expect(rpc.methods.get('status')!.requiredPermissions).toEqual(['demo:read']); expect(add.requiredPermissions).toEqual(['demo:write']); expect(f.use).not.toHaveBeenCalled();
  });
  it('saves inactive accounts via one CAS and starts/stops only the explicitly selected instance', async () => {
    const f = await accountRuntimeFixture(), rpc = createAdapterConsoleRpc(spec), call = f.call(); const pid = process.pid;
    expect(await rpc.methods.get('endpoint-add')!.handler(f.request({ id: 'bot', values: { token: 'synthetic' } }), call)).toMatchObject({ saved: true, restartRequired: false });
    const row = f.adapter.list()[0]!; expect(row.desiredEnabled).toBe(false); expect(f.adapter.created).toHaveLength(0); expect(f.repository.compareAndSet).toHaveBeenCalledTimes(1);
    await rpc.methods.get('endpoint-start')!.handler(f.request({ instanceId: row.instanceId }), call);
    await vi.waitFor(() => expect(f.adapter.list()[0]!.started).toBe(true));
    expect(f.adapter.created).toHaveLength(1); const native = f.adapter.created[0]!; expect(native.connect).toHaveBeenCalledOnce();
    await rpc.methods.get('endpoint-stop')!.handler(f.request({ instanceId: row.instanceId }), call);
    await vi.waitFor(() => expect(native.disconnect).toHaveBeenCalledOnce()); expect(f.adapter.list()[0]!.desiredEnabled).toBe(false);
    expect(f.source).toEqual({ endpoints: [] }); expect(f.store.current.generation).toBe(0); expect(process.pid).toBe(pid); expect(f.use).not.toHaveBeenCalled();
  });
  it('preserves untouched credentials on patch and rejects identity/policy or cross-owner updates before persistence', async () => {
    const f = await accountRuntimeFixture(), rpc = createAdapterConsoleRpc(spec), call = f.call();
    await rpc.methods.get('endpoint-add')!.handler(f.request({ id: 'bot', values: { token: 'synthetic', label: 'before' } }), call);
    const row = f.adapter.list()[0]!;
    await rpc.methods.get('endpoint-update')!.handler(f.request({ instanceId: row.instanceId, values: { label: 'after', token: '' } }), call);
    expect(f.repository.state.get(f.adapter.descriptor.id)!.endpoints[0]!.config).toMatchObject({ token: 'synthetic', label: 'after' });
    const writes = f.repository.compareAndSet.mock.calls.length;
    for (const values of [{ id: 'another' }, { master: 'intruder' }, { unknown: 'field' }]) await expect(rpc.methods.get('endpoint-update')!.handler(f.request({ instanceId: row.instanceId, values }), call)).rejects.toMatchObject({ code: 'invalid_input' });
    await f.otherAdapter.add(f.otherAdapter.revision, { endpointId: 'other', config: { id: 'other', token: 'other' } });
    const other = f.otherAdapter.list()[0]!;
    await expect(rpc.methods.get('endpoint-stop')!.handler(f.request({ instanceId: other.instanceId }), call)).rejects.toMatchObject({ code: 'not_found' });
    expect(f.repository.compareAndSet).toHaveBeenCalledTimes(writes + 1);
  });
  it('shows the platform reason when it declines to verify a credential-only change (#1250 b115)', async () => {
    const f = await accountRuntimeFixture(), rpc = createAdapterConsoleRpc(spec), call = f.call();
    await rpc.methods.get('endpoint-add')!.handler(f.request({ id: 'bot', values: { token: 'synthetic' } }), call);
    const row = f.adapter.list()[0]!;
    vi.spyOn(f.adapter, 'update').mockRejectedValueOnce(new AdapterIdentityUnsupportedError('该平台暂不支持只换密钥，请使用替换账号'));
    await expect(rpc.methods.get('endpoint-update')!.handler(f.request({ instanceId: row.instanceId, values: { token: 'rotated' } }), call))
      .rejects.toMatchObject({ code: 'unsupported', message: '该平台暂不支持只换密钥，请使用替换账号' });
    vi.spyOn(f.adapter, 'update').mockRejectedValueOnce(new AdapterManagementError('unsupported', 'Identity cannot be verified; use explicit account replacement'));
    await expect(rpc.methods.get('endpoint-update')!.handler(f.request({ instanceId: row.instanceId, values: { token: 'rotated' } }), call))
      .rejects.toMatchObject({ code: 'unsupported', message: '账号操作未能完成，请检查输入并刷新状态' });
  });
  it('masks and bounds the platform reason, and recognizes a reason thrown by another package copy (#1250 b115)', async () => {
    const f = await accountRuntimeFixture(), rpc = createAdapterConsoleRpc(spec), call = f.call();
    await rpc.methods.get('endpoint-add')!.handler(f.request({ id: 'bot', values: { token: 'synthetic' } }), call);
    const row = f.adapter.list()[0]!, update = () => rpc.methods.get('endpoint-update')!.handler(f.request({ instanceId: row.instanceId, values: { token: 'rotated' } }), call);
    const error = new AdapterIdentityUnsupportedError(`不支持 token=leaked-secret-value ${'很长的原因'.repeat(80)}`);
    expect(error.name).toBe('AdapterIdentityUnsupportedError');
    expect(error).toBeInstanceOf(AdapterManagementError);
    vi.spyOn(f.adapter, 'update').mockRejectedValueOnce(error);
    let shown: PluginConsoleRpcError | undefined;
    try { await update(); } catch (cause) { shown = cause as PluginConsoleRpcError; }
    expect(shown).toMatchObject({ code: 'unsupported' });
    expect(shown!.message).not.toContain('leaked-secret-value');
    expect(shown!.message.length).toBeLessThanOrEqual(201);
    expect(shown!.message.endsWith('…')).toBe(true);
    // A copy of this package bundled by a plugin: same brand, different class.
    const copy = Object.assign(new Error('copy'), { code: 'unsupported', reason: '另一份副本的原因',
      [Symbol.for('zhin.js/adapter:identity-unsupported')]: true });
    expect(AdapterIdentityUnsupportedError.is(copy)).toBe(true);
    expect(AdapterIdentityUnsupportedError.is(Object.assign(new Error('plain'), { code: 'unsupported', reason: 'x' }))).toBe(false);
    vi.spyOn(f.adapter, 'update').mockRejectedValueOnce(copy);
    await expect(update()).rejects.toMatchObject({ code: 'unsupported', message: '另一份副本的原因' });
  });
  it('rejects missing/undeclared fields, duplicate ids and stale revisions without a second write', async () => {
    const f = await accountRuntimeFixture(), rpc = createAdapterConsoleRpc(spec), call = f.call(), add = rpc.methods.get('endpoint-add')!;
    for (const values of [{}, { token: 'synthetic', unknown: 'field' }]) await expect(add.handler(f.request({ id: 'bot', values }), call)).rejects.toBeInstanceOf(PluginConsoleRpcError);
    expect(f.repository.compareAndSet).not.toHaveBeenCalled();
    const original = f.request({ id: 'bot', values: { token: 'synthetic' } }); await add.handler(original, call);
    await expect(add.handler(original, call)).rejects.toMatchObject({ code: 'conflict' });
    await expect(add.handler(f.request({ id: 'bot', values: { token: 'another' } }), call)).rejects.toMatchObject({ code: 'conflict' });
    await expect(add.handler(f.request({ expectedGeneration: 1, id: 'another', values: { token: 'synthetic' } }), call)).rejects.toMatchObject({ code: 'conflict' });
    expect(f.repository.compareAndSet).toHaveBeenCalledTimes(1);
  });
  it('removes the selected desired account and reports a later missing instance without touching source files', async () => {
    const f = await accountRuntimeFixture(), rpc = createAdapterConsoleRpc(spec), call = f.call();
    await rpc.methods.get('endpoint-add')!.handler(f.request({ id: 'bot', values: { token: 'synthetic' } }), call); const row = f.adapter.list()[0]!;
    const request = () => f.request({ instanceId: row.instanceId }); await rpc.methods.get('endpoint-remove')!.handler(request(), call);
    expect(f.adapter.list()).toEqual([]); await expect(rpc.methods.get('endpoint-remove')!.handler(request(), call)).rejects.toMatchObject({ code: 'not_found' }); expect(f.use).not.toHaveBeenCalled();
  });
  it('requires operator confirmation for the first static-account migration', async () => {
    const f = await accountRuntimeFixture({ migration: true, config: { endpoints: [{ id: 'old', token: 'synthetic-old' }] } }), rpc = createAdapterConsoleRpc(spec);
    const add = rpc.methods.get('endpoint-add')!, request = f.request({ id: 'new', values: { token: 'synthetic-new' } });
    await expect(add.handler(request, f.call())).rejects.toMatchObject({ code: 'conflict' });
    await expect(add.handler({ ...request, confirmMigration: true }, f.call({ runtime: { ...f.call().runtime!, operator: false } }))).rejects.toMatchObject({ code: 'forbidden' });
    expect(f.repository.compareAndSet).not.toHaveBeenCalled(); const old = f.adapter.list()[0]!;
    await add.handler({ ...request, confirmMigration: true }, f.call()); expect(f.adapter.list()[0]!.canonicalId).toBe(old.canonicalId);
    expect(f.adapter.list().find(row => row.endpointId === 'new')!.desiredEnabled).toBe(false);
  });
  it('keeps commit_unknown distinct from failure and never retries when status cannot verify persistence', async () => {
    const f = await accountRuntimeFixture(), rpc = createAdapterConsoleRpc(spec), call = f.call();
    f.repository.compareAndSet.mockRejectedValue(new AdapterManagementError('commit_unknown', 'synthetic unknown commit'));
    await expect(rpc.methods.get('endpoint-add')!.handler(f.request({ id: 'bot', values: { token: 'synthetic' } }), call)).rejects.toMatchObject({ code: 'commit_unknown' });
    f.repository.load.mockRejectedValue(new Error('synthetic DB read failure'));
    await expect(rpc.methods.get('status')!.handler({}, call)).rejects.toMatchObject({ code: 'commit_unknown' });
    expect(f.repository.compareAndSet).toHaveBeenCalledTimes(1); expect(f.adapter.list()).toEqual([]);
  });
  it('degrades to read-only without persistence while retaining the safe static configured view', async () => {
    const rpc = createAdapterConsoleRpc({ ...spec, getConfig: () => ({ endpoints: [{ id: 'bot', token: 'synthetic' }] }) });
    const call = { signal: new AbortController().signal }; const status = await rpc.methods.get('status')!.handler({}, call);
    expect(status).toMatchObject({ canAdd: false, canRemove: false, configStore: false, configured: [{ id: 'bot', values: { token: '••••••' } }] });
    await expect(rpc.methods.get('endpoint-add')!.handler({ id: 'new', values: { token: 'synthetic' } }, call)).rejects.toMatchObject({ code: 'unsupported' });
    const f = await accountRuntimeFixture({ noDatabase: true }); await expect(rpc.methods.get('endpoint-add')!.handler(f.request({ id: 'new', values: { token: 'synthetic' } }), f.call())).rejects.toMatchObject({ code: 'unsupported' });
  });
  it('shows an env field only as a whole ${VAR} without default; ${VAR:-default} is masked (the default can be the secret)', async () => {
    const rpc = createAdapterConsoleRpc({ ...spec, getConfig: () => ({ endpoints: [
      { id: 'plain', token: '${DEMO_TOKEN}' },
      { id: 'defaulted', token: '${DEMO_TOKEN:-synthetic-default-secret}' },
      { id: 'assigned', token: '${DEMO_TOKEN:=synthetic-assigned-secret}' },
      { id: 'malformed', token: '${DEMO_TOKEN' },
    ] }) });
    const status = await rpc.methods.get('status')!.handler({}, { signal: new AbortController().signal });
    expect(status).toMatchObject({ configured: [
      { id: 'plain', values: { token: '${DEMO_TOKEN}' } },
      { id: 'defaulted', values: { token: '••••••' } },
      { id: 'assigned', values: { token: '••••••' } },
      { id: 'malformed', values: { token: '••••••' } },
    ] });
    expect(JSON.stringify(status)).not.toContain('synthetic-');
  });
  it('exposes platform actions with existing permission metadata and filters the displayed action list', async () => {
    const handler = vi.fn(async () => ({ message: 'ok', details: { state: 'waiting' } }));
    const rpc = createAdapterConsoleRpc({ ...spec, availableActions: () => ['bind'], actions: { bind: { label: 'Bind', handler }, hidden: { label: 'Hidden', handler } } });
    expect(await rpc.methods.get('status')!.handler({}, { signal: new AbortController().signal })).toMatchObject({ actions: [{ name: 'bind', label: 'Bind', fields: [], options: [] }] });
    expect(rpc.methods.get('bind')!.requiredPermissions).toEqual(['demo:write']);
    await expect(rpc.methods.get('bind')!.handler({}, { signal: new AbortController().signal })).resolves.toEqual({ message: 'ok', details: { state: 'waiting' } });
  });
  it('rejects reserved action names', () => {
    expect(() => createAdapterConsoleRpc({ ...spec, actions: { 'endpoint-add': { label: 'Invalid', handler: async () => ({}) } } })).toThrow(/Reserved/);
  });
  it('projects rich field metadata (label, group, placeholder, options and i18n) when defined', async () => {
    const richSpec: AdapterConsoleSpec = {
      adapterKey: 'demo',
      adapterDisplayName: 'Demo',
      fields: [
        {
          key: 'mode',
          label: '连接模式',
          labelI18n: { en: 'Connection Mode' },
          group: '基础认证',
          groupI18n: { en: 'Basic Auth' },
          placeholder: 'websocket',
          placeholderI18n: { en: 'websocket' },
          options: [
            { value: 'websocket', label: 'WebSocket', labelI18n: { en: 'WebSocket' } },
            { value: 'webhook', label: 'Webhook', labelI18n: { en: 'Webhook' } },
          ],
        },
      ],
    };
    const rpc = createAdapterConsoleRpc(richSpec);
    const status = await rpc.methods.get('status')!.handler({}, { signal: new AbortController().signal });
    expect(status).toMatchObject({
      fields: [
        {
          key: 'mode',
          required: false,
          env: false,
          secret: false,
          label: '连接模式',
          labelI18n: { en: 'Connection Mode' },
          group: '基础认证',
          groupI18n: { en: 'Basic Auth' },
          placeholder: 'websocket',
          placeholderI18n: { en: 'websocket' },
          options: [
            { value: 'websocket', label: 'WebSocket', labelI18n: { en: 'WebSocket' } },
            { value: 'webhook', label: 'Webhook', labelI18n: { en: 'Webhook' } },
          ],
        },
      ],
    });
  });
});

it('does not use the removed configuration-file account writer when a runtime directory is absent', async () => {
  const writer = { list: vi.fn(), add: vi.fn(), remove: vi.fn() };
  // A JavaScript caller can still pass an extra argument; the runtime must never consult it.
  const rpc: ReturnType<typeof createAdapterConsoleRpc> = Reflect.apply(createAdapterConsoleRpc, undefined, [spec, { has: () => true, use: () => writer }]);
  const call = { signal: new AbortController().signal };
  await expect(rpc.methods.get('endpoint-add')!.handler({ id: 'new', values: { token: 'synthetic-only' } }, call)).rejects.toMatchObject({ code: 'unsupported' });
  await expect(rpc.methods.get('endpoint-remove')!.handler({ id: 'bot' }, call)).rejects.toMatchObject({ code: 'unsupported' });
  expect(writer.list).not.toHaveBeenCalled(); expect(writer.add).not.toHaveBeenCalled(); expect(writer.remove).not.toHaveBeenCalled();
});
