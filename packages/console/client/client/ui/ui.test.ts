import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allNodes, createHookEnv, isComponent } from '../../tests/hook-harness.js';

const file = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

function stubHost(handler: (type: string, data: unknown) => Promise<{ code?: number; data?: unknown; error?: string }>) {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal('location', { pathname: '/p', origin: 'https://host.test' });
  vi.stubGlobal('window', { location, dispatchEvent: vi.fn() });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { type: string; data?: unknown };
    const { code = 200, data, error } = await handler(body.type, body.data);
    return new Response(JSON.stringify(code === 200 ? { success: true, data } : { success: false, code: 'unavailable', error }), { status: code });
  }));
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

type Resource = { state: string; data?: unknown; error?: Error; lastSuccessAt?: number; refreshing: boolean; refresh(): Promise<boolean>; mutate(next: unknown): void };
function mountRpc(pluginId: () => string | undefined, params: () => Record<string, unknown> | undefined, options: Record<string, unknown> = {}) {
  const env = createHookEnv();
  const mod = env.load(file('./rpc.ts'));
  let latest!: Resource;
  env.mount(() => { latest = mod.usePluginRpc(pluginId(), 'status', params(), options) as unknown as Resource; return null; });
  return { env, get value() { return latest; } };
}
const gate = () => { let open!: () => void; const wait = new Promise<void>(resolve => { open = resolve; }); return { wait, open }; };

describe('usePluginRpc', () => {
  it('goes loading -> ready and exposes data with lastSuccessAt', async () => {
    vi.useFakeTimers();
    stubHost(async () => ({ data: { items: [1] } }));
    const view = mountRpc(() => 'root/x', () => undefined);
    expect(view.value.state).toBe('loading');
    await view.env.settle();
    expect(view.value.state).toBe('ready'); expect(view.value.data).toEqual({ items: [1] }); expect(view.value.lastSuccessAt).toBeTypeOf('number');
    view.env.unmount();
  });

  it('is empty on a successful empty answer and error when there is nothing to keep', async () => {
    vi.useFakeTimers();
    let fail = false;
    stubHost(async () => fail ? { code: 503, error: 'down' } : { data: [] });
    const empty = mountRpc(() => 'root/x', () => undefined);
    await empty.env.settle(); expect(empty.value.state).toBe('empty'); empty.env.unmount();
    fail = true;
    const broken = mountRpc(() => 'root/x', () => undefined);
    await broken.env.settle(); expect(broken.value.state).toBe('error'); expect(broken.value.error?.message).toBe('down'); expect(broken.value.data).toBeUndefined();
    broken.env.unmount();
  });

  it('keeps the last good data as stale on error, then recovers', async () => {
    vi.useFakeTimers();
    let fail = false;
    stubHost(async () => fail ? { code: 503, error: 'down' } : { data: { n: 1 } });
    const view = mountRpc(() => 'root/x', () => undefined, { pollMs: 1000 });
    await view.env.settle(); const first = view.value.lastSuccessAt;
    fail = true; await vi.advanceTimersByTimeAsync(1000); await view.env.settle();
    expect(view.value.state).toBe('stale'); expect(view.value.data).toEqual({ n: 1 }); expect(view.value.lastSuccessAt).toBe(first); expect(view.value.error?.message).toBe('down');
    fail = false; await view.value.refresh(); await view.env.settle();
    expect(view.value.state).toBe('ready'); expect(view.value.error).toBeUndefined();
    view.env.unmount();
  });

  it('ignores a slow older response that finishes after a newer one (race protection)', async () => {
    vi.useFakeTimers();
    const slow = gate(); let call = 0;
    stubHost(async () => { const n = ++call; if (n === 1) { await slow.wait; return { data: 'old' }; } return { data: 'new' }; });
    const view = mountRpc(() => 'root/x', () => undefined);
    await view.env.settle();
    await view.value.refresh(); await view.env.settle();
    expect(view.value.data).toBe('new');
    slow.open(); await view.env.settle();
    expect(view.value.data).toBe('new'); view.env.unmount();
  });

  it('drops the previous plugin/params data instead of showing it as stale for the new key', async () => {
    vi.useFakeTimers();
    let id = 'a';
    stubHost(async type => ({ data: type }));
    const view = mountRpc(() => id, () => undefined);
    await view.env.settle(); expect(view.value.data).toBe('plugin.a.status');
    id = 'b'; view.env.rerender();
    expect(view.value.state).toBe('loading'); expect(view.value.data).toBeUndefined();
    await view.env.settle(); expect(view.value.data).toBe('plugin.b.status'); view.env.unmount();
  });

  it('waits (loading) while the plugin id is unresolved and does not call the Host', async () => {
    vi.useFakeTimers();
    stubHost(async () => ({ data: 1 }));
    const view = mountRpc(() => undefined, () => undefined);
    await view.env.settle(); expect(view.value.state).toBe('loading'); expect(fetch).not.toHaveBeenCalled(); view.env.unmount();
  });

  it('polls after each request completes and pauses while the page is hidden', async () => {
    vi.useFakeTimers();
    stubHost(async () => ({ data: 1 }));
    let visibility = 'visible';
    vi.stubGlobal('document', { get visibilityState() { return visibility; }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const view = mountRpc(() => 'root/x', () => undefined, { pollMs: 1000 });
    await view.env.settle(); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); await view.env.settle(); expect(fetch).toHaveBeenCalledTimes(2);
    visibility = 'hidden'; await vi.advanceTimersByTimeAsync(3000); await view.env.settle(); expect(fetch).toHaveBeenCalledTimes(2);
    view.env.unmount();
  });

  it('mutate replaces data and invalidates an in-flight read', async () => {
    vi.useFakeTimers();
    const slow = gate(); let call = 0;
    stubHost(async () => { if (++call === 2) { await slow.wait; return { data: { v: 'late' } }; } return { data: { v: 'first' } }; });
    const view = mountRpc(() => 'root/x', () => undefined);
    await view.env.settle();
    const inflight = view.value.refresh(); await view.env.settle();
    view.value.mutate((previous: unknown) => ({ ...(previous as object), v: 'local' })); await view.env.settle();
    slow.open(); await inflight; await view.env.settle();
    expect(view.value.data).toEqual({ v: 'local' }); view.env.unmount();
  });
});

describe('ConfirmButton', () => {
  function mount(props: Record<string, unknown> = {}) {
    vi.stubGlobal('navigator', { languages: ['zh-CN'] });
    const env = createHookEnv();
    const mod = env.load(file('./components.tsx'));
    const onConfirm = vi.fn();
    env.mount(() => mod.ConfirmButton({ children: '删除', confirmLabel: '删除账号', message: '删除账号「1」？', onConfirm, ...props }));
    const tree = () => env.tree() as { type: unknown; props: Record<string, unknown> };
    return { env, onConfirm, tree, buttons: () => allNodes(env.tree()).filter(node => isComponent(node, 'Button')) };
  }

  it('opens an inline, action-specific confirmation instead of window.confirm', () => {
    const view = mount();
    expect(view.buttons()).toHaveLength(1);
    (view.buttons()[0]!.props!.onClick as () => void)();
    view.env.rerender();
    const labels = view.buttons().map(node => node.props!.children);
    expect(labels).toEqual(['删除账号', '取消']);
    expect(allNodes(view.env.tree()).some(node => node.props?.role === 'group')).toBe(true);
    expect(view.onConfirm).not.toHaveBeenCalled();
  });

  it('confirms with the danger variant by default and runs the action once', async () => {
    const view = mount();
    (view.buttons()[0]!.props!.onClick as () => void)(); view.env.rerender();
    const confirm = view.buttons()[0]!.props!;
    expect(confirm.variant).toBe('danger');
    await (confirm.onClick as () => unknown)(); view.env.rerender();
    expect(view.onConfirm).toHaveBeenCalledTimes(1);
    expect(view.buttons()).toHaveLength(1);
  });

  it('returns focus to the trigger on cancel and on Escape', () => {
    const view = mount();
    const focus = vi.fn();
    (view.tree().props.buttonRef as { current: unknown }).current = { focus };
    (view.buttons()[0]!.props!.onClick as () => void)(); view.env.rerender();
    (view.buttons()[1]!.props!.onClick as () => void)(); view.env.rerender();
    expect(focus).toHaveBeenCalledTimes(1);
    (view.buttons()[0]!.props!.onClick as () => void)(); view.env.rerender();
    const group = allNodes(view.env.tree()).find(node => node.props?.role === 'group')!;
    (group.props!.onKeyDown as (event: unknown) => void)({ key: 'Escape', stopPropagation: () => undefined }); view.env.rerender();
    expect(focus).toHaveBeenCalledTimes(2); expect(view.onConfirm).not.toHaveBeenCalled();
  });

  it('does not open when beforeOpen rejects', () => {
    const view = mount({ beforeOpen: () => false });
    (view.buttons()[0]!.props!.onClick as () => void)(); view.env.rerender();
    expect(view.buttons().map(node => node.props!.children)).toEqual(['删除']);
  });
});

describe('locale and plugin id helpers', () => {
  it('translates by Chinese source text with positional values and falls back to the source', () => {
    const env = createHookEnv();
    const locale = env.load(file('./locale.ts'));
    expect(locale.translate('en', { 你好: 'Hello {0}' }, '你好', 'Ann')).toBe('Hello Ann');
    expect(locale.translate('en', undefined, '重试')).toBe('Retry');
    expect(locale.translate('en', undefined, '没有翻译')).toBe('没有翻译');
    expect(locale.translate('zh-CN', { 你好: 'Hello {0}' }, '你好 {0}', 'Ann')).toBe('你好 Ann');
    vi.stubGlobal('navigator', { languages: ['en-US'] }); expect(locale.detectLocale()).toBe('en');
    vi.stubGlobal('navigator', { languages: ['zh-TW', 'en'] }); expect(locale.detectLocale()).toBe('zh-CN');
    expect(locale.formatClock(new Date(2026, 0, 2, 3, 4).getTime())).toBe('03:04');
  });

  it('resolvePluginId prefers the current route, never guesses among several, and supports a fallback', async () => {
    stubHost(async () => ({ data: {} }));
    const pages = [
      { owner: 'root/a', localName: 'index', source: 'node_modules/@zhin.js/adapter-demo/pages/index/index.js', route: '/other' },
      { owner: 'root/b', localName: 'index', source: 'adapters/demo/pages/index/index.ts', route: '/p' },
      { owner: 'root/c', localName: 'detail', source: 'adapters/demo/pages/detail/index.ts', route: '/p/detail' },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ pages })));
    const { resolvePluginId } = createHookEnv().load(file('./plugin-id.ts'));
    expect(await resolvePluginId({ adapter: 'demo' })).toBe('root/b');
    vi.stubGlobal('location', { pathname: '/nowhere' });
    expect(await resolvePluginId({ adapter: 'demo' })).toBeUndefined();
    expect(await resolvePluginId({ adapter: 'demo', fallback: 'root/demo' })).toBe('root/demo');
    expect(await resolvePluginId({ source: /adapter-demo[\\/]pages/ })).toBe('root/a');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    await expect(resolvePluginId({ adapter: 'demo' })).rejects.toThrow('HTTP 500');
    expect(await resolvePluginId({ adapter: 'demo', fallback: 'root/demo' })).toBe('root/demo');
  });
});
