import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allNodes, createHookEnv, textOf } from './hook-harness.js';

const file = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

function stubHost(handler: (type: string, data: unknown) => Promise<{ code?: number; data?: unknown; error?: string }>) {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal('location', { pathname: '/p', origin: 'https://host.test' });
  vi.stubGlobal('window', { location, dispatchEvent: vi.fn() });
  vi.stubGlobal('navigator', { languages: ['zh-CN'], clipboard: { writeText: vi.fn() } });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { type: string; data?: unknown };
    const { code = 200, data, error } = await handler(body.type, body.data);
    return new Response(
      JSON.stringify(code === 200 ? { success: true, data } : { success: false, code: 'unavailable', error }),
      { status: code },
    );
  }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('DeclarativePageView visual & interactive upgrade', () => {
  it('renders interactive header bar (auto-refresh selector, updated timestamp, quick action jump), toned stat cards, 2-col entries grid, and sortable/filterable table', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 8, 9, 12, 47));

    const calls: { type: string; data: unknown }[] = [];
    stubHost(async (type, data) => {
      calls.push({ type, data });
      if (type === 'plugin.root/demo.generate-qr') {
        return {
          data: {
            message: '二维码已生成',
            dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
            shortUrl: 'https://zhin.dev/s/abc123',
          },
        };
      }
      return {
        data: {
          okCount: 12,
          warnCount: 2,
          failCount: 0,
          modeStatus: '运行中',
          featureDisabled: '未启用',
          items: [
            { id: '1', name: 'Alpha', status: 'active', enabled: true, note: '' },
            { id: '2', name: 'Beta', status: 'inactive', enabled: false, note: null },
            { id: '3', name: 'Gamma', status: 'enabled', enabled: true, note: 'ready' },
            { id: '4', name: 'Delta', status: 'disabled', enabled: false, note: ' paused ' },
            { id: '5', name: 'Epsilon', status: 'active', enabled: true, note: 'live' },
          ],
        },
      };
    });

    const env = createHookEnv();
    const { DeclarativePageView } = env.load(file('../client/ui/declarative-page.tsx'));

    const spec = {
      pluginId: 'root/demo',
      title: '演示插件控制台',
      stats: [
        { key: 'ok', label: '成功数', value: 'okCount', tone: 'success' as const },
        { key: 'warn', label: '告警数', value: 'warnCount', tone: 'warning' as const },
        { key: 'fail', label: '失败数', value: 'failCount', tone: 'danger' as const },
        { key: 'def', label: '默认项', value: 'okCount', tone: 'default' as const },
      ],
      actions: [
        {
          name: 'generateQr',
          label: '生成短链二维码',
          description: '输入目标 URL 生成二维码与短链',
          fields: [
            { key: 'targetUrl', label: '目标链接', type: 'text' as const, required: true },
            { key: 'ttl', label: '有效期(秒)', type: 'number' as const, defaultValue: '3600' },
          ],
        },
      ],
      sections: [
        {
          id: 'config-entries',
          title: '运行配置',
          entries: [
            { label: '当前状态', dataKey: 'modeStatus' },
            { label: '备用开关', dataKey: 'featureDisabled' },
          ],
        },
        {
          id: 'item-table',
          title: '节点列表',
          items: 'items',
          columns: [
            { key: 'name', label: '节点名' },
            { key: 'status', label: '状态' },
            { key: 'enabled', label: '启用' },
            { key: 'note', label: '备注' },
          ],
        },
      ],
    };

    env.mount(() => DeclarativePageView({ spec, pageProps: { pluginId: 'root/demo' } }));
    await env.settle();

    const treeText = textOf(env.tree());
    const serialized = JSON.stringify(env.tree());

    // 1. Header Control Bar: auto-refresh selector + 更新于 HH:mm:ss badge + quick action jump pill
    expect(treeText).toContain('手动刷新');
    expect(treeText).toContain('5s 自动');
    expect(treeText).toContain('15s 自动');
    expect(treeText).toContain('30s 自动');
    expect(treeText).toContain('更新于 09:12:47');
    expect(treeText).toContain('快捷操作');

    // 2. Polished Stat Cards with tone classes & tabular-nums
    expect(serialized).toContain('zk-stat-card--success');
    expect(serialized).toContain('zk-stat-card--warning');
    expect(serialized).toContain('zk-stat-card--danger');
    expect(serialized).toContain('zk-stat-card--default');
    expect(serialized).toContain('tabular-nums');

    // 3. Entries Section: 2-column responsive grid layout + semantic badges + copy button
    expect(serialized).toContain('zk-entries-grid grid grid-cols-1 sm:grid-cols-2 gap-2.5');
    expect(treeText).toContain('运行中');
    expect(treeText).toContain('未启用');

    // 4. Table Section: row count badge (共 5 条), inline search input (rows.length > 4), column sorting, empty cell '—'
    expect(treeText).toContain('共 5 条');
    const searchInput = allNodes(env.tree()).find(
      (n) => n.type === 'input' && n.props?.placeholder === '搜索表格内容…',
    );
    expect(searchInput).toBeDefined();
    expect(treeText).toContain('—');

    // Test sorting by clicking the first column header button
    const sortButtons = allNodes(env.tree()).filter(
      (n) => n.type === 'button' && n.props?.className === 'zk-th-sort',
    );
    expect(sortButtons.length).toBeGreaterThanOrEqual(4);
    // Click once for asc ('↑'), click again for desc ('↓')
    (sortButtons[0]!.props!.onClick as () => void)();
    env.rerender();
    expect(textOf(env.tree())).toContain('↑');
    (sortButtons[0]!.props!.onClick as () => void)();
    env.rerender();
    expect(textOf(env.tree())).toContain('↓');

    // Test filtering table rows via search input
    (searchInput!.props!.onChange as (e: { target: { value: string } }) => void)({
      target: { value: 'Epsilon' },
    });
    env.rerender();
    expect(textOf(env.tree())).toContain('共 1 / 5 条');

    // 5. Action Card: Enter key submit in text input + Action Result Preview (image dataUrl & shortUrl copy)
    const textInput = allNodes(env.tree()).find(
      (n) => n.type === 'input' && n.props?.type === 'text',
    );
    expect(textInput).toBeDefined();
    (textInput!.props!.onChange as (e: { target: { value: string } }) => void)({
      target: { value: 'https://zhin.dev/docs' },
    });
    env.rerender();

    const updatedTextInput = allNodes(env.tree()).find(
      (n) => n.type === 'input' && n.props?.type === 'text',
    );
    const preventDefault = vi.fn();
    (updatedTextInput!.props!.onKeyDown as (e: { key: string; preventDefault: () => void }) => void)({
      key: 'Enter',
      preventDefault,
    });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    await env.settle();

    expect(calls.some((c) => c.type === 'plugin.root/demo.generate-qr')).toBe(true);
    const afterActionSerialized = JSON.stringify(env.tree());
    expect(afterActionSerialized).toContain('zk-action-result-preview');
    expect(afterActionSerialized).toContain('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
    expect(afterActionSerialized).toContain('https://zhin.dev/s/abc123');

    env.unmount();
  });

  it('normalizes sections: [{ type: "actions" }] with field.name, preserves badges & dictionary, and converts camelCase action.name to kebab-case RPC', async () => {
    vi.useFakeTimers();

    const calls: { type: string; data: unknown }[] = [];
    stubHost(async (type, data) => {
      calls.push({ type, data });
      if (type === 'plugin.root/rss-hub.poll-now') {
        return { data: { message: '已触发抓取' } };
      }
      return {
        data: {
          status: 'online',
          feedCount: 4,
        },
      };
    });

    const env = createHookEnv();
    const { DeclarativePageView } = env.load(file('../client/ui/declarative-page.tsx'));

    const rawBlueprint = {
      kind: 'zhin.console.page-blueprint',
      version: 1,
      pluginId: 'root/rss-hub',
      title: 'RSS 订阅源管理',
      dictionary: { 'RSS 订阅源管理': 'RSS Hub Manager' },
      badges: [{ key: 'st', label: '在线', tone: 'success' }],
      sections: [
        {
          type: 'actions',
          id: 'rss-actions',
          actions: [
            {
              name: 'pollNow',
              label: '立即轮询',
              fields: [
                { name: 'feedUrl', label: '订阅地址', type: 'text', required: true },
              ],
            },
          ],
        },
      ],
    };

    env.mount(() => DeclarativePageView({ spec: rawBlueprint as never, pageProps: { pluginId: 'root/rss-hub' } }));
    await env.settle();

    const treeText = textOf(env.tree());
    expect(treeText).toContain('在线');
    expect(treeText).toContain('立即轮询');
    expect(treeText).toContain('订阅地址');

    const textInput = allNodes(env.tree()).find(
      (n) => n.type === 'input' && n.props?.type === 'text',
    );
    expect(textInput).toBeDefined();
    (textInput!.props!.onChange as (e: { target: { value: string } }) => void)({
      target: { value: 'https://zhin.dev/feed.xml' },
    });
    env.rerender();

    const updatedTextInput = allNodes(env.tree()).find(
      (n) => n.type === 'input' && n.props?.type === 'text',
    );
    (updatedTextInput!.props!.onKeyDown as (e: { key: string; preventDefault: () => void }) => void)({
      key: 'Enter',
      preventDefault: () => undefined,
    });
    await env.settle();

    const rpcCall = calls.find((c) => c.type === 'plugin.root/rss-hub.poll-now');
    expect(rpcCall).toBeDefined();
    expect(rpcCall?.data).toEqual({ feedUrl: 'https://zhin.dev/feed.xml' });

    env.unmount();
  });
});
