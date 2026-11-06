import { describe, expect, it } from 'vitest';
import {
  buildBlueprintFromSpec,
  createAdapterConsolePage,
  createDeclarativePage,
  defineAdapterPage,
  definePage,
  definePageBlueprint,
  normalizePageMetadata,
  pageRoute,
  resolveDeclarativeText,
  type ConsolePageBlueprint,
  type ConsoleTopologyResponse,
} from '../src/index.js';

describe('Console contract', () => {
  it('normalizes author metadata without adding route authority', () => {
    expect(definePage({ title: 'Status', requiredRoles: ['admin', 'admin'] })).toEqual({
      title: 'Status',
      icon: undefined,
      order: undefined,
      hideInNav: undefined,
      requiredPermissions: [],
      requiredRoles: ['admin'],
    });
    expect(normalizePageMetadata('service-status', undefined)).toMatchObject({
      title: 'Service Status',
      order: 100,
      hideInNav: false,
    });
  });

  it('preserves explicit titles without translating keys, routes or fallback titles', () => {
    const translations = { en: 'Try a conversation', 'zh-CN': '试聊一下' };
    const result = definePage({ title: 'Sandbox', titleI18n: translations });
    expect(result.title).toBe('Sandbox');
    expect(result.titleI18n).toEqual(translations);
    expect(Object.isFrozen(result.titleI18n)).toBe(true);
    translations.en = 'Changed outside';
    expect(result.titleI18n?.en).toBe('Try a conversation');
    expect(normalizePageMetadata('sandbox', { title: 'Original' })).not.toHaveProperty('titleI18n');
    for (const value of [null, [], 'English', { en: '' }, { en: 2 }, { en: undefined }, { fr: 'Français' }]) {
      expect(() => definePage({ titleI18n: value } as never)).toThrow();
    }
  });

  it('derives routes only from Root-relative ownership', () => {
    expect(pageRoute('root', 'root', 'home')).toBe('/p-home');
    expect(pageRoute('root/a/b', 'root', 'status')).toBe('/a/b/p-status');
    expect(() => pageRoute('other/a', 'root', 'status')).toThrow('outside Root');
  });

  it('maps pages/index to the plugin path (no p- leaf)', () => {
    expect(pageRoute('root', 'root', 'index')).toBe('/');
    expect(pageRoute('root/sandbox', 'root', 'index')).toBe('/sandbox');
    expect(pageRoute('root/a/b', 'root', 'index')).toBe('/a/b');
  });

  it('rejects metadata that would otherwise be silently ignored', () => {
    expect(() => definePage({ route: '/custom' } as never)).toThrow('Unknown Page metadata: route');
  });

  it('keeps route layouts in the topology response contract', () => {
    const response = {
      generation: 7,
      pages: [],
      navigation: [],
      route: '/a/p-status',
      resolution: {
        status: 'found',
        page: {
          id: 'page', owner: 'root/a', localName: 'status', source: '/a/pages/status.tsx',
          module: '/assets/status.js', hash: 'status', route: '/a/p-status', title: 'Status',
          order: 10, hideInNav: false, requiredPermissions: [], requiredRoles: [],
        },
        layouts: {
          nav: { id: 'nav', owner: 'root/a', slot: 'nav', source: '/a/pages/nav/index.tsx', module: '/assets/a-nav.js', hash: 'nav' },
          footer: { id: 'footer', owner: 'root', slot: 'footer', source: '/pages/footer/index.tsx', module: '/assets/footer.js', hash: 'footer' },
        },
      },
    } satisfies ConsoleTopologyResponse;
    expect(response.resolution?.status).toBe('found');
  });

  it('resolves DeclarativeI18nText across locales', () => {
    expect(resolveDeclarativeText(undefined)).toBe('');
    expect(resolveDeclarativeText('Plain Title')).toBe('Plain Title');
    expect(resolveDeclarativeText({ zh: '中文', en: 'English' }, 'en')).toBe('English');
    expect(resolveDeclarativeText({ zh: '中文', en: 'English' }, 'zh-CN')).toBe('中文');
    expect(resolveDeclarativeText({ zh: '简体', 'zh-CN': '中国大陆' }, 'en')).toBe('中国大陆');
    expect(resolveDeclarativeText({ zh: '仅中文' }, 'en')).toBe('仅中文');
  });

  it('builds server-driven blueprints and callable page components from DeclarativePageSpec', () => {
    interface ServiceStatus {
      uptime: number;
      endpoints: { id: string; url: string }[];
    }

    const Page = definePageBlueprint<ServiceStatus>({
      title: { zh: '服务状态', en: 'Service Status' },
      description: { zh: '实时监控', en: 'Live telemetry' },
      statusMethod: 'metrics',
      stats: [
        { label: { zh: '运行时长', en: 'Uptime' }, value: 'uptime' },
        { key: 'custom-stat', label: 'Computed', value: (d) => `${d.uptime}s` },
      ],
      sections: [
        {
          id: 'endpoints',
          title: { zh: '端点', en: 'Endpoints' },
          items: 'endpoints',
          columns: [
            { key: 'id', label: 'ID' },
            { key: 'url', label: { zh: '地址', en: 'URL' } },
          ],
        },
        {
          id: 'details',
          title: 'Details',
          entries: (d) => ({ uptime: d.uptime }),
        },
        {
          id: 'custom-block',
          title: 'Custom',
          render: () => 'custom-body',
        },
      ],
      actions: [
        {
          name: 'reload',
          label: { zh: '重载', en: 'Reload' },
          description: { zh: '重新加载配置', en: 'Reload config' },
          variant: 'primary',
        },
      ],
    });

    expect(createDeclarativePage).toBe(definePageBlueprint);
    expect(Page.kind).toBe('zhin.console.page-blueprint');
    expect(Page.version).toBe(1);
    expect(Page.title).toBe('Service Status');
    expect(Page.titleI18n).toEqual({ 'zh-CN': '服务状态', en: 'Service Status' });
    expect(Page.description).toBe('Live telemetry');
    expect(Page.dataSource).toEqual({ action: 'metrics' });
    expect(Page.sections).toEqual([
      {
        type: 'stats',
        id: 'runtime-stats',
        title: 'Runtime Stats',
        items: [
          { key: 'uptime', label: 'Uptime', dataKey: 'uptime' },
          { key: 'custom-stat', label: 'Computed' },
        ],
      },
      {
        type: 'table',
        id: 'endpoints',
        title: 'Endpoints',
        dataKey: 'endpoints',
        rowKey: 'id',
        columns: [
          { key: 'id', label: 'ID' },
          { key: 'url', label: 'URL' },
        ],
      },
      {
        type: 'entries',
        id: 'details',
        title: 'Details',
      },
      {
        type: 'custom',
        id: 'custom-block',
        title: 'Custom',
      },
      {
        type: 'actions',
        id: 'actions',
        title: 'Actions',
        items: [
          {
            label: 'Reload',
            action: 'reload',
            name: 'reload',
            description: 'Reload config',
            variant: 'primary',
          },
        ],
      },
    ]);

    const invoked = Page({ pluginId: 'root/demo' });
    expect(invoked.kind).toBe('zhin.console.page-blueprint');
    expect(invoked.title).toBe('Service Status');
    expect(Object.isFrozen(Page)).toBe(true);
    expect(Object.isFrozen(invoked)).toBe(true);

    // Passing an existing ConsolePageBlueprint through buildBlueprintFromSpec preserves it
    const passthrough = buildBlueprintFromSpec(invoked as ConsolePageBlueprint<ServiceStatus>);
    expect(passthrough).toEqual(invoked);
    expect(Object.isFrozen(passthrough)).toBe(true);
  });

  it('creates zero-React adapter console page blueprints', () => {
    expect(createAdapterConsolePage).toBe(defineAdapterPage);
    const AdapterPage = defineAdapterPage('telegram');
    expect(AdapterPage.kind).toBe('zhin.console.adapter-page');
    expect(AdapterPage.version).toBe(1);
    expect(AdapterPage.adapterKey).toBe('telegram');
    expect(AdapterPage.dataSource).toEqual({ action: 'status' });
    expect(AdapterPage()).toEqual({
      kind: 'zhin.console.adapter-page',
      version: 1,
      adapterKey: 'telegram',
      dataSource: { action: 'status' },
    });
    expect(Object.isFrozen(AdapterPage)).toBe(true);
    expect(() => defineAdapterPage('')).toThrow('Adapter page adapterKey must be a non-empty string');
    expect(() => defineAdapterPage('   ')).toThrow('Adapter page adapterKey must be a non-empty string');
  });
});
