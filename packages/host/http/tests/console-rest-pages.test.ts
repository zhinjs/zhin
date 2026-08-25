import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttpHost, type HttpHost } from '../src/http-host.js';
import {
  registerConsoleRestPages,
  type ConsoleAgentRuntime,
  type ConsoleRestCtx,
} from '../src/console-rest-pages.js';

const hosts: HttpHost[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function startHost(
  ctx: ConsoleRestCtx,
  options?: Parameters<typeof registerConsoleRestPages>[2],
): Promise<string> {
  const host = createHttpHost({ host: '127.0.0.1', port: 0 });
  hosts.push(host);
  registerConsoleRestPages(host, ctx, options);
  const { port } = await host.listen();
  return `http://127.0.0.1:${port}`;
}

function baseCtx(overrides: Partial<ConsoleRestCtx> = {}): ConsoleRestCtx {
  return { fullScope: true, projectRoot: '/nonexistent', ...overrides };
}

function lease(value: ConsoleAgentRuntime) {
  return { value, release: () => undefined };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// logs
// ---------------------------------------------------------------------------

type FakeLogRow = {
  id: number;
  level: string;
  name: string;
  message: string;
  source: string;
  timestamp: Date;
};

function fakeLogModel(initial: FakeLogRow[]) {
  let rows = [...initial];
  const matchWhere = (row: FakeLogRow, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, cond]) => {
      const value = (row as unknown as Record<string, unknown>)[key];
      if (cond && typeof cond === 'object') {
        const ops = cond as Record<string, unknown>;
        if ('$lt' in ops) return new Date(value as string | Date) < new Date(ops.$lt as string | Date);
        if ('$in' in ops) return (ops.$in as unknown[]).includes(value);
      }
      return value === cond;
    });
  const chain = (list: FakeLogRow[]) => {
    const selection = {
      where: (where: Record<string, unknown>) => chain(list.filter((row) => matchWhere(row, where))),
      orderBy: (field: keyof FakeLogRow, direction: 'ASC' | 'DESC') =>
        chain([...list].sort((a, b) => {
          const left = a[field] as unknown as string;
          const right = b[field] as unknown as string;
          const cmp = left < right ? -1 : left > right ? 1 : 0;
          return direction === 'ASC' ? cmp : -cmp;
        })),
      limit: (count: number) => Promise.resolve(list.slice(0, count)),
      then: Promise.prototype.then.bind(Promise.resolve(list)),
    };
    return selection;
  };
  return {
    select: (..._fields: string[]) => chain(rows),
    delete: (where: Record<string, unknown>) => {
      const before = rows.length;
      rows = rows.filter((row) => !matchWhere(row, where));
      return Promise.resolve(before - rows.length);
    },
    remaining: () => rows.length,
  };
}

function fakeDatabaseHost(model: unknown): NonNullable<ConsoleRestCtx['databaseHost']> {
  return {
    dialect: 'sqlite',
    started: true,
    models: { get: (name: string) => (name === 'SystemLog' ? model : undefined) },
  };
}

const sampleLogs: FakeLogRow[] = [
  { id: 1, level: 'info', name: 'App', message: 'boot', source: 'App', timestamp: new Date('2026-01-01T00:00:00Z') },
  { id: 2, level: 'error', name: 'Db', message: 'boom', source: 'Db', timestamp: new Date('2026-01-02T00:00:00Z') },
  { id: 3, level: 'warn', name: 'App', message: 'slow', source: 'App', timestamp: new Date('2026-01-03T00:00:00Z') },
];

describe('console-rest-pages logs', () => {
  it('GET /api/logs 返回 legacy 形状并支持 level 过滤', async () => {
    const base = await startHost(baseCtx({ databaseHost: fakeDatabaseHost(fakeLogModel(sampleLogs)) }));
    const all = await json(await fetch(`${base}/api/logs`));
    expect(all.success).toBe(true);
    expect(all.total).toBe(3);
    const data = all.data as Array<Record<string, unknown>>;
    // 按 timestamp DESC；legacy 形状不含 id 字段
    expect(data.map((row) => row.timestamp)).toEqual([
      '2026-01-03T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
    expect(data[0]).toMatchObject({
      level: 'warn',
      name: 'App',
      message: 'slow',
      source: 'App',
      timestamp: '2026-01-03T00:00:00.000Z',
    });

    const errors = await json(await fetch(`${base}/api/logs?level=error`));
    expect(errors.total).toBe(1);
    expect((errors.data as unknown[])[0]).toMatchObject({ level: 'error', message: 'boom' });
  });

  it('GET /api/logs 无 SystemLog 模型时降级为空数组 + note', async () => {
    const base = await startHost(baseCtx());
    const body = await json(await fetch(`${base}/api/logs`));
    expect(body).toMatchObject({ success: true, data: [], total: 0 });
    expect(typeof body.note).toBe('string');
  });

  it('GET /api/logs/stats 返回总数/按级别计数/最早时间', async () => {
    const base = await startHost(baseCtx({ databaseHost: fakeDatabaseHost(fakeLogModel(sampleLogs)) }));
    const body = await json(await fetch(`${base}/api/logs/stats`));
    expect(body).toMatchObject({
      success: true,
      data: {
        total: 3,
        byLevel: { info: 1, warn: 1, error: 1 },
        oldestTimestamp: '2026-01-01T00:00:00.000Z',
      },
    });
  });

  it('GET /api/logs/stats 优先使用模型 DB 侧 count 聚合', async () => {
    const model = fakeLogModel(sampleLogs);
    const countCalls: Array<Record<string, unknown> | undefined> = [];
    const countingModel = {
      ...model,
      count: async (where?: Record<string, unknown>) => {
        countCalls.push(where);
        if (!where) return 42;
        return where.level === 'info' ? 40 : 1;
      },
    };
    const base = await startHost(baseCtx({ databaseHost: fakeDatabaseHost(countingModel) }));
    const body = await json(await fetch(`${base}/api/logs/stats`));
    expect(body.data).toMatchObject({
      total: 42,
      byLevel: { info: 40, warn: 1, error: 1 },
      oldestTimestamp: '2026-01-01T00:00:00.000Z',
    });
    // total + info/warn/error 四次计数全部走 count 聚合
    expect(countCalls).toHaveLength(4);
  });

  it('DELETE /api/logs 清空日志（full scope）', async () => {
    const model = fakeLogModel(sampleLogs);
    const base = await startHost(baseCtx({ databaseHost: fakeDatabaseHost(model) }));
    const response = await fetch(`${base}/api/logs`, { method: 'DELETE' });
    expect(await json(response)).toMatchObject({ success: true, message: '日志已清空' });
    expect(model.remaining()).toBe(0);
  });

  it('POST /api/logs/cleanup 按 days 与 maxRecords 清理', async () => {
    const old = new Date();
    old.setDate(old.getDate() - 30);
    const recent = new Date();
    const model = fakeLogModel([
      { id: 1, level: 'info', name: 'A', message: 'old', source: 'A', timestamp: old },
      { id: 2, level: 'info', name: 'A', message: 'new1', source: 'A', timestamp: recent },
      { id: 3, level: 'info', name: 'A', message: 'new2', source: 'A', timestamp: recent },
    ]);
    const base = await startHost(baseCtx({ databaseHost: fakeDatabaseHost(model) }));

    const byDays = await fetch(`${base}/api/logs/cleanup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days: 7 }),
    });
    expect(await json(byDays)).toMatchObject({ success: true, deletedCount: 1 });
    expect(model.remaining()).toBe(2);

    const byMax = await fetch(`${base}/api/logs/cleanup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ maxRecords: 1 }),
    });
    expect(await json(byMax)).toMatchObject({ success: true, deletedCount: 1 });
    expect(model.remaining()).toBe(1);
  });

  it('demo ctx（fullScope=false）写操作 403、读操作放行', async () => {
    const base = await startHost(baseCtx({
      fullScope: false,
      databaseHost: fakeDatabaseHost(fakeLogModel(sampleLogs)),
    }));
    const read = await fetch(`${base}/api/logs`);
    expect(read.status).toBe(200);

    const del = await fetch(`${base}/api/logs`, { method: 'DELETE' });
    expect(del.status).toBe(403);
    expect(await json(del)).toMatchObject({ success: false });

    const cleanup = await fetch(`${base}/api/logs/cleanup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days: 1 }),
    });
    expect(cleanup.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// marketplace
// ---------------------------------------------------------------------------

const registryFixture = {
  plugins: [
    {
      name: '@zhin.js/plugin-foo',
      displayName: 'Foo',
      version: '1.0.0',
      description: 'foo plugin',
      author: 'zhin',
      isOfficial: true,
      category: 'util',
      tags: ['foo', 'demo'],
      downloads: { weekly: 10, monthly: 40 },
    },
    {
      name: 'plugin-bar',
      displayName: 'Bar',
      version: '2.0.0',
      description: 'bar plugin',
      author: 'community',
      isOfficial: false,
      category: 'game',
      tags: ['bar'],
    },
  ],
};

function fakeMarketplaceFetch(url: unknown): Promise<Response> {
  const u = String(url);
  const respond = (data: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    }));
  if (u === 'https://plugins.test/plugins.json') return respond(registryFixture);
  if (u === 'https://npm.test/%40zhin.js%2Fplugin-foo/latest') {
    return respond({ version: '1.1.0', description: 'foo plugin latest' });
  }
  if (u === 'https://npm.test/%40zhin.js%2Fplugin-foo') {
    return respond({
      name: '@zhin.js/plugin-foo',
      description: 'foo plugin',
      readme: '# foo',
      'dist-tags': { latest: '1.1.0' },
      versions: {
        '1.0.0': { license: 'MIT', keywords: ['foo'] },
        '1.1.0': { license: 'MIT', keywords: ['foo', 'latest'] },
      },
      time: { '1.0.0': '2026-01-01T00:00:00Z', '1.1.0': '2026-02-01T00:00:00Z' },
      author: { name: 'zhin' },
    });
  }
  return respond({ error: 'not found' }, 404);
}

const marketplaceOptions = {
  fetchFn: fakeMarketplaceFetch as typeof fetch,
  pluginRegistryUrl: 'https://plugins.test/plugins.json',
  npmRegistryUrl: 'https://npm.test',
};

describe('console-rest-pages marketplace', () => {
  it('GET /pub/marketplace/search 返回分页列表并支持 keyword/category/official 过滤', async () => {
    const base = await startHost(baseCtx(), marketplaceOptions);
    const all = await json(await fetch(`${base}/pub/marketplace/search`));
    expect(all).toMatchObject({ success: true, total: 2, page: 1, size: 20 });
    const items = all.data as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({
      name: '@zhin.js/plugin-foo',
      displayName: 'Foo',
      official: true,
      isOfficial: true,
      category: 'util',
      keywords: ['foo', 'demo'],
      downloads: { weekly: 10, monthly: 40 },
    });

    const filtered = await json(await fetch(`${base}/pub/marketplace/search?q=bar`));
    expect(filtered.total).toBe(1);
    expect((filtered.data as unknown[])[0]).toMatchObject({ name: 'plugin-bar' });

    const officials = await json(await fetch(
      `${base}/pub/marketplace/search?official=true&category=util`,
    ));
    expect(officials.total).toBe(1);
  });

  it('GET /pub/marketplace/detail/:name 返回包详情（scoped 名可带斜杠）', async () => {
    const base = await startHost(baseCtx(), marketplaceOptions);
    const body = await json(await fetch(
      `${base}/pub/marketplace/detail/${encodeURIComponent('@zhin.js/plugin-foo')}`,
    ));
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      name: '@zhin.js/plugin-foo',
      version: '1.1.0',
      license: 'MIT',
      author: 'zhin',
      keywords: ['foo', 'latest'],
      downloads: { weekly: 10, monthly: 40 },
      versions: ['1.0.0', '1.1.0'],
      lastPublish: '2026-02-01T00:00:00Z',
    });
  });

  it('GET /pub/marketplace/detail 未知名 → 502', async () => {
    const base = await startHost(baseCtx(), marketplaceOptions);
    const response = await fetch(`${base}/pub/marketplace/detail/unknown-pkg`);
    expect(response.status).toBe(502);
    expect(await json(response)).toMatchObject({ success: false });
  });

  it('GET /api/marketplace/updates 对照本地已装版本', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-rest-pages-'));
    tempDirs.push(projectRoot);
    await writeFile(join(projectRoot, 'package.json'), JSON.stringify({
      zhin: { plugins: [{ package: '@zhin.js/plugin-foo', instanceKey: 'foo' }] },
    }));
    await mkdir(join(projectRoot, 'node_modules', '@zhin.js', 'plugin-foo'), { recursive: true });
    await writeFile(
      join(projectRoot, 'node_modules', '@zhin.js', 'plugin-foo', 'package.json'),
      JSON.stringify({ name: '@zhin.js/plugin-foo', version: '1.0.0' }),
    );

    const base = await startHost(baseCtx({ projectRoot }), marketplaceOptions);
    const body = await json(await fetch(`${base}/api/marketplace/updates`));
    expect(body.success).toBe(true);
    expect(body.data).toEqual([{
      name: '@zhin.js/plugin-foo',
      latest: '1.1.0',
      description: 'foo plugin latest',
      current: '1.0.0',
    }]);
  });

  it('GET /api/marketplace/updates 无已装插件 → 空数组', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-rest-pages-'));
    tempDirs.push(projectRoot);
    const base = await startHost(baseCtx({ projectRoot }), marketplaceOptions);
    const body = await json(await fetch(`${base}/api/marketplace/updates`));
    expect(body).toMatchObject({ success: true, data: [] });
  });
});

// ---------------------------------------------------------------------------
// introspection
// ---------------------------------------------------------------------------

function fakeAgentRuntime(overrides: Partial<ConsoleAgentRuntime> = {}): ConsoleAgentRuntime {
  return {
    introspection: {
      commands: () => [
        { pattern: 'foo', desc: 'foo cmd', plugin: 'core' },
        { pattern: 'bar', desc: 'bar cmd', plugin: 'game' },
      ],
      middlewares: () => [{ name: 'audit', owner: 'root', phase: 'before-dispatch', target: 'inbound', order: 10 }],
      components: () => [{ name: 'status-card', owner: 'root', source: './components/status-card.ts' }],
      renderComponent: async ({ requester, name, props }) => ({
        type: 'text', data: { text: `${requester}:${name}:${JSON.stringify(props)}` },
      }),
      bindings: () => [{ name: 'main', provider: 'openai', model: 'gpt-x' }],
      tools: () => [{ name: 'search', source: 'builtin', description: 'web search' }],
      promptSections: () => [{
        name: 'project-rules',
        qualifiedName: 'root:project-rules',
        title: 'Project rules',
        owner: 'root',
        layer: 'context',
        order: 70,
        retention: 'preferred',
        profiles: ['interactive'],
        source: './agent/prompt-sections/project-rules.ts',
        generation: 7,
        contentChars: 36,
      }],
      mcp: () => ({ rows: [{ name: 'fs', connected: true, toolCount: 3 }] }),
    },
    ...overrides,
  };
}

describe('console-rest-pages introspection', () => {
  it('GET /api/introspection/commands 返回 legacy 分页信封并支持 filter', async () => {
    const base = await startHost(baseCtx({ acquireAgentRuntime: () => lease(fakeAgentRuntime()) }));
    const body = await json(await fetch(`${base}/api/introspection/commands`));
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ page: 1, pageSize: 25, total: 2, totalPages: 1 });
    expect((body.data as { items: unknown[] }).items[0]).toMatchObject({ pattern: 'foo' });

    const filtered = await json(await fetch(`${base}/api/introspection/commands?filter=game`));
    expect((filtered.data as { total: number }).total).toBe(1);
    expect((filtered.data as { items: unknown[] }).items[0]).toMatchObject({ pattern: 'bar' });
  });

  it('GET /api/introspection/endpoints 来自 ctx.getEndpoints', async () => {
    const base = await startHost(baseCtx({
      getEndpoints: () => [
        { name: 'main', adapter: 'icqq', connected: true, status: 'online' },
        { name: 'bot2', adapter: 'qq', connected: false, status: 'offline' },
      ],
    }));
    const body = await json(await fetch(`${base}/api/introspection/endpoints`));
    expect(body.success).toBe(true);
    expect((body.data as { items: unknown[] }).items).toEqual([
      { adapter: 'icqq', name: 'main', online: true, status: 'online' },
      { adapter: 'qq', name: 'bot2', online: false, status: 'offline' },
    ]);
  });

  it('GET /api/introspection/tools|bindings|mcp 形状与 note', async () => {
    const base = await startHost(baseCtx({ acquireAgentRuntime: () => lease(fakeAgentRuntime()) }));
    const tools = await json(await fetch(`${base}/api/introspection/tools`));
    expect((tools.data as { items: unknown[] }).items[0]).toMatchObject({
      name: 'search',
      source: 'builtin',
    });
    const bindings = await json(await fetch(`${base}/api/introspection/bindings`));
    expect((bindings.data as { items: unknown[] }).items[0]).toMatchObject({
      name: 'main',
      provider: 'openai',
      model: 'gpt-x',
    });
    const mcp = await json(await fetch(`${base}/api/introspection/mcp`));
    expect((mcp.data as { items: unknown[] }).items[0]).toMatchObject({
      name: 'fs',
      connected: true,
      toolCount: 3,
    });
  });

  it('exposes prompt section policy without exposing prompt content', async () => {
    const base = await startHost(baseCtx({ acquireAgentRuntime: () => lease(fakeAgentRuntime()) }));
    const response = await fetch(`${base}/api/introspection/prompt-sections`);
    const body = await json(response);
    const item = (body.data as { items: Array<Record<string, unknown>> }).items[0]!;

    expect(response.status).toBe(200);
    expect(item).toMatchObject({
      name: 'project-rules',
      title: 'Project rules',
      retention: 'preferred',
      generation: 7,
      contentChars: 36,
    });
    expect(item).not.toHaveProperty('content');
  });

  it('exposes middleware/component catalogs and renders a full-scope preview', async () => {
    const base = await startHost(baseCtx({ acquireAgentRuntime: () => lease(fakeAgentRuntime()) }));
    const middlewares = await json(await fetch(`${base}/api/introspection/middlewares`));
    expect((middlewares.data as { items: unknown[] }).items[0]).toMatchObject({
      name: 'audit', phase: 'before-dispatch', target: 'inbound', order: 10,
    });
    const components = await json(await fetch(`${base}/api/introspection/components`));
    expect((components.data as { items: unknown[] }).items[0]).toMatchObject({
      name: 'status-card', owner: 'root',
    });
    const rendered = await json(await fetch(`${base}/api/introspection/components/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requester: 'root', name: 'status-card', props: { online: true } }),
    }));
    expect(rendered).toMatchObject({
      success: true,
      data: { output: { type: 'text', data: { text: 'root:status-card:{"online":true}' } } },
    });

    const demo = await startHost(baseCtx({
      fullScope: false,
      acquireAgentRuntime: () => lease(fakeAgentRuntime()),
    }), { apiBase: '/demo-api' });
    const denied = await fetch(`${demo}/demo-api/introspection/components/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requester: 'root', name: 'status-card', props: {} }),
    });
    expect(denied.status).toBe(403);
  });

  it('bounds Component preview time and serialized output', async () => {
    let released = 0;
    const stalled = new Promise<never>(() => {});
    const timeoutBase = await startHost(baseCtx({
      acquireAgentRuntime: () => ({
        value: fakeAgentRuntime({
          introspection: {
            ...fakeAgentRuntime().introspection,
            renderComponent: async () => stalled,
          },
        }),
        release: () => { released += 1; },
      }),
    }), { componentPreviewTimeoutMs: 15, componentPreviewMaxConcurrent: 1 });
    const timedOut = await fetch(`${timeoutBase}/api/introspection/components/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requester: 'root', name: 'status-card', props: {} }),
    });
    expect(timedOut.status).toBe(408);
    expect(released).toBe(0);
    const saturated = await fetch(`${timeoutBase}/api/introspection/components/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requester: 'root', name: 'status-card', props: {} }),
    });
    expect(saturated.status).toBe(503);

    const oversizedBase = await startHost(baseCtx({
      acquireAgentRuntime: () => lease(fakeAgentRuntime({
        introspection: {
          ...fakeAgentRuntime().introspection,
          renderComponent: async () => ({ type: 'text', data: { text: 'x'.repeat(512) } }),
        },
      })),
    }), { componentPreviewMaxBytes: 128 });
    const oversized = await fetch(`${oversizedBase}/api/introspection/components/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requester: 'root', name: 'status-card', props: {} }),
    });
    expect(oversized.status).toBe(413);
  });

  it('未接线 acquireAgentRuntime 时降级为空列表 + note（200）', async () => {
    const base = await startHost(baseCtx());
    const body = await json(await fetch(`${base}/api/introspection/tools`));
    expect(body.success).toBe(true);
    expect((body.data as { items: unknown[] }).items).toEqual([]);
    expect(typeof (body.data as { note?: string }).note).toBe('string');
  });

  it('collector 抛错时按 legacy err 路径返回 503', async () => {
    const base = await startHost(baseCtx({
      acquireAgentRuntime: () => lease({
        introspection: {
          commands: () => {
            throw new Error('CommandFeature 不可用');
          },
        },
      } satisfies ConsoleAgentRuntime),
    }));
    const response = await fetch(`${base}/api/introspection/commands`);
    expect(response.status).toBe(503);
    expect(await json(response)).toMatchObject({
      success: false,
      error: 'CommandFeature 不可用',
    });
  });

  it('holds the generation lease until a catalog collector completes', async () => {
    let released = false;
    let acquisitions = 0;
    const base = await startHost(baseCtx({
      acquireAgentRuntime: () => {
        acquisitions += 1;
        return {
          value: {
            introspection: {
              components: () => {
                expect(released).toBe(false);
                return [{ name: 'card', owner: 'root', source: './card.ts' }];
              },
            },
          },
          release: () => { released = true; },
        };
      },
    }));
    const response = await fetch(`${base}/api/introspection/components`);
    expect(response.status).toBe(200);
    expect(acquisitions).toBe(1);
    expect(released).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// agent sessions
// ---------------------------------------------------------------------------

function fakeSessionTree() {
  return {
    resolveActiveSessionId: (key: string) =>
      Promise.resolve(key === 'known' ? 'sid-1' : null),
    getActiveLeafMessageId: () => Promise.resolve(7),
    listBranchPoints: () => Promise.resolve([{ messageId: 3, branchCount: 2 }]),
    switchActiveLeaf: (_id: string, messageId: number) => Promise.resolve(messageId === 9),
    jumpToBranchIndex: (_id: string, index: number) =>
      Promise.resolve(index === 2
        ? { ok: true, message: '已跳转' }
        : { ok: false, message: '分支索引越界' }),
  };
}

function sessionCtx(overrides: Partial<ConsoleRestCtx> = {}): ConsoleRestCtx {
  return baseCtx({
    acquireAgentRuntime: () => lease({ sessionTree: fakeSessionTree() } satisfies ConsoleAgentRuntime),
    ...overrides,
  });
}

describe('console-rest-pages agent sessions', () => {
  it('holds the Agent generation lease until the async session operation settles', async () => {
    let resolveSession!: (value: string | null) => void;
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    let releases = 0;
    const tree = {
      ...fakeSessionTree(),
      resolveActiveSessionId: () => new Promise<string | null>((resolve) => {
        resolveSession = resolve;
        markEntered();
      }),
    };
    const base = await startHost(baseCtx({
      acquireAgentRuntime: () => ({
        value: { sessionTree: tree },
        release: () => { releases += 1; },
      }),
    }));

    const pending = fetch(`${base}/api/agent/sessions/known/tree`);
    await entered;
    expect(releases).toBe(0);
    resolveSession('sid-1');
    expect((await pending).status).toBe(200);
    expect(releases).toBe(1);
  });

  it('GET /api/agent/sessions/:key/tree 返回 legacy 形状', async () => {
    const base = await startHost(sessionCtx());
    const body = await json(await fetch(`${base}/api/agent/sessions/known/tree`));
    expect(body).toMatchObject({
      success: true,
      data: {
        state: 'active',
        sessionKey: 'known',
        sessionId: 'sid-1',
        activeLeafMessageId: 7,
        points: [{ messageId: 3, branchCount: 2 }],
      },
    });
  });

  it('GET tree：尚未产生 Agent 对话的渠道会话返回可渲染空态', async () => {
    const base = await startHost(sessionCtx());
    const sessionKey = 'icqq:endpoint:group:scene';
    const missing = await fetch(
      `${base}/api/agent/sessions/${encodeURIComponent(sessionKey)}/tree`,
    );
    expect(missing.status).toBe(200);
    expect(await json(missing)).toMatchObject({
      success: true,
      data: {
        state: 'not_started',
        sessionKey,
        sessionId: null,
        activeLeafMessageId: null,
        points: [],
      },
    });
  });

  it('GET tree：不存在的非渠道会话 key 仍返回 404', async () => {
    const base = await startHost(sessionCtx());
    const missing = await fetch(`${base}/api/agent/sessions/definitely-not-a-session/tree`);
    expect(missing.status).toBe(404);
    expect(await json(missing)).toMatchObject({ success: false });
  });

  it('GET tree：runtime 未装配 503', async () => {
    const bare = await startHost(baseCtx());
    const unavailable = await fetch(`${bare}/api/agent/sessions/known/tree`);
    expect(unavailable.status).toBe(503);
    expect(await json(unavailable)).toMatchObject({ success: false });
  });

  it('POST leaf：messageId 切换成功/失败', async () => {
    const base = await startHost(sessionCtx());
    const ok = await fetch(`${base}/api/agent/sessions/known/leaf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageId: 9 }),
    });
    expect(await json(ok)).toMatchObject({
      success: true,
      message: '已切换 active leaf 至消息 #9',
      data: { sessionKey: 'known', sessionId: 'sid-1', activeLeafMessageId: 7 },
    });

    const fail = await fetch(`${base}/api/agent/sessions/known/leaf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageId: 1 }),
    });
    expect(fail.status).toBe(400);
    expect(await json(fail)).toMatchObject({ success: false, message: '切换失败' });
  });

  it('POST leaf：尚未产生 Agent 对话时仍拒绝切换', async () => {
    const base = await startHost(sessionCtx());
    const response = await fetch(`${base}/api/agent/sessions/ghost/leaf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageId: 9 }),
    });
    expect(response.status).toBe(404);
    expect(await json(response)).toMatchObject({
      success: false,
      error: '未找到活跃会话：ghost',
    });
  });

  it('POST leaf：index 跳转与参数校验', async () => {
    const base = await startHost(sessionCtx());
    const ok = await fetch(`${base}/api/agent/sessions/known/leaf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ index: 2 }),
    });
    expect(await json(ok)).toMatchObject({ success: true, message: '已跳转' });

    const outOfRange = await fetch(`${base}/api/agent/sessions/known/leaf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ index: 5 }),
    });
    expect(outOfRange.status).toBe(400);

    const empty = await fetch(`${base}/api/agent/sessions/known/leaf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(400);
    expect(await json(empty)).toMatchObject({
      success: false,
      error: '需要 messageId 或 index 之一',
    });

    const negative = await fetch(`${base}/api/agent/sessions/known/leaf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageId: -1 }),
    });
    expect(negative.status).toBe(400);
    expect(await json(negative)).toMatchObject({
      success: false,
      error: 'messageId 须为正整数',
    });
  });

  it('demo ctx POST leaf → 403', async () => {
    const base = await startHost(sessionCtx({ fullScope: false }));
    const response = await fetch(`${base}/api/agent/sessions/known/leaf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageId: 9 }),
    });
    expect(response.status).toBe(403);
  });
});
