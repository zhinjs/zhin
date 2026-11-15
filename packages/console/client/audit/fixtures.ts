/**
 * Fixture data for rendering plugin pages without a Host (ADR 0063 P2 layout audit).
 *
 * Strategy: no network. `installFixtureHost()` replaces `window.fetch` and answers
 * - `/console/api/pages` with one page owned by `root/<adapter>` (so `resolvePluginId` resolves),
 * - `POST /api/console/request`: `plugin.<id>.status` with the page's fixture status, `endpoint.list`
 *   / `login.list` with one online account and no login task, every other RPC with `{}`.
 * The status of a declarative blueprint is derived from the blueprint itself: every `dataKey` and
 * value-expression path it reads gets a sample value, tables get three rows built from their
 * column types. Adapter pages and comment review pages get fixed samples with one account.
 */

type Json = Record<string, unknown>;

const NOW = Date.UTC(2026, 10, 15, 9, 30, 0);

function setPath(target: Json, path: string, value: unknown): void {
  const segments = path.split('.').filter(Boolean);
  let cursor: Json = target;
  segments.forEach((segment, index) => {
    if (segment === 'length') return;
    if (index === segments.length - 1) {
      if (cursor[segment] === undefined) cursor[segment] = value;
      return;
    }
    if (!cursor[segment] || typeof cursor[segment] !== 'object') cursor[segment] = {};
    cursor = cursor[segment] as Json;
  });
}

function sampleScalar(key: string): unknown {
  const last = key.split('.').pop() ?? key;
  if (/(count|total|num|size|pct|percent|ms|seconds|amount|rss|mb)$/iu.test(last)) return 3;
  if (/^(enabled|healthy|ok|ready|online|running)$/iu.test(last)) return true;
  if (/(at|time|date)$/iu.test(last)) return NOW;
  if (/(url|link|href)$/iu.test(last)) return 'https://example.com/feed.xml';
  if (/i18n$/iu.test(last)) return { 'zh-CN': '示例', en: 'Sample' };
  return '示例';
}

function sampleCell(column: Json, row: number): unknown {
  const key = String(column.key ?? '');
  switch (column.type) {
    case 'datetime': return NOW - row * 3_600_000;
    case 'number':
    case 'progress': return 20 + row * 25;
    case 'boolean': return row !== 1;
    case 'link': return `https://example.com/item/${row + 1}`;
    case 'tags': return ['示例', `标签 ${row + 1}`];
    case 'badge': return ['running', 'failed', 'stopped'][row % 3];
    case 'json': return { id: row + 1, note: '示例' };
    case 'conversation': return '';
    case 'code': return `id-${row + 1}`;
    default: return /status|state/iu.test(key) ? ['running', 'failed', 'stopped'][row % 3] : `示例 ${row + 1}`;
  }
}

function sampleRows(columns: readonly Json[]): Json[] {
  return [0, 1, 2].map(row => {
    const out: Json = { id: `row-${row + 1}` };
    for (const column of columns) if (typeof column.key === 'string') setPath(out, column.key, sampleCell(column, row));
    return out;
  });
}

const EXPR_PATH_KEYS = ['$path', '$count', '$i18n'] as const;

/** Collects the paths a blueprint reads, and the tables (path → columns) it shows. */
function collect(node: unknown, paths: Set<string>, tables: Map<string, Json[]>): void {
  // Blueprint pages are functions carrying the blueprint as own properties (`definePageBlueprint`).
  if (!node || (typeof node !== 'object' && typeof node !== 'function')) return;
  if (Array.isArray(node)) { for (const item of node) collect(item, paths, tables); return; }
  const record = node as Json;
  const columns = Array.isArray(record.columns) ? (record.columns as Json[]) : undefined;
  const listKey = typeof record.dataKey === 'string' ? record.dataKey : typeof record.items === 'string' ? record.items : undefined;
  if (columns && listKey) tables.set(listKey, columns);
  else if (typeof record.dataKey === 'string') paths.add(record.dataKey);
  // Stat specs read `value: '<path>'` (a data path, not a literal).
  else if (typeof record.key === 'string' && typeof record.value === 'string' && 'label' in record) paths.add(record.value);
  for (const key of EXPR_PATH_KEYS) {
    // `$count` reads a list (or object): ask for one through the `.length` marker.
    if (typeof record[key] === 'string') paths.add(key === '$count' ? `${record[key] as string}.length` : record[key] as string);
  }
  if (Array.isArray(record.$coalesce)) for (const path of record.$coalesce) if (typeof path === 'string') paths.add(path);
  for (const key of ['$sum', '$map', '$join'] as const) {
    const inner = record[key] as Json | undefined;
    if (inner && typeof inner.path === 'string') paths.add(inner.path);
  }
  for (const [key, value] of Object.entries(record)) if (key !== 'columns') collect(value, paths, tables);
}

/** Sample `status` for a declarative blueprint (or the spec inside it). */
export function blueprintFixture(blueprint: unknown): Json {
  const paths = new Set<string>();
  const tables = new Map<string, Json[]>();
  collect(blueprint, paths, tables);
  const status: Json = {};
  for (const [path, columns] of tables) setPath(status, path, sampleRows(columns));
  for (const path of paths) {
    if (tables.has(path)) continue;
    // `$count` / `.length` read lists; give them a short list.
    setPath(status, path.replace(/\.length$/u, ''), path.endsWith('.length') ? ['a', 'b', 'c'] : sampleScalar(path));
  }
  return status;
}

export function adapterFixture(adapterKey: string): { readonly status: Json; readonly endpoints: Json[] } {
  return {
    status: {
      adapterKey,
      displayName: adapterKey,
      page: '/',
      fields: [
        { key: 'token', required: true, env: false, secret: true },
        { key: 'mode', required: false, env: false, secret: false },
      ],
      canAdd: true,
      canRemove: true,
      configStore: true,
      running: [],
      actions: [],
      configured: [{ id: 'bot-1', instanceId: 'instance-1', values: { token: '••••••', mode: 'polling' } }],
      runtime: {
        adapterId: adapterKey, generation: 1, revision: 1, needsMigration: false, canManage: true, canMigrate: false,
        canUpdate: true, canReplace: true, mutableFields: ['token', 'mode'], identityFields: ['id'],
        endpoints: [{ instanceId: 'instance-1', canonicalId: 'canonical-1', endpointId: 'bot-1', revision: 1, desiredEnabled: true, epoch: 1, started: true, admitted: true }],
      },
    },
    endpoints: [{ id: 'canonical-1', endpoint: { id: 'canonical-1', adapter: adapterKey }, name: 'bot-1', adapter: adapterKey, connected: true, status: 'online', transportState: 'open' }],
  };
}

export function reviewFixture(): Json {
  return {
    updatedAt: NOW,
    endpoints: [{
      id: 'main', sendMode: 'review', persistent: true, circuit: null,
      login: { state: 'ok', source: 'qr', mid: '10001', uname: '示例账号', userId: '10001', userName: '示例账号' },
      pendingCount: 1,
      drafts: [{
        id: 'draft-1', url: 'https://example.com/comment/1', message: '感谢支持，下期见！', status: 'pending', interrupted: false,
        createdAt: NOW - 120_000, author: '小明', original: '写得很清楚。', video: 'BV1xx411c7mD', articleId: '7300000000000000001',
      }],
      qr: { state: 'idle' },
      videos: [{ ref: 'BV1xx411c7mD', url: 'https://example.com/video/1' }],
      articles: [{ ref: '7300000000000000001', url: 'https://example.com/article/1' }],
    }],
  };
}

export interface FixtureHost {
  /** Status answered for `plugin.<id>.status`. */
  readonly status: Json;
  /** Adapter key the page belongs to (`resolvePluginId({ adapter })`). */
  readonly adapter?: string;
  readonly endpoints?: Json[];
}

/** Replaces `window.fetch` and the stored Host credentials with the fixture Host. */
export function installFixtureHost(host: FixtureHost): void {
  const owner = `root/${host.adapter ?? 'audit-fixture'}`;
  try {
    localStorage.setItem('zhin_api_base', location.origin);
    localStorage.setItem('zhin_api_token', 'audit-fixture');
  } catch {
    // storage unavailable: requests still go to the stub below
  }
  const reply = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/console/api/pages')) {
      return Response.json({ pages: [{ owner, localName: 'index', source: `adapters/${host.adapter ?? 'audit-fixture'}/pages/index/index.ts`, route: location.pathname }] });
    }
    if (url.includes('/api/console/request')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { type?: string };
      const type = String(body.type ?? '');
      if (type.startsWith('plugin.') && type.endsWith('.status')) return reply(host.status);
      if (type === 'endpoint.list') return reply({ endpoints: host.endpoints ?? [] });
      if (type === 'login.list') return reply({ tasks: [] });
      if (type === 'inbox.recent') return reply({ messages: [] });
      return reply({});
    }
    // Any other endpoint (agent traces, Sandbox history, external metadata) does not exist here: answer
    // like an unavailable feature, so pages show their empty / unavailable state instead of fake data.
    return Response.json({ success: false, error: 'not available in the audit fixture' }, { status: 404 });
  }) as typeof fetch;
}
