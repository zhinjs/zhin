import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allNodes, createHookEnv, isComponent, renderChild, textOf, type ElementNode } from '../../tests/hook-harness.js';

const file = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const VIEW = file('./DeclarativePageView.tsx');
const TABLE = file('./DataTable.tsx');
const VALUES = file('./values.tsx');
const KIT = file('../renderer/kit.tsx');
const DEPRECATION = file('../renderer/deprecation.ts');
const UI_ENTRY = resolve(dirname(createRequire(import.meta.url).resolve('@zhin.js/console-ui/package.json')), 'client/index.ts');

function stubHost(handler: (type: string, data: unknown) => { code?: number; data?: unknown; error?: string }) {
  const calls: { type: string; data: unknown }[] = [];
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal('location', { pathname: '/p', origin: 'https://host.test' });
  vi.stubGlobal('window', { location, dispatchEvent: vi.fn() });
  vi.stubGlobal('navigator', { languages: ['zh-CN'], clipboard: { writeText: vi.fn() } });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { type: string; data?: unknown };
    calls.push({ type: body.type, data: body.data });
    const { code = 200, data, error } = handler(body.type, body.data);
    return new Response(JSON.stringify(code === 200 ? { success: true, data } : { success: false, code: 'unavailable', error }), { status: code });
  }));
  return calls;
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function mountPage(spec: Record<string, unknown>, status: unknown = {}) {
  const calls = stubHost((type) => (type.endsWith('.status') ? { data: status } : { data: { message: '完成' } }));
  const env = createHookEnv();
  const { DeclarativePageView } = env.load(VIEW);
  env.mount(() => DeclarativePageView({ spec, pageProps: { pluginId: 'root/demo' } }));
  await env.settle();
  const nodes = () => allNodes(env.tree());
  const find = (name: string, where: (node: ElementNode) => boolean = () => true) => nodes().find(node => isComponent(node, name) && where(node));
  return { env, calls, nodes, find, page: () => find('RendererPage')!.props as Record<string, unknown> };
}

describe('DeclarativePageView content mode (ADR 0063 P2)', () => {
  it('renders only content blocks and hands title, description, actions and refresh to the shell', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 15, 9, 12, 47));
    const view = await mountPage({
      pluginId: 'root/demo',
      title: { zh: 'RSS 订阅', en: 'RSS' },
      description: '管理订阅源',
      badges: [{ key: 'st', label: '降级', tone: 'warning' }],
      actions: [{ name: 'poll', label: '立即抓取' }],
      stats: [{ key: 'n', label: '订阅数', value: 'count' }],
    }, { count: 3 });
    const page = view.page();
    expect(page.title).toBe('RSS 订阅');
    expect(page.description).toBe('管理订阅源');
    expect(page.refresh).toMatchObject({ intervalMs: 15_000 });
    expect(typeof (page.refresh as { onRefresh: unknown }).onRefresh).toBe('function');
    expect(textOf(page.actions)).toContain('降级');
    expect(textOf(page.actions)).toContain('立即抓取');
    // No header, letter tile or refresh select in the content itself.
    expect(view.find('PageHeader')).toBeUndefined();
    expect(view.nodes().some(node => node.type === 'select' || node.type === 'h1')).toBe(false);
    expect(view.find('StatGrid')).toBeDefined();
    view.env.unmount();
  });

  it('draws the header inside the content when no shell listens, and reports chrome when one does', () => {
    const props = { title: 'RSS 订阅', description: '管理订阅源', refresh: { onRefresh: () => undefined, updatedAt: null }, children: 'body' };
    // Without a shell: RendererPage → ChromeRendererPage, which falls back to an inline PageHeader + RefreshControl.
    const outer = renderChild(KIT, 'RendererPage', props).tree() as ElementNode;
    expect(isComponent(outer, 'ChromeRendererPage')).toBe(true);
    const inline = renderChild(KIT, 'ChromeRendererPage', props);
    const inlineNodes = allNodes(inline.tree());
    const header = inlineNodes.find(node => isComponent(node, 'PageHeader'))!;
    expect(header.props).toMatchObject({ title: 'RSS 订阅', description: '管理订阅源' });
    expect(allNodes(header.props!.actions).some(node => isComponent(node, 'RefreshControl'))).toBe(true);
    expect((inline.tree() as ElementNode).props?.['data-page-chrome']).toBe('inline');

    // Inside a PageChromeProvider: no header in the content, chrome goes to the shell's store.
    const uiEnv = createHookEnv();
    const ui = uiEnv.load(UI_ENTRY);
    const store = (ui.createPageChromeStore as () => { get(): Record<string, unknown> | undefined })();
    const shell = renderChild(KIT, 'ChromeRendererPage', props, (target) => {
      const provider = target.load(UI_ENTRY).PageChromeProvider as (p: unknown) => { type: { _currentValue?: unknown } };
      // PageChromeProvider's element type is the context itself (React 19); the harness's useContext
      // reads `_currentValue`, so this is what a mounted provider would hand down.
      const element = provider({ store, children: null });
      element.type._currentValue = store;
    });
    expect(allNodes(shell.tree()).some(node => isComponent(node, 'PageHeader'))).toBe(false);
    expect((shell.tree() as ElementNode).props?.['data-page-chrome']).toBe('shell');
    expect(store.get()).toMatchObject({ title: 'RSS 订阅', description: '管理订阅源' });
    // The registered refresh is a stable wrapper over the page's latest callbacks.
    expect(store.get()?.refresh).toMatchObject({ updatedAt: null });
    expect(typeof (store.get()?.refresh as { onRefresh: unknown }).onRefresh).toBe('function');
  });

  it('re-renders with new closures do not re-register the chrome (a shell that re-renders the page must not loop)', () => {
    const uiEnv = createHookEnv();
    const store = (uiEnv.load(UI_ENTRY).createPageChromeStore as () => { set: (chrome: unknown) => () => void; get(): Record<string, any> | undefined })();
    const set = vi.spyOn(store, 'set');
    const onRefresh = vi.fn();
    const props = (deps: unknown[]) => ({
      title: 'RSS', actions: { type: 'button', props: { onClick: () => undefined, children: '抓取' } },
      refresh: { onRefresh: () => onRefresh(), updatedAt: 1, intervalMs: 5000 }, chromeDeps: deps, children: null,
    });
    const env = renderChild(KIT, 'ChromeRendererPage', props([1]), (target) => {
      const element = (target.load(UI_ENTRY).PageChromeProvider as (p: unknown) => { type: { _currentValue?: unknown } })({ store, children: null });
      element.type._currentValue = store;
    });
    const page = env.load(KIT).ChromeRendererPage as (p: unknown) => unknown;
    env.mount(() => page(props([1])));
    env.mount(() => page(props([1])));
    expect(set).toHaveBeenCalledTimes(1);
    // The registered refresh calls the latest closure.
    (store.get()!.refresh.onRefresh as () => void)();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    env.mount(() => page(props([2])));
    expect(set).toHaveBeenCalledTimes(2);
  });

  it('an embedded page never reports chrome (it would replace the host page header)', () => {
    const outer = renderChild(KIT, 'RendererPage', { title: 'x', embedded: true, children: null }).tree() as ElementNode;
    expect(isComponent(outer, 'EmbeddedRendererPage')).toBe(true);
    const embedded = renderChild(KIT, 'EmbeddedRendererPage', { title: 'x', embedded: true, children: null });
    expect((embedded.tree() as ElementNode).props?.['data-page-chrome']).toBe('embedded');
    expect(allNodes(embedded.tree()).some(node => isComponent(node, 'PageHeader'))).toBe(false);
  });

  it('ignores the blueprint mark and warns once', async () => {
    const env = createHookEnv();
    env.load(DEPRECATION).resetDeprecationWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = await mountPage({ kind: 'zhin.console.page-blueprint', version: 1, title: '订阅', mark: 'R', sections: [] });
    const second = await mountPage({ title: '订阅', mark: 'R' });
    const markWarnings = warn.mock.calls.filter(([message]) => String(message).includes('`mark`'));
    expect(markWarnings).toHaveLength(1);
    expect(JSON.stringify(first.env.tree())).not.toContain('"mark"');
    expect(second.find('PageHeader')).toBeUndefined();
    first.env.unmount(); second.env.unmount();
  });
});

describe('dangerous actions (ADR 0063 决策 5)', () => {
  it('renders danger as destructive-outline and adds the default confirmation 「确认<动作名>？」', async () => {
    const view = await mountPage({ title: 'RSS', actions: [{ name: 'remove', label: '移除订阅', variant: 'danger' }] });
    const action = allNodes(view.page().actions).find(node => isComponent(node, 'ActionButton'))!;
    expect(action.props).toMatchObject({ label: '移除订阅', variant: 'danger' });
    const button = renderChild(KIT, 'ActionButton', action.props);
    const parts = allNodes(button.tree());
    const trigger = parts.find(node => isComponent(node, 'Button'))!;
    const dialog = parts.find(node => isComponent(node, 'ConfirmDialog'))!;
    expect(trigger.props?.variant).toBe('destructive-outline');
    expect(dialog.props).toMatchObject({ title: '确认移除订阅？', variant: 'destructive', confirmLabel: '移除订阅', open: false });
    // Clicking opens the dialog instead of running; the dialog's confirm runs the RPC.
    (trigger.props!.onClick as () => void)();
    button.rerender();
    expect(allNodes(button.tree()).find(node => isComponent(node, 'ConfirmDialog'))!.props?.open).toBe(true);
    expect(view.calls.some(call => call.type.endsWith('.remove'))).toBe(false);
    await (dialog.props!.onConfirm as () => Promise<void>)();
    await view.env.settle();
    expect(view.calls.some(call => call.type === 'plugin.root/demo.remove')).toBe(true);
    view.env.unmount();
  });

  it('keeps an explicit confirm and confirmText, and never uses a solid red trigger', () => {
    const env = createHookEnv();
    const kit = env.load(KIT);
    expect(kit.buttonVariantFor('danger')).toBe('destructive-outline');
    expect(kit.buttonVariantFor('destructive')).toBe('destructive-outline');
    expect(kit.buttonVariantFor('primary')).toBe('default');
    expect(kit.buttonVariantFor('secondary')).toBe('outline');
    expect(kit.resolveConfirmMessage({ variant: 'danger', label: '删除', confirm: '真的删除？' }, 'zh-CN')).toBe('真的删除？');
    expect(kit.resolveConfirmMessage({ variant: 'danger', label: 'Delete' }, 'en')).toBe('Confirm Delete?');
    expect(kit.resolveConfirmMessage({ variant: 'primary', label: '保存' }, 'zh-CN')).toBeUndefined();
    const button = renderChild(KIT, 'ActionButton', { label: '清空记录', variant: 'danger', confirmText: 'records', locale: 'zh-CN', onRun: () => undefined });
    const parts = allNodes(button.tree());
    expect(parts.find(node => isComponent(node, 'Button'))!.props?.variant).not.toBe('destructive');
    expect(parts.find(node => isComponent(node, 'ConfirmDialog'))!.props).toMatchObject({ confirmText: 'records', variant: 'destructive' });
  });

  it('row and batch danger actions of a table go through the same button', async () => {
    const view = await mountPage({
      title: '日历',
      sections: [{
        id: 'events', items: 'rows', columns: [{ key: 'name', label: '名称' }],
        rowActions: [{ name: 'delete', label: '删除', variant: 'danger' }],
        batchActions: [{ name: 'delete-many', label: '批量删除', variant: 'danger' }],
      }],
    }, { rows: [{ id: 'a', name: '会议' }] });
    const table = view.find('DataTable')!;
    const tableEnv = renderChild(TABLE, 'DataTable', { ...table.props, selectedKeys: ['a'] });
    const buttons = allNodes(tableEnv.tree()).filter(node => isComponent(node, 'ActionButton'));
    expect(buttons.map(node => node.props?.label)).toEqual(expect.arrayContaining(['删除', '批量删除']));
    for (const node of buttons) expect(node.props?.variant).toBe('danger');
    view.env.unmount();
  });
});

describe('D15 presentation in the renderer', () => {
  it('stat cards use the flexible grid; tables are DataTables that turn into cards in a narrow container', async () => {
    const view = await mountPage({
      title: '进程',
      stats: [{ key: 'a', label: 'A', value: 'a', tone: 'success' }, { key: 'b', label: 'B', value: 'b', tone: 'danger' }],
      sections: [{ id: 't', items: 'rows', columns: [{ key: 'name', label: '名称' }, { key: 'status', label: '状态' }] }],
    }, { a: 1, b: 2, rows: [{ id: '1', name: 'Alpha', status: 'running' }, { id: '2', name: 'Beta', status: 'failed' }] });
    const grid = view.find('StatGrid')!;
    const cards = allNodes(grid.props!.children).filter(node => isComponent(node, 'StatCard'));
    // Only states that need attention change the card (D15): success stays neutral.
    expect(cards.map(node => node.props?.tone)).toEqual([undefined, 'danger']);
    const table = renderChild(TABLE, 'DataTable', view.find('DataTable')!.props);
    // One console-ui Table, which turns its rows into cards by itself in a narrow container.
    const tables = allNodes(table.tree()).filter(node => isComponent(node, 'Table'));
    expect(tables).toHaveLength(1);
    expect(allNodes(table.tree()).some(node => isComponent(node, 'RecordCard') || isComponent(node, 'ResponsiveTable'))).toBe(false);
    // Normal states are muted badges, abnormal ones colored.
    const badges = allNodes(tables[0]).filter(node => isComponent(node, 'ToneBadge')).map(node => node.props?.tone);
    expect(badges).toEqual(expect.arrayContaining(['success', 'danger']));
    const kit = createHookEnv().load(KIT);
    expect(kit.badgeVariantFor('success')).toBe('secondary');
    expect(kit.badgeVariantFor('danger')).toBe('destructive');
    view.env.unmount();
  });

  it('keeps raw JSON and IDs behind a collapsed disclosure', () => {
    const env = createHookEnv();
    const values = env.load(VALUES);
    const copy = { copiedKey: '', onCopy: () => undefined };
    const t = (zh: string) => zh;
    const json = values.renderSmartValue({ a: 1 }, 'meta', 'k', copy, t) as ElementNode;
    expect(isComponent(json, 'JsonValue')).toBe(true);
    const rendered = (json.type as unknown as (p: unknown) => ElementNode)(json.props);
    expect(isComponent(rendered, 'Disclosure')).toBe(true);
    expect(rendered.props?.defaultOpen).toBeUndefined();
    expect(values.splitTechnicalFields({ id: 'x', ownerKey: 'k', name: 'A', meta: { a: 1 } })).toEqual({
      shown: [['name', 'A']],
      technical: [['id', 'x'], ['ownerKey', 'k'], ['meta', { a: 1 }]],
    });
  });

  it('automatic card lists show the readable fields and put IDs under 技术详情', async () => {
    const view = await mountPage({ title: '群管', sections: [{ id: 'g', items: 'rows', layout: 'cards' }] }, { rows: [{ id: 'g1', name: '测试群', conversationKey: '["conversation-v1"]' }] });
    const card = view.find('RecordCard')!;
    expect((card.props!.fields as { key: string }[]).map(field => field.key)).toEqual(['name']);
    const disclosure = allNodes(card.props!.children).find(node => isComponent(node, 'Disclosure'))!;
    expect(disclosure.props?.summary).toBe('技术详情');
    view.env.unmount();
  });
});

describe('DataTable on console-ui', () => {
  it('searches, sorts and pages', () => {
    stubHost(() => ({ data: {} }));
    const rows = Array.from({ length: 20 }, (_, index) => ({ id: String(index), name: `N${String(index).padStart(2, '0')}` }));
    const table = renderChild(TABLE, 'DataTable', { columns: [{ key: 'name', label: '名称' }], rows });
    const nodes = () => allNodes(table.tree());
    expect(textOf(table.tree())).toContain('共 20 条');
    expect(textOf(table.tree())).toContain('第 1 / 2 页（共 20 条）');
    const sort = nodes().find(node => isComponent(node, 'Button') && textOf(node).includes('名称'))!;
    (sort.props!.onClick as () => void)();
    table.rerender();
    (nodes().find(node => isComponent(node, 'Button') && textOf(node).includes('名称'))!.props!.onClick as () => void)();
    table.rerender();
    const first = nodes().find(node => isComponent(node, 'TableCell'));
    expect(textOf(first)).toBe('N19');
    const search = nodes().find(node => isComponent(node, 'Input') && node.props?.type === 'search')!;
    (search.props!.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'N07' } });
    table.rerender();
    expect(textOf(table.tree())).toContain('共 1 / 20 条');
    const env = createHookEnv();
    expect(env.load(TABLE).tableView(rows, [{ key: 'name' }], { query: 'n1', page: 1, pageSize: 5 })).toMatchObject({ total: 10, totalPages: 2 });
  });
});

describe('actions and forms', () => {
  it('submits a form action on Enter and calls the kebab-case RPC', async () => {
    const view = await mountPage({
      kind: 'zhin.console.page-blueprint', version: 1, pluginId: 'root/demo', title: 'RSS',
      sections: [{ type: 'actions', id: 'a', actions: [{ name: 'pollNow', label: '立即轮询', fields: [{ name: 'feedUrl', label: '订阅地址', type: 'text', required: true }] }] }],
    });
    const input = () => view.find('Input', node => node.props?.type === 'text')!;
    (input().props!.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'https://zhin.dev/feed.xml' } });
    view.env.rerender();
    const preventDefault = vi.fn();
    (input().props!.onKeyDown as (event: { key: string; preventDefault(): void }) => void)({ key: 'Enter', preventDefault });
    await view.env.settle();
    expect(preventDefault).toHaveBeenCalled();
    expect(view.calls.find(call => call.type === 'plugin.root/demo.poll-now')?.data).toEqual({ feedUrl: 'https://zhin.dev/feed.xml' });
    view.env.unmount();
  });

  it('previews an image / short link answer under the form with copy buttons', async () => {
    const calls = stubHost((type) => (type.endsWith('.status') ? { data: {} } : { data: { message: '已生成', dataUrl: 'data:image/png;base64,AAAA', shortUrl: 'https://zhin.dev/s/abc' } }));
    const env = createHookEnv();
    const { DeclarativePageView } = env.load(VIEW);
    env.mount(() => DeclarativePageView({ spec: { title: '短链', actions: [{ name: 'generateQr', label: '生成', fields: [{ key: 'url', label: '链接' }] }] }, pageProps: { pluginId: 'root/demo' } }));
    await env.settle();
    const run = allNodes(env.tree()).find(node => isComponent(node, 'ActionButton') && node.props?.label === '生成')!;
    await (run.props!.onRun as () => Promise<void>)();
    await env.settle();
    expect(calls.some(call => call.type === 'plugin.root/demo.generate-qr')).toBe(true);
    const preview = allNodes(env.tree()).find(node => node.props?.['data-action-preview'] === 'generateQr')!;
    const parts = allNodes(preview);
    expect(parts.find(node => isComponent(node, 'MediaPreview'))?.props?.src).toBe('data:image/png;base64,AAAA');
    expect(parts.filter(node => isComponent(node, 'CopyValueButton')).map(node => node.props?.text)).toEqual(['data:image/png;base64,AAAA', 'https://zhin.dev/s/abc']);
    env.unmount();
  });

  it('select fields use the console-ui select, never a native <select>', async () => {
    const view = await mountPage({ title: 'x', actions: [{ name: 'set', label: '设置', fields: [{ key: 'mode', label: '模式', type: 'select', options: [{ value: 'a', label: 'A' }] }] }] });
    const select = view.find('ChoiceSelect')!;
    expect(select.props?.options).toEqual([{ value: 'a', label: 'A', description: undefined, icon: undefined, badge: undefined, disabled: false }]);
    const rendered = renderChild(KIT, 'ChoiceSelect', select.props);
    const field = allNodes(rendered.tree()).find(node => isComponent(node, 'SelectField'))!;
    expect((field.props!.options as { value: string }[]).map(option => option.value)).toEqual(['', 'a']);
    view.env.unmount();
  });

  it('no renderer source contains a native <select> or injects zk- styles', () => {
    const root = file('..');
    const sources = ['declarative', 'renderer', 'adapter-console', 'review-console'].flatMap(dir =>
      readdirSync(join(root, dir)).filter(name => /\.tsx?$/u.test(name) && !name.endsWith('.test.ts')).map(name => join(root, dir, name)));
    sources.push(join(root, 'ui/conversation-picker.tsx'));
    for (const source of sources) {
      const text = readFileSync(source, 'utf8');
      expect(text, source).not.toMatch(/<select[\s>]|createElement\(\s*['"]select['"]/u);
      expect(text, source).not.toMatch(/<style>|pluginUiStyles|from '\.\.\/ui\/components\.js'|from '\.\/components\.js'/u);
      expect(text, source).not.toMatch(/className=["'{`][^"'`}]*\bzk-(?!account-editor-host)/u);
    }
  });
});
