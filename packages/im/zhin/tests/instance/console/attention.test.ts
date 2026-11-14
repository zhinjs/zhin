import { describe, expect, it } from 'vitest';
import { attentionItemId, grantsAllow, type ConsoleGrant, type ConsoleScopeTarget } from '@zhin.js/console-protocol';
import {
  ATTENTION_PATHS,
  AttentionObservations,
  AttentionSourceCache,
  collectAttention,
  describeConfigProblem,
  dispatchAttentionConsoleRpc,
  type AttentionPluginState,
  type AttentionSources,
} from '../../../src/instance/console/attention.js';

const NOW = Date.parse('2026-11-13T08:00:00.000Z');
const owner = () => true;
const allowsFor = (grants: ConsoleGrant[]) => (permission: string, target?: ConsoleScopeTarget) => grantsAllow(grants, permission, target);

function plugin(overrides: Partial<AttentionPluginState> & { instanceKey: string }): AttentionPluginState {
  return { status: 'enabled', dependencies: 'passed', disabled: false, issues: [], validation: { valid: true, errors: [], missingEnv: [] }, ...overrides };
}

function everySource(): AttentionSources {
  return {
    loginTasks: () => [{ id: 'login-1', adapter: 'icqq', endpointKey: '10001', type: 'qrcode', createdAt: NOW - 60_000 }],
    endpoints: () => [
      { adapter: 'icqq', name: '10001', connected: false, phase: 'offline', transportState: 'closed' },
      { adapter: 'qq', name: 'bot', connected: false, phase: 'offline', transportState: 'closed' },
      { adapter: 'qq', name: 'stopped', connected: false, phase: 'offline', transportState: 'stopped' },
      { adapter: 'qq', name: 'retrying', connected: false, phase: 'reconnecting', transportState: 'reconnecting' },
      { adapter: 'qq', name: 'online', connected: true, phase: 'online', transportState: 'open' },
    ],
    plugins: async () => ({
      dependencies: { status: 'failed', error: 'Missing service: database' },
      states: [
        { status: 'fulfilled', value: plugin({ instanceKey: 'weather', status: 'degraded', issues: ['Declared plugin package is not installed'] }) },
        { status: 'fulfilled', value: plugin({ instanceKey: 'music', dependencies: 'unchecked' }) },
        { status: 'fulfilled', value: plugin({ instanceKey: 'news', status: 'missing-config', validation: { valid: false, errors: [{ path: 'apiKey', message: 'required' }], missingEnv: ['NEWS_KEY'] } }) },
        { status: 'fulfilled', value: plugin({ instanceKey: 'off', status: 'degraded', disabled: true, issues: ['x'] }) },
        { status: 'fulfilled', value: plugin({ instanceKey: 'fine' }) },
      ],
    }),
    configuration: {
      source: async () => ({ applicationError: 'unconfirmed' }),
      literalSecrets: async () => [{ path: ['http', 'token'] }, { path: ['qq', 'endpoints', '0', 'secret'] }],
    },
    toolApprovals: () => [{ id: 'appr-1', toolName: 'group_kick', sessionKey: 'icqq:1:group:2', createdAt: NOW - 5_000 }],
    mcpServers: () => [{ name: 'search', connected: false }, { name: 'files', connected: true }],
    errorLogs: async () => ({ count: 7, latest: '2026-11-13T07:00:00.000Z' }),
  };
}

describe('attention.list sources', () => {
  it('maps every source to items with deep links, and sorts by severity then age', async () => {
    const list = await collectAttention(everySource(), { allows: owner, now: () => NOW });
    expect(list.generatedAt).toBe(new Date(NOW).toISOString());
    expect(list.unavailable).toBeUndefined();
    const byKind = (kind: string) => list.items.filter(item => item.kind === kind);

    const [login] = byKind('login.pending');
    expect(login).toMatchObject({ severity: 'danger', source: 'login-assist', subject: { adapter: 'icqq', endpointKey: '10001', loginTaskId: 'login-1' },
      since: new Date(NOW - 60_000).toISOString(), action: { path: '/scope/icqq/10001?tab=access' } });
    expect(login!.title).toBe('icqq / 10001 等待登录');
    expect(login!.detail).toContain('扫码');

    // The account waiting for a login step is not reported offline twice; stopped / reconnecting ones are not offline problems.
    expect(byKind('endpoint.offline').map(item => item.subject?.endpointKey)).toEqual(['bot']);
    expect(byKind('endpoint.offline')[0]!.action.path).toBe(ATTENTION_PATHS.endpointAccess('qq', 'bot'));

    expect(byKind('plugin.error').map(item => item.subject?.plugin)).toEqual(['weather']);
    expect(byKind('plugin.error')[0]).toMatchObject({ severity: 'danger', detail: 'Declared plugin package is not installed', action: { path: '/plugins/weather' } });
    // The project-wide dependency check is one item, linked to the plugin list.
    expect(byKind('plugin.dependencies')).toHaveLength(1);
    expect(byKind('plugin.dependencies')[0]).toMatchObject({ id: 'plugin.dependencies', severity: 'danger', detail: 'Missing service: database', action: { path: '/plugins' } });
    expect(byKind('plugin.dependencies')[0]!.subject).toBeUndefined();
    expect(byKind('plugin.config')[0]).toMatchObject({ severity: 'warning', subject: { plugin: 'news' } });
    expect(byKind('plugin.config')[0]!.detail).toBe('apiKey: required; 未设置的环境变量：NEWS_KEY');

    expect(byKind('config.apply-failed')[0]).toMatchObject({ severity: 'warning', action: { path: '/ops/config' } });
    expect(byKind('config.literal-secrets')[0]!.title).toBe('配置文件中有 2 个明文密钥');
    expect(byKind('config.literal-secrets')[0]!.detail).toContain('http.token、qq.endpoints[0].secret');

    expect(byKind('tool-approval.pending')[0]).toMatchObject({ severity: 'warning', subject: { approvalId: 'appr-1' }, action: { path: '/ops/schedules?tab=admin' } });
    expect(byKind('mcp.disconnected').map(item => item.subject?.mcpServer)).toEqual(['search']);
    expect(byKind('logs.errors')[0]).toMatchObject({ severity: 'info', since: '2026-11-13T07:00:00.000Z', action: { path: '/logs?level=error' } });
    expect(byKind('logs.errors')[0]!.title).toBe('最近 24 小时日志里有 7 条错误');

    const severities = list.items.map(item => item.severity);
    expect(severities).toEqual([...severities].sort((a, b) => ['danger', 'warning', 'info'].indexOf(a) - ['danger', 'warning', 'info'].indexOf(b)));
    expect(list.items[0]!.kind).toBe('login.pending'); // oldest danger first
  });

  it('reports an unreadable configuration file as config.invalid: project-relative file, position and kind only', async () => {
    // The YAML parser's message carries an excerpt of the offending line (here a secret) and the absolute path.
    const parseError = Object.assign(new Error('Cannot parse YAML config /srv/bot/zhin.config.yml:\n- Nested mappings are not allowed at line 3, column 9:\n\n  token: sk-live-SECRET\n        ^\n'), {
      name: 'ConfigDocumentParseError', file: '/srv/bot/zhin.config.yml', format: 'YAML',
      issues: ['Nested mappings are not allowed at line 3, column 9:\n\n  token: sk-live-SECRET\n        ^\n'],
    });
    const list = await collectAttention({ configuration: { projectRoot: '/srv/bot', source: async () => { throw parseError; } } }, { allows: owner, now: () => NOW });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ kind: 'config.invalid', severity: 'danger', detail: 'zhin.config.yml（第 3 行，第 9 列）：YAML 语法错误。修正文件后重新读取。' });
    expect(JSON.stringify(list.items[0])).not.toMatch(/SECRET|\/srv\/bot/u);

    const en = await collectAttention({ configuration: { projectRoot: '/srv/bot', source: async () => { throw parseError; } } }, { allows: owner, locale: 'en' });
    expect(en.items[0]!.detail).toBe('zhin.config.yml (line 3, column 9): YAML syntax error. Fix the file and reload.');
  });

  it('describes configuration problems without parser text or absolute paths', () => {
    const json = Object.assign(new Error('x'), { name: 'ConfigDocumentParseError', file: '/srv/bot/conf/zhin.config.json', format: 'JSON',
      issues: ['Expected \',\' or \'}\' after property value in JSON at position 15 (line 1 column 16)'] });
    expect(describeConfigProblem(json, '/srv/bot')).toEqual({ file: 'conf/zhin.config.json', kind: 'syntax', format: 'JSON', line: 1, column: 16 });
    expect(describeConfigProblem(Object.assign(new Error('x'), { name: 'ConfigDocumentParseError', file: '/elsewhere/a.yml', format: 'YAML',
      issues: ['The document root must be an object'] }), '/srv/bot')).toEqual({ file: 'a.yml', kind: 'root', format: 'YAML' });
    expect(describeConfigProblem(Object.assign(new Error("EACCES: permission denied, open '/srv/bot/zhin.config.yml'"), { code: 'EACCES', path: '/srv/bot/zhin.config.yml' }), '/srv/bot'))
      .toEqual({ file: 'zhin.config.yml', kind: 'io', code: 'EACCES' });
    expect(describeConfigProblem(new Error('token sk-live-SECRET is weird'))).toEqual({ file: null, kind: 'other' });
  });

  it('reports failed / blocked application groups, but not superseded changes', async () => {
    const group = (status: string) => ({ application: { operationId: 'op', groups: [{ status }] } }) as never;
    const kinds = async (source: unknown) => (await collectAttention({ configuration: { source: async () => source as never } }, { allows: owner })).items.map(item => item.kind);
    expect(await kinds(group('failed'))).toEqual(['config.apply-failed']);
    expect(await kinds(group('blocked'))).toEqual(['config.apply-failed']);
    expect(await kinds(group('applied'))).toEqual([]);
    expect(await kinds({ applicationError: 'superseded' })).toEqual([]);
  });

  it('localizes Host text for locale=en, keeping dynamic text verbatim', async () => {
    const list = await collectAttention(everySource(), { allows: owner, locale: 'en', now: () => NOW });
    const find = (kind: string) => list.items.find(item => item.kind === kind)!;
    expect(find('login.pending').title).toBe('icqq / 10001 is waiting to sign in');
    expect(find('login.pending').action.label).toBe('Open sign-in');
    expect(find('plugin.error').detail).toBe('Declared plugin package is not installed');
    expect(find('config.literal-secrets').title).toBe('Secrets stored as plain text in the configuration: 2');
    expect(find('plugin.config').detail).toBe('apiKey: required; Unset environment variables: NEWS_KEY');
  });

  it('marks failing sources unavailable instead of reporting them as clear', async () => {
    const list = await collectAttention({
      errorLogs: async () => null,
      mcpServers: () => { throw new Error('no snapshot'); },
      toolApprovals: everySource().toolApprovals,
    }, { allows: owner });
    expect(list.unavailable).toEqual(['mcp', 'logs']);
    expect(list.items.map(item => item.kind)).toEqual(['tool-approval.pending']);
  });

  it('keeps a source all or nothing: a read failing midway contributes no items and no observations', async () => {
    const observations = new AttentionObservations();
    let clock = NOW;
    let failPlugins = false;
    let failConfig = false;
    const sources: AttentionSources = {
      plugins: async () => ({
        dependencies: { status: 'failed', error: 'graph' },
        states: [
          { status: 'fulfilled', value: plugin({ instanceKey: 'weather', status: 'degraded', issues: ['broken'] }) },
          ...(failPlugins ? [{ status: 'rejected' as const, reason: new Error('boom') }] : []),
        ],
      }),
      configuration: {
        source: async () => ({ applicationError: 'failed' }),
        // The source half succeeds, then the secret scan throws.
        literalSecrets: async () => { if (failConfig) throw new Error('schema'); return []; },
      },
    };
    const read = () => collectAttention(sources, { allows: owner, observations, now: () => clock });
    const first = await read();
    expect(new Set(first.items.map(item => item.kind))).toEqual(new Set(['plugin.dependencies', 'plugin.error', 'config.apply-failed']));
    expect(observations.size).toBe(3);

    failPlugins = true;
    failConfig = true;
    clock += 60_000;
    const partial = await read();
    expect(partial.unavailable).toEqual(['plugins', 'config']);
    // Neither the plugin items read before the rejected entry nor the configuration source's own item leak out.
    expect(partial.items).toEqual([]);
    // Unavailable reads leave observations untouched: the problems keep their first-seen time.
    expect(observations.size).toBe(3);
    failPlugins = false;
    failConfig = false;
    clock += 60_000;
    const again = await read();
    expect(again.items.map(item => item.since)).toEqual(first.items.map(item => item.since));

    // A new problem first seen in a failed read is not recorded either.
    const fresh = new AttentionObservations();
    await collectAttention({ mcpServers: () => [{ name: 'a', connected: false }, { get name(): string { throw new Error('bad row'); }, connected: false }] },
      { allows: owner, observations: fresh });
    expect(fresh.size).toBe(0);
  });
});

describe('attention.list permission filtering', () => {
  it('shows a viewer with no endpoint / config / approval permission only status items', async () => {
    const viewer: ConsoleGrant[] = [{ scope: { kind: 'global' }, permissions: ['status.view'] }];
    const sources = everySource();
    let loginRead = false;
    let configRead = false;
    const list = await collectAttention({
      ...sources,
      loginTasks: () => { loginRead = true; return sources.loginTasks!(); },
      configuration: { source: async () => { configRead = true; return {}; } },
    }, { allows: allowsFor(viewer) });
    expect(new Set(list.items.map(item => item.kind))).toEqual(new Set(['mcp.disconnected', 'logs.errors']));
    // Sources the caller cannot view are not even read.
    expect(loginRead).toBe(false);
    expect(configRead).toBe(false);
  });

  it('lists only the accounts an endpoint-scoped binding covers', async () => {
    const scoped: ConsoleGrant[] = [
      { scope: { kind: 'global' }, permissions: ['status.view'] },
      { scope: { kind: 'endpoint', key: 'qq/bot' }, permissions: ['endpoint.view'] },
    ];
    const list = await collectAttention(everySource(), { allows: allowsFor(scoped) });
    const accounts = list.items.filter(item => item.subject?.adapter).map(item => `${item.kind}:${item.subject!.adapter}/${item.subject!.endpointKey}`);
    expect(accounts).toEqual(['endpoint.offline:qq/bot']);
  });

  it('needs feature.view for plugins, ops.config.read for configuration and an approval permission for approvals', async () => {
    const grants: ConsoleGrant[] = [{ scope: { kind: 'global' }, permissions: ['status.view', 'feature.view', 'ops.config.read', 'tool_approvals:read'] }];
    const kinds = new Set((await collectAttention(everySource(), { allows: allowsFor(grants) })).items.map(item => item.kind));
    expect(kinds).toEqual(new Set(['plugin.error', 'plugin.dependencies', 'plugin.config', 'config.apply-failed', 'config.literal-secrets',
      'tool-approval.pending', 'mcp.disconnected', 'logs.errors']));
    const approver = (permission: string) => permission === 'ops:approve';
    const viaPluginLevels = await collectAttention({ toolApprovals: everySource().toolApprovals }, { allows: () => false, allowsPluginPermission: approver });
    expect(viaPluginLevels.items.map(item => item.kind)).toEqual(['tool-approval.pending']);
    const none = await collectAttention({ toolApprovals: everySource().toolApprovals }, { allows: () => false, allowsPluginPermission: () => false });
    expect(none.items).toEqual([]);
  });
});

describe('attention.list identity', () => {
  it('keeps ids stable across reads; revision follows the state; since is the first observation', async () => {
    const observations = new AttentionObservations();
    let clock = NOW;
    let issues = ['first'];
    let offline = true;
    const sources: AttentionSources = {
      endpoints: () => offline ? [{ adapter: 'qq', name: 'bot', connected: false, phase: 'offline', transportState: 'closed' }] : [],
      plugins: async () => ({ states: [{ status: 'fulfilled', value: plugin({ instanceKey: 'weather', status: 'degraded', issues }) }] }),
    };
    const read = () => collectAttention(sources, { allows: owner, observations, now: () => clock });
    const first = await read();
    clock += 60_000;
    issues = ['second'];
    const second = await read();
    const pick = (list: typeof first, kind: string) => list.items.find(item => item.kind === kind)!;
    expect(pick(second, 'plugin.error').id).toBe(pick(first, 'plugin.error').id);
    expect(pick(second, 'plugin.error').id).toBe(attentionItemId('plugin.error', { plugin: 'weather' }));
    expect(pick(second, 'plugin.error').id).toBe('plugin.error:plugin=weather');
    expect(pick(second, 'plugin.error').revision).not.toBe(pick(first, 'plugin.error').revision);
    expect(pick(second, 'endpoint.offline').revision).toBe(pick(first, 'endpoint.offline').revision);
    expect(pick(second, 'endpoint.offline').since).toBe(new Date(NOW).toISOString());

    // Gone, then back: a new episode starts at the new observation.
    offline = false;
    clock += 60_000;
    expect((await read()).items.some(item => item.kind === 'endpoint.offline')).toBe(false);
    offline = true;
    clock += 60_000;
    expect(pick(await read(), 'endpoint.offline').since).toBe(new Date(clock).toISOString());
  });

  it('does not forget an observation because a narrower viewer could not see it', async () => {
    const observations = new AttentionObservations();
    let clock = NOW;
    const sources: AttentionSources = { endpoints: () => [{ adapter: 'qq', name: 'bot', connected: false, phase: 'offline', transportState: 'closed' }] };
    await collectAttention(sources, { allows: owner, observations, now: () => clock });
    clock += 60_000;
    const other: ConsoleGrant[] = [{ scope: { kind: 'endpoint', key: 'qq/other' }, permissions: ['endpoint.view'] }];
    expect((await collectAttention(sources, { allows: allowsFor(other), observations, now: () => clock })).items).toEqual([]);
    clock += 60_000;
    const again = await collectAttention(sources, { allows: owner, observations, now: () => clock });
    expect(again.items[0]!.since).toBe(new Date(NOW).toISOString());
  });
});

describe('dispatchAttentionConsoleRpc', () => {
  it('answers attention.list with the locale from data and ignores other types', async () => {
    expect(await dispatchAttentionConsoleRpc({ type: 'endpoint.list' }, { sources: {}, allows: owner })).toBeNull();
    const reply = await dispatchAttentionConsoleRpc(
      { type: 'attention.list', requestId: 7, data: { locale: 'en' } },
      { sources: { mcpServers: () => [{ name: 'search', connected: false }] }, allows: owner, now: () => NOW },
    );
    expect(reply?.status).toBe(200);
    expect(reply?.body).toMatchObject({ success: true, type: 'attention.list', requestId: 7,
      data: { generatedAt: new Date(NOW).toISOString(), items: [{ kind: 'mcp.disconnected', title: 'MCP server search is not connected' }] } });
  });
});

describe('attention.list account identity', () => {
  // `endpoint.list` row: adapter alias `qq-work` ≠ adapter type `qq`, account name `bot` ≠ canonical id.
  const row = { id: 'root/qq-work\u0000zhin.adapter\u0000main', adapter: 'qq-work', name: 'bot', connected: false, phase: 'offline', transportState: 'closed' };
  const scoped = (key: string): ConsoleGrant[] => [
    { scope: { kind: 'global' }, permissions: ['status.view'] },
    { scope: { kind: 'endpoint', key }, permissions: ['endpoint.view'] },
  ];

  it('authorizes, links and identifies an account by the row adapter + name the Console binds and routes with', async () => {
    const list = await collectAttention({ endpoints: () => [row] }, { allows: allowsFor(scoped('qq-work/bot')) });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ kind: 'endpoint.offline', subject: { adapter: 'qq-work', endpointKey: 'bot' },
      action: { path: '/scope/qq-work/bot?tab=access' }, title: 'qq-work / bot 离线' });
    // Neither the adapter type nor the canonical id is an account address.
    expect((await collectAttention({ endpoints: () => [row] }, { allows: allowsFor(scoped('qq/bot')) })).items).toEqual([]);
    expect((await collectAttention({ endpoints: () => [row] }, { allows: allowsFor(scoped(`qq-work/${row.id}`)) })).items).toEqual([]);
  });

  it('maps a login task to its account row (canonical id, or adapter + id) and does not also report it offline', async () => {
    for (const task of [
      { id: 't1', adapter: 'qq', endpointKey: 'main', canonicalId: row.id, type: 'qrcode', createdAt: NOW },
      { id: 't2', adapter: 'qq-work', endpointKey: row.id, type: 'qrcode', createdAt: NOW },
    ]) {
      const list = await collectAttention({ loginTasks: () => [task], endpoints: () => [row] }, { allows: allowsFor(scoped('qq-work/bot')) });
      expect(list.items.map(item => item.kind)).toEqual(['login.pending']);
      expect(list.items[0]).toMatchObject({ subject: { adapter: 'qq-work', endpointKey: 'bot', loginTaskId: task.id }, action: { path: '/scope/qq-work/bot?tab=access' } });
    }
    // An account whose row says a login flow waits is not offline either (even without a pending task).
    expect((await collectAttention({ endpoints: () => [{ ...row, pendingLogin: true }] }, { allows: owner })).items).toEqual([]);
  });
});

describe('attention.list shared reads', () => {
  function counting() {
    const calls = { plugins: 0, config: 0, secrets: 0, mcp: 0, logs: 0, endpoints: 0, login: 0 };
    const sources: AttentionSources = {
      loginTasks: () => { calls.login += 1; return []; },
      endpoints: () => { calls.endpoints += 1; return [{ adapter: 'qq', name: 'bot', connected: false, phase: 'offline', transportState: 'closed' }]; },
      plugins: async () => { calls.plugins += 1; await new Promise(resolve => setTimeout(resolve, 5)); return { states: [{ status: 'fulfilled', value: plugin({ instanceKey: 'weather', status: 'degraded', issues: ['x'] }) }] }; },
      configuration: {
        source: async () => { calls.config += 1; return { applicationError: 'failed' }; },
        literalSecrets: async () => { calls.secrets += 1; return [{ path: ['http', 'token'] }]; },
      },
      mcpServers: () => { calls.mcp += 1; return [{ name: 'search', connected: false }]; },
      errorLogs: async () => { calls.logs += 1; return { count: 1, latest: null }; },
    };
    return { calls, sources };
  }

  it('coalesces concurrent requests into one read and serves later ones from the cache within the TTL', async () => {
    let clock = NOW;
    let revision = 'r1';
    const cache = new AttentionSourceCache({ ttlMs: 15_000, now: () => clock, revision: () => revision });
    const { calls, sources } = counting();
    const options = { allows: owner, cache, now: () => clock };
    const [a, b] = await Promise.all([collectAttention(sources, options), collectAttention(sources, options)]);
    expect(a.items).toEqual(b.items);
    expect(calls).toMatchObject({ plugins: 1, config: 1, secrets: 1, mcp: 1, logs: 1 });
    // Accounts and login tasks stay live.
    expect(calls).toMatchObject({ endpoints: 2, login: 2 });

    clock += 10_000;
    await collectAttention(sources, options);
    expect(calls).toMatchObject({ plugins: 1, config: 1, mcp: 1, logs: 1, endpoints: 3 });

    clock += 6_000; // past the TTL
    await collectAttention(sources, options);
    expect(calls).toMatchObject({ plugins: 2, config: 2, mcp: 2, logs: 2 });

    revision = 'r2'; // the project files or the generation changed
    await collectAttention(sources, options);
    expect(calls).toMatchObject({ plugins: 3, config: 3 });
  });

  it('filters the shared read per caller and never caches a failed read', async () => {
    const cache = new AttentionSourceCache({ now: () => NOW });
    const { calls, sources } = counting();
    const ownerList = await collectAttention(sources, { allows: owner, cache });
    const viewer: ConsoleGrant[] = [{ scope: { kind: 'global' }, permissions: ['status.view'] }];
    const viewerList = await collectAttention(sources, { allows: allowsFor(viewer), cache });
    expect(new Set(ownerList.items.map(item => item.kind))).toEqual(new Set(['plugin.error', 'config.apply-failed', 'config.literal-secrets', 'endpoint.offline', 'mcp.disconnected', 'logs.errors']));
    expect(new Set(viewerList.items.map(item => item.kind))).toEqual(new Set(['mcp.disconnected', 'logs.errors']));
    // A third caller with configuration access is served the owner's cached configuration read.
    const configReader: ConsoleGrant[] = [{ scope: { kind: 'global' }, permissions: ['status.view', 'ops.config.read'] }];
    const configList = await collectAttention(sources, { allows: allowsFor(configReader), cache });
    expect(configList.items.map(item => item.kind)).toContain('config.literal-secrets');
    expect(calls).toMatchObject({ plugins: 1, config: 1, mcp: 1, logs: 1 });

    let fail = true;
    const flaky: AttentionSources = { mcpServers: () => { if (fail) throw new Error('down'); return []; } };
    const flakyCache = new AttentionSourceCache({ now: () => NOW });
    expect((await collectAttention(flaky, { allows: owner, cache: flakyCache })).unavailable).toEqual(['mcp']);
    fail = false;
    expect((await collectAttention(flaky, { allows: owner, cache: flakyCache })).unavailable).toBeUndefined();
  });
});
