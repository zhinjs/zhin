import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allNodes, createHookEnv, isComponent, textOf } from '../../tests/hook-harness.js';
import type { AdapterConsoleStatus, AdapterConsoleLoginTask } from './types.js';

const file = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const text = textOf;
const all = allNodes;

type Handlers = { onClick: () => Promise<void> | void; disabled?: boolean; [key: string]: unknown };
type Confirm = { onConfirm: () => Promise<void> | void; beforeOpen?: () => boolean | void; disabled?: boolean; confirmLabel: string; message: string };

/** Run production hooks and event handlers; HTTP boundaries remain the actual remoteApi functions. */
function harness() {
  const env = createHookEnv();
  const page = env.load(file('./AdapterConsolePage.tsx'), ['AdapterConsoleSession', 'captureAdapterConsoleContext', 'runtimeLoginMatches']);
  const owner = env.load(file('../ui/plugin-id.ts'));
  const nodes = () => all(env.tree());
  const buttonNodes = () => nodes().filter(node => isComponent(node, 'Button'));
  return {
    exports: { ...page, resolveAdapterConsolePluginId: owner.resolveAdapterConsolePluginId },
    mount: env.mount, settle: env.settle, unmount: env.unmount, nodes,
    button(label: string) { const node = buttonNodes().find(node => text(node.props?.children) === label); if (!node) throw new Error(`missing button ${label}: ${text(env.tree())}`); return node.props as Handlers; },
    confirm(label: string) { const node = nodes().find(node => isComponent(node, 'ConfirmButton') && text(node.props?.children) === label); if (!node) throw new Error(`missing confirm button ${label}`); return node.props as unknown as Confirm; },
    hasControl(labels: string[]) { return nodes().some(node => (isComponent(node, 'Button') || isComponent(node, 'ConfirmButton')) && labels.includes(text(node.props?.children))); },
    input(at: number) { return nodes().filter(node => node.type === 'input')[at]!.props as { value: string; onChange: (e: { target: { value: string } }) => void }; },
    select(at: number) { return nodes().filter(node => node.type === 'select')[at]!.props as { value: string; onChange: (e: { target: { value: string } }) => void }; },
    text: () => text(env.tree()),
  };
}
const storage = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key) }; };
function status(): AdapterConsoleStatus {
  return { adapterKey: 'icqq', displayName: 'ICQQ', page: '/', fields: [{ key: 'password', required: true, env: true, secret: true }, { key: 'server', required: false, env: false, secret: false }], canAdd: true, canRemove: true, configStore: true, running: [], actions: [],
    configured: [{ id: '10001', instanceId: 'instance-old', values: { password: '••••••', server: 'old-server' } }],
    runtime: { adapterId: 'capability', generation: 4, revision: 2, needsMigration: false, canManage: true, canMigrate: false, canUpdate: true, canReplace: true, mutableFields: ['password', 'server'], identityFields: ['id'], endpoints: [{ instanceId: 'instance-old', canonicalId: 'canonical-old', endpointId: '10001', revision: 2, desiredEnabled: false, epoch: 5, incarnationId: 'incarnation-current', started: false, admitted: false }] } };
}
function fixture(initial = status(), tasks: AdapterConsoleLoginTask[] = [], startMode = '') {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('location', { pathname: '/icqq', origin: 'https://host-a.test' });
  vi.stubGlobal('navigator', { languages: ['zh-CN'] });
  vi.stubGlobal('window', { location, confirm: vi.fn(() => true), dispatchEvent: vi.fn() });
  localStorage.setItem('zhin_api_base', 'https://host-a.test'); localStorage.setItem('zhin_api_token', 'synthetic-token');
  let view = structuredClone(initial), mode = startMode, finish: (() => void) | undefined, finishLogin: (() => void) | undefined, releaseStatus: (() => void) | undefined, statusFails = false, endpointsFail = startMode === 'endpoints-down';
  let hostEndpoints: unknown[] = [];
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>; calls.push({ url, body });
    const reply = (data: unknown, code = 200, errorCode?: string) => new Response(JSON.stringify(code === 200 ? { success: true, data } : { success: false, code: errorCode, error: 'safe synthetic error' }), { status: code, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/console/api/pages')) return Response.json({ pages: [{ owner: url.includes('host-b') ? 'plugin-b' : 'plugin-a', localName: 'index', source: 'adapters/icqq/pages/index/index.ts', route: '/icqq' }] });
    if (body.type === 'plugin.plugin-a.status' || body.type === 'plugin.plugin-b.status') {
      if (mode === 'slow-status') await new Promise<void>(resolve => { releaseStatus = resolve; });
      if (statusFails) return reply(undefined, 503, 'unavailable');
      return reply(structuredClone(view));
    }
    if (body.type === 'endpoint.list') return endpointsFail ? reply(undefined, 503, 'unavailable') : reply({ endpoints: structuredClone(hostEndpoints) });
    if (body.type === 'login.list') { const snapshot = structuredClone(tasks); if (mode === 'late-login') await new Promise<void>(resolve => { finishLogin = resolve; }); return reply({ tasks: snapshot }); }
    if (String(body.type).includes('.endpoint-')) {
      if (mode === 'late') await new Promise<void>(resolve => { finish = resolve; });
      if (mode === 'conflict' || (body.data as { expectedRevision: number | null }).expectedRevision !== view.runtime!.revision) return reply(undefined, 409, 'conflict');
      if (mode === 'unknown') return reply(undefined, 503, 'commit_unknown');
      view = { ...view, runtime: { ...view.runtime!, revision: view.runtime!.revision! + 1, needsMigration: false, endpoints: view.runtime!.endpoints.map(endpoint => String(body.type).endsWith('.endpoint-stop') ? { ...endpoint, desiredEnabled: false } : endpoint) } };
      return reply({ saved: true, restartRequired: false, runtime: view.runtime, execution: { status: 'pending' } });
    }
    return reply({});
  }));
  const h = harness(); const current = h.exports.captureAdapterConsoleContext!() as () => boolean;
  h.mount(() => h.exports.AdapterConsoleSession!({ adapterKey: 'icqq', isCurrent: current }));
  return { h, calls, setMode(value: string) { mode = value; }, releaseStatus: () => releaseStatus?.(), failStatus(value: boolean) { statusFails = value; }, failEndpoints(value: boolean) { endpointsFail = value; }, setHostEndpoints(value: unknown[]) { hostEndpoints = value; }, finish: () => finish?.(), finishLogin: () => finishLogin?.(), replaceView(value: AdapterConsoleStatus) { view = value; }, writes: () => calls.filter(call => String(call.body.type).includes('.endpoint-')) };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('shared runtime Adapter page production handlers', () => {
  it('uses exact instance, generation and revision for start/stop/remove without touching startup source', async () => {
    const f = fixture(); await f.h.settle();
    expect(f.h.text()).not.toContain('重启后生效');
    await f.h.button('启动').onClick(); await f.h.settle();
    expect(f.writes()[0]!.body).toMatchObject({ type: 'plugin.plugin-a.endpoint-start', data: { instanceId: 'instance-old', expectedGeneration: 4, expectedRevision: 2 } });
    expect(f.h.text()).toContain('已保存，操作进行中');
    const remove = f.h.confirm('删除'); expect(remove.confirmLabel).toBe('删除账号'); await remove.onConfirm(); await f.h.settle();
    expect(f.writes()[1]!.body).toMatchObject({ type: 'plugin.plugin-a.endpoint-remove', data: { instanceId: 'instance-old', expectedRevision: 3 } });
    expect(f.calls.some(call => /config|env/u.test(String(call.body.type)))).toBe(false); f.h.unmount();
  });

  it('adds a saved-only account using the captured CAS and clears the submitted credential draft', async () => {
    const f = fixture(); await f.h.settle(); await f.h.button('添加').onClick(); await f.h.settle();
    f.h.input(0).onChange({ target: { value: '10002' } }); await f.h.settle();
    f.h.input(1).onChange({ target: { value: 'synthetic-add-only' } }); await f.h.settle();
    f.h.input(2).onChange({ target: { value: 'new-server' } }); await f.h.settle();
    const save = f.h.nodes().filter(node => isComponent(node, 'Button') && text(node.props?.children) === '添加').at(-1)!.props!;
    await (save.onClick as () => Promise<void>)(); await f.h.settle();
    expect(f.writes()).toHaveLength(1); expect(f.writes()[0]!.body).toMatchObject({ type: 'plugin.plugin-a.endpoint-add', data: { id: '10002', values: { password: 'synthetic-add-only', server: 'new-server' }, expectedGeneration: 4, expectedRevision: 2 } });
    expect(f.h.text()).toContain('已保存，请手动启动'); expect(f.h.nodes().filter(node => node.type === 'input')).toHaveLength(0); f.h.unmount();
  });

  it('lists legacy accounts and sends migration consent only after the user confirms this operation', async () => {
    const s = status(); s.runtime = { ...s.runtime!, needsMigration: true, canMigrate: true, revision: null };
    const f = fixture(s); await f.h.settle(); expect(f.h.text()).toContain('10001');
    await f.h.button('启动').onClick(); await f.h.settle(); expect(f.writes()).toHaveLength(0);
    expect(f.h.text()).toContain('确认迁移以下账号'); await f.h.button('确认迁移').onClick(); await f.h.settle();
    expect(f.writes()[0]!.body.data).toEqual({ instanceId: 'instance-old', expectedGeneration: 4, expectedRevision: null, confirmMigration: true }); f.h.unmount();
  });

  it.each(['conflict', 'unknown'])('blocks resubmission after %s until an explicit successful reread', async mode => {
    const f = fixture(); await f.h.settle(); f.setMode(mode);
    await f.h.button('启动').onClick(); await f.h.settle(); expect(f.writes()).toHaveLength(1); expect(f.h.button('启动').disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(6000); await f.h.settle(); expect(f.h.button('启动').disabled).toBe(true); expect(f.writes()).toHaveLength(1);
    f.setMode(''); await f.h.button('刷新').onClick(); await f.h.settle(); expect(f.h.button('启动').disabled).toBe(false); f.h.unmount();
  });

  it('edits a patch without masked credentials and replaces identity in one CAS with fresh required credentials', async () => {
    const f = fixture(); await f.h.settle(); await f.h.button('编辑').onClick(); await f.h.settle();
    f.h.input(2).onChange({ target: { value: 'new-server' } }); await f.h.settle();
    await f.h.button('保存').onClick(); await f.h.settle();
    expect(f.writes()[0]!.body).toMatchObject({ type: 'plugin.plugin-a.endpoint-update', data: { values: { server: 'new-server' }, instanceId: 'instance-old', expectedRevision: 2 } });
    await f.h.button('编辑').onClick(); await f.h.settle(); f.h.input(0).onChange({ target: { value: '10002' } }); await f.h.settle();
    expect(f.h.confirm('保存').beforeOpen!()).toBe(false); await f.h.settle(); expect(f.writes()).toHaveLength(1); expect(f.h.text()).toContain('请填写 password');
    f.h.input(1).onChange({ target: { value: 'synthetic-replacement-only' } }); await f.h.settle();
    const replace = f.h.confirm('保存'); expect(replace.confirmLabel).toBe('替换账号'); expect(replace.beforeOpen!()).toBe(true); await replace.onConfirm(); await f.h.settle();
    expect(f.writes()[1]!.body).toMatchObject({ type: 'plugin.plugin-a.endpoint-replace', data: { id: '10002', instanceId: 'instance-old', values: { password: 'synthetic-replacement-only', server: 'old-server' }, expectedRevision: 3 } });
    expect(f.h.text()).toContain('已保存，请手动启动'); f.h.unmount();
  });

  it('binds login actions to the exact live canonical/instance/epoch and hides stale or unbound runtime tasks', async () => {
    const base = { id: 'task', adapter: 'icqq', endpointKey: '10001', type: 'qrcode', payload: {}, createdAt: 1 };
    const identity = { canonicalId: 'canonical-old', instanceId: 'instance-old', epoch: 5, incarnationId: 'incarnation-current' };
    const enabled = status(); enabled.runtime = { ...enabled.runtime!, endpoints: enabled.runtime!.endpoints.map(endpoint => ({ ...endpoint, desiredEnabled: true })) };
    const f = fixture(enabled, [{ ...base, id: 'live', endpointIdentity: identity }, { ...base, id: 'old-epoch', endpointIdentity: { ...identity, epoch: 4 } }, { ...base, id: 'recreated', endpointIdentity: { ...identity, instanceId: 'different' } }, { ...base, id: 'old-incarnation', endpointIdentity: { ...identity, incarnationId: 'incarnation-previous' } }, { ...base, id: 'unbound' }]);
    await f.h.settle(); expect(f.h.nodes().filter(node => isComponent(node, 'Button') && text(node.props?.children) === '已扫码，继续')).toHaveLength(1);
    await f.h.button('已扫码，继续').onClick(); await f.h.settle();
    expect(f.calls.find(call => call.body.type === 'login.submit')!.body).toMatchObject({ taskId: 'live', endpointIdentity: identity }); f.h.unmount();
  });

  it('hides a matching late login after stop and blocks both stale submit and cancel callbacks', async () => {
    const enabled = status(); enabled.runtime = { ...enabled.runtime!, endpoints: enabled.runtime!.endpoints.map(endpoint => ({ ...endpoint, desiredEnabled: true, started: false, admitted: false })) };
    const task = { id: 'old-live', adapter: 'icqq', endpointKey: '10001', type: 'qrcode', payload: { message: 'MATCHED LOGIN BEFORE STOP' }, createdAt: 1,
      endpointIdentity: { canonicalId: 'canonical-old', instanceId: 'instance-old', epoch: 5, incarnationId: 'incarnation-current' } };
    const f = fixture(enabled, [task]); await f.h.settle(); expect(f.h.text()).toContain('MATCHED LOGIN BEFORE STOP');
    const staleSubmit = f.h.button('已扫码，继续').onClick, staleCancel = f.h.button('取消').onClick;
    f.setMode('late-login'); const stopped = f.h.button('停止').onClick(); await f.h.settle();
    expect(f.writes()[0]!.body.type).toBe('plugin.plugin-a.endpoint-stop');
    expect(f.h.text()).not.toContain('MATCHED LOGIN BEFORE STOP');
    f.setMode(''); f.finishLogin(); await stopped; await f.h.settle();
    expect(f.h.text()).not.toContain('MATCHED LOGIN BEFORE STOP');
    await staleSubmit(); await staleCancel(); await f.h.settle();
    expect(f.calls.filter(call => call.body.type === 'login.submit' || call.body.type === 'login.cancel')).toHaveLength(0); f.h.unmount();
  });

  it.each([
    ['add', '保存'], ['update', '保存'], ['start', '启动'], ['stop', '停止'], ['remove', '删除'], ['replace', '替换'],
  ] as const)('uses human action labels and safe failure text for %s without exposing raw execution codes', async (action, label) => {
    const s = status(), execution = { instanceId: 'instance-old', action, revision: 2, status: 'failed' as const, code: 'opaque_internal_failure' };
    s.runtime = { ...s.runtime!, lastMutation: execution, endpoints: s.runtime!.endpoints.map(endpoint => ({ ...endpoint, execution })) };
    const f = fixture(s); await f.h.settle(); expect(f.h.text()).toContain(`最近操作：${label}`); expect(f.h.text()).toContain(`${label}失败`);
    expect(f.h.text()).not.toContain('opaque_internal_failure'); expect(f.h.text()).not.toContain(`最近操作：${action}`); f.h.unmount();
  });

  it('shows unfinished cleanup as plain closure failure without displaying the diagnostic code', async () => {
    const s = status(), execution = { instanceId: 'instance-old', action: 'stop' as const, revision: 2, status: 'failed' as const, code: 'endpoint_cleanup_failed' };
    s.runtime = { ...s.runtime!, lastMutation: execution, endpoints: s.runtime!.endpoints.map(endpoint => ({ ...endpoint, execution, retiring: true })) };
    const f = fixture(s); await f.h.settle(); expect(f.h.text()).toContain('关闭未完成'); expect(f.h.text()).not.toContain('endpoint_cleanup_failed'); f.h.unmount();
  });

  it('does not apply a late operation or let an old callback send to another Host/auth context', async () => {
    const f = fixture(); await f.h.settle(); const oldStart = f.h.button('启动').onClick; f.setMode('late'); const pending = oldStart(); await f.h.settle();
    localStorage.setItem('zhin_api_base', 'https://host-b.test'); f.finish(); await pending; await f.h.settle(); expect(f.h.text()).not.toContain('已保存，操作进行中');
    await oldStart(); expect(f.writes()).toHaveLength(1);
    expect(await f.h.exports.resolveAdapterConsolePluginId!('icqq')).toBe('plugin-b');
    localStorage.setItem('zhin_api_base', 'https://host-a.test'); expect(await f.h.exports.resolveAdapterConsolePluginId!('icqq')).toBe('plugin-a'); f.h.unmount();
  });

  it('resolves adapter console owner from npm adapter-*/pages sources as well as workspace adapters/*/pages', async () => {
    const f = fixture(); await f.h.settle();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).endsWith('/console/api/pages')) {
        return Response.json({ pages: [
          { owner: 'root/icqq', localName: 'index', source: 'node_modules/@zhin.js/adapter-icqq/pages/index/index.ts', route: '/icqq' },
          { owner: 'root/qq', localName: 'index', source: 'node_modules/@zhin.js/adapter-qq/pages/index.tsx', route: '/qq' },
        ] });
      }
      return Response.json({ success: true, data: {} });
    }));
    expect(await f.h.exports.resolveAdapterConsolePluginId!('icqq')).toBe('root/icqq');
    expect(await f.h.exports.resolveAdapterConsolePluginId!('qq')).toBe('root/qq');
    f.h.unmount();
  });

  it('keeps retiring accounts read-only and disables migration actions for nonoperators', async () => {
    const s = status(); s.runtime = { ...s.runtime!, needsMigration: true, canMigrate: false, endpoints: s.runtime!.endpoints.map(value => ({ ...value, retiring: true })) };
    const f = fixture(s); await f.h.settle(); expect(f.h.text()).toContain('正在关闭'); expect(f.h.text()).toContain('首次迁移需要管理员确认');
    expect(f.h.hasControl(['编辑', '启动', '删除'])).toBe(false); f.h.unmount();
  });

  it('keeps an open edit bound to its original revision rather than rebasing it during polling', async () => {
    const f = fixture(); await f.h.settle(); await f.h.button('编辑').onClick(); await f.h.settle();
    const changed = status(); changed.runtime = { ...changed.runtime!, revision: 9 }; f.replaceView(changed);
    await vi.advanceTimersByTimeAsync(6000); await f.h.settle();
    f.h.input(2).onChange({ target: { value: 'draft-after-external-change' } }); await f.h.settle();
    await f.h.button('保存').onClick(); await f.h.settle();
    expect(f.writes()[0]!.body.data).toMatchObject({ expectedRevision: 2, values: { server: 'draft-after-external-change' } });
    expect(f.h.text()).toContain('账号清单已变化'); expect(f.h.input(2).value).toBe('draft-after-external-change'); f.h.unmount();
  });

  it('disables persistence mutations without storage while preserving exact canonical connection testing', async () => {
    const s = status(); s.runtime = { ...s.runtime!, canManage: false, canUpdate: false, canReplace: false, endpoints: s.runtime!.endpoints.map(value => ({ ...value, started: true })) };
    const f = fixture(s); await f.h.settle(); expect(f.h.button('启动').disabled).toBe(true); expect(f.h.button('添加').disabled).toBe(true);
    await f.h.button('测试连接').onClick(); await f.h.settle();
    expect(f.calls.find(call => call.body.type === 'endpoint.test')!.body).toMatchObject({ endpointKey: 'canonical-old' }); expect(f.writes()).toHaveLength(0); f.h.unmount();
  });

  it('shows configured accounts read-only without a runtime directory even if obsolete flags offer writes', async () => {
    const s = status(); delete s.runtime;
    const f = fixture(s); await f.h.settle();
    expect(f.h.text()).toContain('10001'); expect(f.h.text()).toContain('old-server');
    expect(f.h.text()).toContain('当前环境只能查看');
    expect(f.h.text()).not.toMatch(/重启后生效|写入配置后|\.env/u);
    expect(f.h.hasControl(['添加', '删除', '编辑', '保存', '启动', '停止'])).toBe(false);
    expect(f.writes()).toHaveLength(0); f.h.unmount();
  });

  it('hides login controls and rejects captured submit/cancel handlers after its runtime disappears', async () => {
    const base = status();
    const identity = { canonicalId: 'canonical-old', instanceId: 'instance-old', epoch: 5, incarnationId: 'incarnation-current' };
    const live = { ...base, runtime: { ...base.runtime!, endpoints: base.runtime!.endpoints.map(endpoint => ({ ...endpoint, desiredEnabled: true })) } };
    const f = fixture(live, [{ id: 'task', adapter: 'icqq', endpointKey: '10001', type: 'qrcode', payload: {}, createdAt: 1, endpointIdentity: identity }]);
    await f.h.settle(); const submit = f.h.button('已扫码，继续'), cancel = f.h.button('取消');
    f.replaceView({ ...base, runtime: undefined }); await f.h.button('刷新').onClick(); await f.h.settle();
    expect(f.h.text()).not.toContain('登录待办');
    await submit.onClick(); await cancel.onClick(); await f.h.settle();
    expect(f.calls.some(call => call.body.type === 'login.submit' || call.body.type === 'login.cancel')).toBe(false);
    f.h.unmount();
  });

  it('keeps ordinary custom actions available without runtime while rejecting custom account mutations', async () => {
    const s = { ...status(), runtime: undefined, actions: [
      { name: 'inspect', label: '查看平台资料', fields: [], options: [] },
      { name: 'save-account', label: '保存平台账号', accountMutation: true, fields: [], options: [] },
    ] };
    const f = fixture(s); await f.h.settle();
    expect(f.h.button('保存平台账号').disabled).toBe(true);
    await f.h.button('保存平台账号').onClick(); await f.h.settle();
    expect(f.calls.some(call => call.body.type === 'plugin.plugin-a.save-account')).toBe(false);
    await f.h.button('查看平台资料').onClick(); await f.h.settle();
    expect(f.calls.find(call => call.body.type === 'plugin.plugin-a.inspect')!.body.data).toEqual({});
    expect(f.writes()).toHaveLength(0); f.h.unmount();
  });

  it('captures custom account mutation CAS and requests migration consent before invoking its handler', async () => {
    const base = status();
    const f = fixture({ ...base, runtime: { ...base.runtime!, needsMigration: true, canMigrate: true, revision: null },
      actions: [{ name: 'save-account', label: '保存平台账号', accountMutation: true, fields: [], options: [] }] });
    await f.h.settle(); await f.h.button('保存平台账号').onClick(); await f.h.settle();
    expect(f.calls.some(call => call.body.type === 'plugin.plugin-a.save-account')).toBe(false);
    expect(f.h.text()).toContain('确认迁移以下账号');
    await f.h.button('确认迁移').onClick(); await f.h.settle();
    expect(f.calls.find(call => call.body.type === 'plugin.plugin-a.save-account')!.body.data).toEqual({ expectedGeneration: 4, expectedRevision: null, confirmMigration: true });
    f.h.unmount();
  });

  it('does not resubmit an unchanged masked nonsecret URL while editing nested number and boolean fields', async () => {
    const base = status();
    const f = fixture({ ...base, fields: [...base.fields,
      { key: 'url', type: 'string', required: false, env: false, secret: false },
      { key: 'proxy.port', type: 'number', required: false, env: false, secret: false },
      { key: 'enabled', type: 'boolean', required: false, env: false, secret: false },
    ], configured: [{ ...base.configured[0]!, values: { ...base.configured[0]!.values, url: '••••••', 'proxy.port': '1080', enabled: 'false' } }],
    runtime: { ...base.runtime!, mutableFields: [...base.runtime!.mutableFields, 'url', 'proxy.port', 'enabled'] } });
    await f.h.settle(); await f.h.button('编辑').onClick(); await f.h.settle();
    expect(f.h.input(3).value).toBe('••••••'); expect(f.h.input(4).value).toBe('1080'); expect(f.h.select(0).value).toBe('false');
    expect(f.h.nodes().find(node => node.type === 'option' && node.props?.value === '')?.props?.disabled).toBe(true);
    expect(f.h.nodes().filter(node => node.type === 'input')[4]!.props!.type).toBe('number');
    f.h.input(4).onChange({ target: { value: '1081' } }); await f.h.settle(); f.h.select(0).onChange({ target: { value: 'true' } }); await f.h.settle();
    await f.h.button('保存').onClick(); await f.h.settle();
    expect(f.writes()[0]!.body.data).toEqual({ instanceId: 'instance-old', expectedGeneration: 4, expectedRevision: 2, values: { 'proxy.port': '1081', enabled: 'true' } });
    expect(JSON.stringify(f.writes())).not.toContain('••••••'); f.h.unmount();
  });

  it('keeps credentials behind a native disclosure and exposes an accessible account editor', async () => {
    const f = fixture(); await f.h.settle();
    const disclosure = f.h.nodes().find(node => node.type === 'details');
    expect(disclosure).toBeDefined(); expect(disclosure!.props?.open).toBeUndefined();
    expect(f.h.nodes().find(node => node.type === 'nav')?.props?.['aria-label']).toBe('页面导航');
    await f.h.button('编辑').onClick(); await f.h.settle();
    expect(f.h.nodes().find(node => isComponent(node, 'Field'))?.props).toMatchObject({ label: '账号 ID' });
    expect(f.h.nodes().some(node => node.props?.autoFocus !== undefined)).toBe(false);
    f.h.unmount();
  });

  it('clears cancelled add-account credentials before reopening the form', async () => {
    const f = fixture(); await f.h.settle(); await f.h.button('添加').onClick(); await f.h.settle();
    f.h.input(1).onChange({ target: { value: 'synthetic-cancelled-draft' } }); await f.h.settle();
    expect(f.h.nodes().find(node => node.props?.['aria-controls'] === 'adapter-add-account')?.props?.['aria-expanded']).toBe(true);
    await f.h.button('取消').onClick(); await f.h.settle();
    await f.h.button('添加').onClick(); await f.h.settle();
    expect(f.h.input(1).value).toBe(''); expect(f.writes()).toHaveLength(0); f.h.unmount();
  });

  it('keeps an expired verification visible with guidance but disables submission', async () => {
    const s = status(); s.runtime = { ...s.runtime!, endpoints: s.runtime!.endpoints.map(endpoint => ({ ...endpoint, desiredEnabled: true })) };
    const f = fixture(s, [{ id: 'expired', adapter: 'icqq', endpointKey: '10001', type: 'qrcode', payload: {}, createdAt: 1, expiresAt: Date.now() - 1,
      endpointIdentity: { canonicalId: 'canonical-old', instanceId: 'instance-old', epoch: 5, incarnationId: 'incarnation-current' } }]);
    await f.h.settle(); expect(f.h.text()).toContain('验证已过期'); expect(f.h.button('已扫码，继续').disabled).toBe(true);
    expect(f.calls.some(call => call.body.type === 'login.submit')).toBe(false); f.h.unmount();
  });
});

describe('loading and failure states (ICQQ page regressions)', () => {
  const icqqEndpoint = { id: 'canon-1', endpoint: { id: 'canon-1', adapter: 'icqq' }, name: '8596238', adapter: 'icqq', connected: true, status: 'online', transportState: 'open' };

  it('shows only a loading state until status arrives: no read-only/legacy copy, no running list, no raw adapter key as the title', async () => {
    const s = status(); delete s.runtime;
    const f = fixture(s, [], 'slow-status'); f.setHostEndpoints([icqqEndpoint]);
    await f.h.settle(); await f.h.settle();
    const loading = f.h.text();
    expect(f.h.nodes().some(node => isComponent(node, 'LoadingState'))).toBe(true);
    expect(loading).not.toContain('配置里还没有');
    expect(loading).not.toContain('当前环境只能查看');
    expect(loading).not.toContain('运行中的连接');
    expect(loading).not.toContain('icqq');
    expect(loading).toContain('适配器 Console');
    f.setMode(''); f.releaseStatus(); await f.h.settle();
    expect(f.h.text()).not.toContain('加载中…');
    expect(f.h.text()).toContain('ICQQ');
    expect(f.h.text()).toContain('10001'); f.h.unmount();
  });

  it('reports a failed status read as an error with retry instead of an empty configuration', async () => {
    const f = fixture(); f.failStatus(true); await f.h.settle();
    const text = f.h.text();
    expect(text).toContain('无法读取账号状态'); expect(text).toContain('Host 暂时无法响应');
    expect(text).not.toContain('配置里还没有'); expect(text).not.toContain('加载中…');
    const retry = f.h.nodes().find(node => node.type !== undefined && typeof node.type === 'function' && node.type.name === 'ErrorState')!.props as { onRetry: () => Promise<boolean>; details: string };
    expect(retry.details).toContain('unavailable');
    f.failStatus(false); await retry.onRetry(); await f.h.settle();
    expect(f.h.text()).toContain('10001'); expect(f.h.text()).not.toContain('无法读取账号状态'); f.h.unmount();
  });

  it('keeps showing the last good account list as stale when a poll fails, with a separate error for the connection list', async () => {
    const f = fixture(); await f.h.settle(); expect(f.h.text()).toContain('10001');
    f.failStatus(true); f.failEndpoints(true);
    await vi.advanceTimersByTimeAsync(6000); await f.h.settle();
    const text = f.h.text();
    expect(text).toContain('10001');
    expect(f.h.nodes().filter(node => typeof node.type === 'function' && node.type.name === 'StaleNotice').length).toBeGreaterThanOrEqual(1);
    expect(text).toContain('读取账号状态：Host 暂时无法响应');
    expect(text).toContain('读取连接状态：safe synthetic error');
    f.failStatus(false); f.failEndpoints(false);
    await vi.advanceTimersByTimeAsync(6000); await f.h.settle();
    expect(f.h.nodes().some(node => typeof node.type === 'function' && node.type.name === 'StaleNotice')).toBe(false); f.h.unmount();
  });

  it('shows unknown, not offline, while the connection list is unavailable', async () => {
    const s = status(); s.runtime = { ...s.runtime!, endpoints: s.runtime!.endpoints.map(value => ({ ...value, desiredEnabled: true })) };
    const f = fixture(s, [], 'endpoints-down'); await f.h.settle();
    expect(f.h.text()).toContain('状态未知'); expect(f.h.text()).not.toContain('离线');
    expect(f.h.text()).toContain('读取连接状态'); f.h.unmount();
  });

  it('does not claim nothing is configured when the adapter has running connections but no account list', async () => {
    const s = status(); delete s.runtime; s.configured = []; s.running = [{ id: '8596238' }];
    const f = fixture(s); await f.h.settle();
    expect(f.h.text()).not.toContain('配置里还没有'); expect(f.h.text()).toContain('此适配器没有提供账号清单'); f.h.unmount();
  });

  it('never auto-dismisses an error notice but clears a success notice after 8s', async () => {
    const f = fixture(); await f.h.settle(); f.setMode('conflict');
    await f.h.button('启动').onClick(); await f.h.settle();
    expect(f.h.text()).toContain('账号清单已变化');
    await vi.advanceTimersByTimeAsync(20_000); expect(f.h.text()).toContain('账号清单已变化'); f.h.unmount();
    const g = fixture(); await g.h.settle(); await g.h.button('启动').onClick(); await g.h.settle();
    expect(g.h.text()).toContain('已保存，操作进行中'); await vi.advanceTimersByTimeAsync(8_100); await g.h.settle();
    expect(g.h.text()).not.toContain('已保存，操作进行中'); g.h.unmount();
  });

  it('keeps per-action busy state local: a slow start leaves test-connection and refresh usable', async () => {
    const s = status(); s.runtime = { ...s.runtime!, endpoints: s.runtime!.endpoints.map(value => ({ ...value, started: true })) };
    const f = fixture(s); await f.h.settle(); f.setMode('late');
    const starting = f.h.button('启动').onClick(); await f.h.settle();
    const busyStart = f.h.nodes().find(node => typeof node.type === 'function' && node.type.name === 'Button' && node.props?.busy === true);
    expect(text(busyStart?.props?.children)).toBe('启动');
    expect(f.h.button('测试连接').disabled).toBeFalsy(); expect(f.h.button('刷新').disabled).toBeFalsy();
    expect(f.h.button('编辑').disabled).toBe(true);
    f.finish(); await starting; await f.h.settle(); f.h.unmount();
  });

  it('shows the countdown as a <time> and announces only near expiry', async () => {
    const s = status(); s.runtime = { ...s.runtime!, endpoints: s.runtime!.endpoints.map(endpoint => ({ ...endpoint, desiredEnabled: true })) };
    const identity = { canonicalId: 'canonical-old', instanceId: 'instance-old', epoch: 5, incarnationId: 'incarnation-current' };
    const f = fixture(s, [{ id: 'q', adapter: 'icqq', endpointKey: '10001', type: 'qrcode', payload: { image: 'data:image/png;base64,AAAA' }, createdAt: 1, expiresAt: Date.now() + 60_000, endpointIdentity: identity }]);
    await f.h.settle();
    const nodes = f.h.nodes();
    expect(nodes.find(node => node.type === 'time')?.props?.dateTime).toMatch(/^PT\d+S$/u);
    expect(nodes.find(node => node.type === 'img')?.props?.alt).toContain('二维码');
    expect(f.h.text()).not.toContain('即将过期');
    await vi.advanceTimersByTimeAsync(55_000); await f.h.settle();
    expect(f.h.text()).toContain('验证即将过期'); f.h.unmount();
  });
});
