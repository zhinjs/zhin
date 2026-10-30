import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as remote from '../console-utils/remoteApi.js';
import * as messages from './messages.js';
import type { AdapterConsoleStatus, AdapterConsoleLoginTask } from './types.js';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('./AdapterConsolePage.tsx', import.meta.url), 'utf8');

type Node = { type?: string | { name?: string }; props?: Record<string, unknown> };
function text(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node === 'object') { const element = node as Node; if (typeof element.type === 'function' && element.type.name === 'NoticeBar') return String((element.props?.notice as { message: string }).message); return text(element.props?.children); }
  return String(node);
}
function all(node: unknown): Node[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(all);
  return [node as Node, ...all((node as Node).props?.children)];
}

/** Run production hooks and event handlers; HTTP boundaries remain the actual remoteApi functions. */
function harness() {
  const slots: unknown[] = []; let cursor = 0, dirty = false, render!: () => unknown, value: unknown;
  let effects: (() => void)[] = [];
  const same = (a: unknown[], b: unknown[]) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial: unknown) {
      const at = cursor++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial;
      return [slots[at], (next: unknown) => { const v = typeof next === 'function' ? next(slots[at]) : next; if (!Object.is(v, slots[at])) { slots[at] = v; dirty = true; } }];
    },
    useRef(initial: unknown) { const at = cursor++; return slots[at] ?? (slots[at] = { current: initial }); },
    useMemo(fn: () => unknown, deps: unknown[]) { const at = cursor++; const old = slots[at] as { deps: unknown[]; value: unknown } | undefined; if (!old || !same(old.deps, deps)) slots[at] = { deps, value: fn() }; return (slots[at] as { value: unknown }).value; },
    useCallback(fn: () => unknown, deps: unknown[]) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn: () => (() => void) | void, deps: unknown[]) { const at = cursor++; const old = slots[at] as { deps: unknown[]; cleanup?: () => void } | undefined; if (!old || !same(old.deps, deps)) { const slot = { deps, cleanup: old?.cleanup }; slots[at] = slot; effects.push(() => { old?.cleanup?.(); slot.cleanup = fn() || undefined; }); } },
  };
  const module = { exports: {} as Record<string, (...args: unknown[]) => unknown> };
  const compiled = ts.transpileModule(source + '\nexport { AdapterConsoleSession };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', compiled)((name: string) => name === 'react' ? { ...require('react'), ...hooks } : name === '../console-utils/remoteApi.js' ? remote : name === './messages.js' ? messages : require(name), module, module.exports);
  const flush = () => { for (let i = 0; i < 50; i++) { dirty = false; cursor = 0; value = render(); const pending = effects; effects = []; pending.forEach(fn => fn()); if (!dirty) break; } return value; };
  return {
    exports: module.exports,
    mount(fn: () => unknown) { render = fn; return flush(); },
    async settle() { for (let i = 0; i < 30; i++) { await Promise.resolve(); if (dirty || effects.length) flush(); } return value; },
    nodes: () => all(value),
    button(label: string) { const node = all(value).find(node => typeof node.type === 'function' && node.type.name === 'Button' && text(node) === label); if (!node) throw new Error(`missing button ${label}: ${text(value)}`); return node.props as { onClick: () => Promise<void> | void; disabled?: boolean }; },
    input(at: number) { return all(value).filter(node => node.type === 'input')[at]!.props as { value: string; onChange: (e: { target: { value: string } }) => void }; },
    unmount() { for (const slot of slots) (slot as { cleanup?: () => void })?.cleanup?.(); },
    text: () => text(value),
  };
}
const storage = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key) }; };
function status(): AdapterConsoleStatus {
  return { adapterKey: 'icqq', displayName: 'ICQQ', page: '/', fields: [{ key: 'password', required: true, env: true, secret: true }, { key: 'server', required: false, env: false, secret: false }], canAdd: true, canRemove: true, configStore: true, running: [], actions: [],
    configured: [{ id: '10001', instanceId: 'instance-old', values: { password: '••••••', server: 'old-server' } }],
    runtime: { adapterId: 'capability', generation: 4, revision: 2, needsMigration: false, canManage: true, canMigrate: false, canUpdate: true, canReplace: true, mutableFields: ['password', 'server'], identityFields: ['id'], endpoints: [{ instanceId: 'instance-old', canonicalId: 'canonical-old', endpointId: '10001', revision: 2, desiredEnabled: false, epoch: 5, incarnationId: 'incarnation-current', started: false, admitted: false }] } };
}
function fixture(initial = status(), tasks: AdapterConsoleLoginTask[] = []) {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('location', { pathname: '/icqq', origin: 'https://host-a.test' });
  vi.stubGlobal('navigator', { languages: ['zh-CN'] });
  vi.stubGlobal('window', { location, confirm: vi.fn(() => true), dispatchEvent: vi.fn() });
  localStorage.setItem('zhin_api_base', 'https://host-a.test'); localStorage.setItem('zhin_api_token', 'synthetic-token');
  let view = structuredClone(initial), mode = '', finish: (() => void) | undefined, finishLogin: (() => void) | undefined;
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>; calls.push({ url, body });
    const reply = (data: unknown, code = 200, errorCode?: string) => new Response(JSON.stringify(code === 200 ? { success: true, data } : { success: false, code: errorCode, error: 'safe synthetic error' }), { status: code, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/console/api/pages')) return Response.json({ pages: [{ owner: url.includes('host-b') ? 'plugin-b' : 'plugin-a', localName: 'index', source: 'adapters/icqq/pages/index/index.ts', route: '/icqq' }] });
    if (body.type === 'plugin.plugin-a.status' || body.type === 'plugin.plugin-b.status') return reply(structuredClone(view));
    if (body.type === 'endpoint.list') return reply({ endpoints: [] });
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
  return { h, calls, setMode(value: string) { mode = value; }, finish: () => finish?.(), finishLogin: () => finishLogin?.(), replaceView(value: AdapterConsoleStatus) { view = value; }, writes: () => calls.filter(call => String(call.body.type).includes('.endpoint-')) };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('shared runtime Adapter page production handlers', () => {
  it('uses exact instance, generation and revision for start/stop/remove without touching startup source', async () => {
    const f = fixture(); await f.h.settle();
    expect(f.h.text()).not.toContain('重启后生效');
    await f.h.button('启动').onClick(); await f.h.settle();
    expect(f.writes()[0]!.body).toMatchObject({ type: 'plugin.plugin-a.endpoint-start', data: { instanceId: 'instance-old', expectedGeneration: 4, expectedRevision: 2 } });
    expect(f.h.text()).toContain('已保存，操作进行中');
    await f.h.button('删除').onClick(); await f.h.settle();
    expect(f.writes()[1]!.body).toMatchObject({ type: 'plugin.plugin-a.endpoint-remove', data: { instanceId: 'instance-old', expectedRevision: 3 } });
    expect(f.calls.some(call => /config|env/u.test(String(call.body.type)))).toBe(false); f.h.unmount();
  });

  it('adds a saved-only account using the captured CAS and clears the submitted credential draft', async () => {
    const f = fixture(); await f.h.settle(); await f.h.button('添加').onClick(); await f.h.settle();
    f.h.input(0).onChange({ target: { value: '10002' } }); await f.h.settle();
    f.h.input(1).onChange({ target: { value: 'synthetic-add-only' } }); await f.h.settle();
    f.h.input(2).onChange({ target: { value: 'new-server' } }); await f.h.settle();
    const save = f.h.nodes().filter(node => typeof node.type === 'function' && node.type.name === 'Button' && text(node) === '添加').at(-1)!.props!;
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
    await f.h.button('保存').onClick(); await f.h.settle(); expect(f.writes()).toHaveLength(1); expect(f.h.text()).toContain('请填写 password');
    f.h.input(1).onChange({ target: { value: 'synthetic-replacement-only' } }); await f.h.settle(); await f.h.button('保存').onClick(); await f.h.settle();
    expect(f.writes()[1]!.body).toMatchObject({ type: 'plugin.plugin-a.endpoint-replace', data: { id: '10002', instanceId: 'instance-old', values: { password: 'synthetic-replacement-only', server: 'old-server' }, expectedRevision: 3 } });
    expect(f.h.text()).toContain('已保存，请手动启动'); f.h.unmount();
  });

  it('binds login actions to the exact live canonical/instance/epoch and hides stale or unbound runtime tasks', async () => {
    const base = { id: 'task', adapter: 'icqq', endpointKey: '10001', type: 'qrcode', payload: {}, createdAt: 1 };
    const identity = { canonicalId: 'canonical-old', instanceId: 'instance-old', epoch: 5, incarnationId: 'incarnation-current' };
    const enabled = status(); enabled.runtime = { ...enabled.runtime!, endpoints: enabled.runtime!.endpoints.map(endpoint => ({ ...endpoint, desiredEnabled: true })) };
    const f = fixture(enabled, [{ ...base, id: 'live', endpointIdentity: identity }, { ...base, id: 'old-epoch', endpointIdentity: { ...identity, epoch: 4 } }, { ...base, id: 'recreated', endpointIdentity: { ...identity, instanceId: 'different' } }, { ...base, id: 'old-incarnation', endpointIdentity: { ...identity, incarnationId: 'incarnation-previous' } }, { ...base, id: 'unbound' }]);
    await f.h.settle(); expect(f.h.nodes().filter(node => typeof node.type === 'function' && node.type.name === 'Button' && text(node) === '已扫码，继续')).toHaveLength(1);
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

  it('keeps retiring accounts read-only and disables migration actions for nonoperators', async () => {
    const s = status(); s.runtime = { ...s.runtime!, needsMigration: true, canMigrate: false, endpoints: s.runtime!.endpoints.map(value => ({ ...value, retiring: true })) };
    const f = fixture(s); await f.h.settle(); expect(f.h.text()).toContain('正在关闭'); expect(f.h.text()).toContain('首次迁移需要管理员确认');
    expect(f.h.nodes().some(node => typeof node.type === 'function' && node.type.name === 'Button' && ['编辑', '启动', '删除'].includes(text(node)))).toBe(false); f.h.unmount();
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

  it('retains the legacy embedded source writer when no runtime directory is offered', async () => {
    const s = status(); delete s.runtime; const f = fixture(s); await f.h.settle(); expect(f.h.text()).toContain('重启后生效'); await f.h.button('删除').onClick(); await f.h.settle();
    expect(f.writes()[0]!.body.data).toEqual({ id: '10001' }); f.h.unmount();
  });
});
