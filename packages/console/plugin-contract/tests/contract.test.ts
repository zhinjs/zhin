import { describe, expect, it } from 'vitest';
import {
  buildBlueprintFromSpec,
  createAdapterConsolePage,
  createCommentReviewPage,
  createDeclarativePage,
  defineAdapterPage,
  defineCommentReviewPage,
  definePage,
  definePageBlueprint,
  normalizePageMetadata,
  pageRoute,
  projectBlueprintToCliPanel,
  projectBlueprintToImCard,
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

  it('accepts the same presentation keys as @zhin.js/page', () => {
    const result = definePage({
      title: 'Status', description: 'Live status', group: 'ops', parent: '/ops', fullWidth: true,
    });
    expect(result).toMatchObject({
      title: 'Status', description: 'Live status', group: 'ops', parent: '/ops', fullWidth: true,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(definePage({ title: 'Status' })).not.toHaveProperty('group');
    expect(() => definePage({ group: ' ' })).toThrow('Page group must be a non-empty string');
    expect(() => definePage({ description: 1 } as never)).toThrow('Page description must be a non-empty string');
    expect(() => definePage({ parent: '' })).toThrow('Page parent must be a non-empty string');
    expect(() => definePage({ fullWidth: 'yes' } as never)).toThrow('Page fullWidth must be boolean');
    // Manifest normalization stays strict: these keys are not route/navigation authority.
    expect(() => normalizePageMetadata('status', { group: 'ops' })).toThrow('Unknown Page metadata: group');
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

  it('creates zero-React comment review page blueprints and projects Blueprints to IM Card & CLI TUI', () => {
    expect(createCommentReviewPage).toBe(defineCommentReviewPage);
    const ReviewPage = defineCommentReviewPage({
      adapter: 'bilibili',
      platform: { zh: 'B 站', en: 'Bilibili' },
      mark: 'B',
      resource: { zh: '视频', en: 'videos' },
      loginMode: 'qr',
    });
    expect(ReviewPage.kind).toBe('zhin.console.page-blueprint');
    expect(ReviewPage.title).toBe('Bilibili comment review');
    expect(ReviewPage.titleI18n).toEqual({ 'zh-CN': 'B 站评论审批', en: 'Bilibili comment review' });
    expect(ReviewPage.reviewSpec?.adapter).toBe('bilibili');

    const imCard = projectBlueprintToImCard(
      ReviewPage,
      {
        endpoints: [
          {
            id: 'main',
            sendMode: 'review',
            persistent: true,
            circuit: null,
            login: { state: 'ok' },
            pendingCount: 2,
            drafts: [],
          },
        ],
      },
      { locale: 'zh-CN', pluginId: 'bilibili' },
    );
    expect(imCard.kind).toBe('zhin.im.blueprint-card');
    expect(imCard.title).toBe('B 站评论审批');
    expect(imCard.stats).toEqual([
      { key: 'endpoints', label: '账号数', value: '1' },
      { key: 'pendingDrafts', label: '待审草稿', value: '2' },
    ]);
    expect(imCard.tables[0]?.rows).toEqual([['main', 'review', '2']]);
    expect(imCard.markdown).toContain('### B 站评论审批');
    expect(imCard.markdown).toContain('| main | review | 2 |');
    expect(imCard.segments.some((s) => s.type === 'card')).toBe(true);
    expect(imCard.segments.some((s) => s.type === 'button' && s.data.action === 'send')).toBe(true);

    const cliPanel = projectBlueprintToCliPanel(
      ReviewPage,
      {
        endpoints: [
          {
            id: 'main',
            sendMode: 'review',
            persistent: true,
            circuit: null,
            login: { state: 'ok' },
            pendingCount: 2,
            drafts: [],
          },
        ],
      },
      { locale: 'zh-CN', pluginId: 'bilibili', width: 64 },
    );
    expect(cliPanel).toContain('┌');
    expect(cliPanel).toContain('[bilibili] B 站评论审批');
    expect(cliPanel).toContain('账号数: 1');
    expect(cliPanel).toContain('待审草稿: 2');
    expect(cliPanel).toContain('main | review | 2');
    expect(cliPanel).toContain('└');

    const adapterCard = projectBlueprintToImCard(
      defineAdapterPage('telegram'),
      { bots: [{ id: 'tg-1', online: true }] },
      { locale: 'zh-CN' },
    );
    expect(adapterCard.title).toBe('telegram 适配器状态');
    expect(adapterCard.stats).toContainEqual({ key: 'online', label: '在线数', value: '1' });
  });

  it('evaluates zero-closure DeclarativeValueExpr descriptors across IM Card and JSON blueprints', () => {
    const bp = definePageBlueprint({
      pluginId: 'metrics',
      title: { zh: '运行指标', en: 'Runtime Metrics' },
      stats: [
        { key: 'total', label: { zh: '节点数', en: 'Nodes' }, value: { $count: 'nodes' } },
        { key: 'pending', label: { zh: '积压任务', en: 'Pending' }, value: { $sum: { path: 'nodes', field: 'queued' } } },
        { key: 'latency', label: { zh: '延迟', en: 'Latency' }, value: { $format: '{0} ms', args: ['summary.latencyMs'] } },
        {
          key: 'state',
          label: { zh: '状态', en: 'State' },
          value: {
            $map: {
              path: 'summary.healthy',
              cases: { true: { zh: '健康', en: 'Healthy' }, false: { zh: '异常', en: 'Degraded' } },
            },
          },
        },
        { key: 'tags', label: { zh: '标签', en: 'Tags' }, value: { $join: { path: 'tags', sep: ' / ' } } },
        { key: 'leader', label: { zh: '主节点', en: 'Leader' }, value: { $coalesce: ['summary.primary', 'summary.fallback'], fallback: 'none' } },
      ],
      sections: [
        {
          id: 'nodes',
          title: { zh: '节点列表', en: 'Node List' },
          items: 'nodes',
          columns: [
            { key: 'id', label: 'ID' },
            { key: 'queued', label: { zh: '队列', en: 'Queued' } },
          ],
        },
      ],
    });

    // Even when `spec` is stripped (pure JSON blueprint over HTTP), `sections[].items[].expr` preserves evaluation
    const jsonOnlyBp = JSON.parse(JSON.stringify({ ...bp, spec: undefined }));
    const sampleData = {
      summary: { latencyMs: 42, healthy: true, fallback: 'node-b' },
      tags: ['prod', 'cn-east'],
      nodes: [
        { id: 'node-a', queued: 3 },
        { id: 'node-b', queued: 5 },
      ],
    };

    const card = projectBlueprintToImCard(bp, sampleData, { locale: 'zh-CN' });
    expect(card.stats).toEqual([
      { key: 'total', label: '节点数', value: '2' },
      { key: 'pending', label: '积压任务', value: '8' },
      { key: 'latency', label: '延迟', value: '42 ms' },
      { key: 'state', label: '状态', value: '健康' },
      { key: 'tags', label: '标签', value: 'prod / cn-east' },
      { key: 'leader', label: '主节点', value: 'node-b' },
    ]);

    const jsonCard = projectBlueprintToImCard(jsonOnlyBp, sampleData, { locale: 'en' });
    expect(jsonCard.stats).toEqual([
      { key: 'total', label: 'Nodes', value: '2' },
      { key: 'pending', label: 'Pending', value: '8' },
      { key: 'latency', label: 'Latency', value: '42 ms' },
      { key: 'state', label: 'State', value: 'Healthy' },
      { key: 'tags', label: 'Tags', value: 'prod / cn-east' },
      { key: 'leader', label: 'Leader', value: 'node-b' },
    ]);
  });

  it('supports $format.$args, entries with DeclarativeValueExpr & dataKey, and nested table column paths', () => {
    const bp = definePageBlueprint({
      pluginId: 'cluster',
      title: 'Cluster Overview',
      stats: [
        {
          key: 'version',
          label: 'Version',
          value: { $format: 'v{0} ({1})', $args: ['meta.version', 'meta.channel'] },
        },
      ],
      sections: [
        {
          id: 'summary-entries',
          title: 'Summary Entries',
          entries: [
            { label: 'Region', value: '', dataKey: 'meta.region' },
            { label: 'NodeCount', value: { $count: 'cluster.nodes' } },
            { label: 'LiteralMode', value: 'active-active' },
          ],
        },
        {
          id: 'nested-table',
          title: 'Nested Nodes',
          items: 'cluster.nodes',
          columns: [
            { key: 'id', label: 'ID' },
            { key: 'metrics.cpu', label: 'CPU' },
          ],
        },
      ],
    });

    const jsonOnlyBp = JSON.parse(JSON.stringify({ ...bp, spec: undefined }));
    const data = {
      meta: {
        version: '1.2.0',
        channel: 'stable',
        region: 'ap-east-1',
      },
      cluster: {
        nodes: [
          { id: 'n1', metrics: { cpu: '12%' } },
          { id: 'n2', metrics: { cpu: '34%' } },
        ],
      },
    };

    for (const target of [bp, jsonOnlyBp]) {
      const card = projectBlueprintToImCard(target, data, { locale: 'en' });
      expect(card.stats).toEqual([{ key: 'version', label: 'Version', value: 'v1.2.0 (stable)' }]);
      expect(card.entries).toEqual([
        {
          id: 'summary-entries',
          title: 'Summary Entries',
          items: [
            { label: 'Region', value: 'ap-east-1' },
            { label: 'NodeCount', value: '2' },
            { label: 'LiteralMode', value: 'active-active' },
          ],
        },
      ]);
      expect(card.tables).toEqual([
        {
          id: 'nested-table',
          title: 'Nested Nodes',
          columns: [
            { key: 'id', label: 'ID' },
            { key: 'metrics.cpu', label: 'CPU' },
          ],
          rows: [
            ['n1', '12%'],
            ['n2', '34%'],
          ],
          totalRows: 2,
        },
      ]);
    }
  });
});
