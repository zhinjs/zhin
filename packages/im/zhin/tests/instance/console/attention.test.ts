import { describe, expect, it } from 'vitest';
import { attentionItemId, grantsAllow, type ConsoleGrant, type ConsoleScopeTarget } from '@zhin.js/console-protocol';
import {
  ATTENTION_PATHS,
  AttentionObservations,
  collectAttention,
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
    plugins: async () => [
      { status: 'fulfilled', value: plugin({ instanceKey: 'weather', status: 'degraded', issues: ['Declared plugin package is not installed'] }) },
      { status: 'fulfilled', value: plugin({ instanceKey: 'music', status: 'degraded', dependencies: 'failed', issues: ['Missing service: database'] }) },
      { status: 'fulfilled', value: plugin({ instanceKey: 'news', status: 'missing-config', validation: { valid: false, errors: [{ path: 'apiKey', message: 'required' }], missingEnv: ['NEWS_KEY'] } }) },
      { status: 'fulfilled', value: plugin({ instanceKey: 'off', status: 'degraded', disabled: true, issues: ['x'] }) },
      { status: 'fulfilled', value: plugin({ instanceKey: 'fine' }) },
    ],
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
    expect(byKind('plugin.dependencies').map(item => item.subject?.plugin)).toEqual(['music']);
    expect(byKind('plugin.config')[0]).toMatchObject({ severity: 'warning', subject: { plugin: 'news' } });
    expect(byKind('plugin.config')[0]!.detail).toBe('apiKey: required; 未设置的环境变量：NEWS_KEY');

    expect(byKind('config.apply-failed')[0]).toMatchObject({ severity: 'warning', action: { path: '/ops/config' } });
    expect(byKind('config.literal-secrets')[0]!.title).toBe('配置文件中有 2 个明文密钥');
    expect(byKind('config.literal-secrets')[0]!.detail).toContain('http.token、qq.endpoints[0].secret');

    expect(byKind('tool-approval.pending')[0]).toMatchObject({ severity: 'warning', subject: { approvalId: 'appr-1' }, action: { path: '/ops/schedules?tab=admin' } });
    expect(byKind('mcp.disconnected').map(item => item.subject?.mcpServer)).toEqual(['search']);
    expect(byKind('logs.errors')[0]).toMatchObject({ severity: 'info', since: '2026-11-13T07:00:00.000Z', action: { path: '/logs?level=error' } });
    expect(byKind('logs.errors')[0]!.title).toBe('日志里有 7 条错误');

    const severities = list.items.map(item => item.severity);
    expect(severities).toEqual([...severities].sort((a, b) => ['danger', 'warning', 'info'].indexOf(a) - ['danger', 'warning', 'info'].indexOf(b)));
    expect(list.items[0]!.kind).toBe('login.pending'); // oldest danger first
  });

  it('reports an unreadable configuration file as config.invalid with the parser message', async () => {
    const list = await collectAttention({ configuration: { source: async () => { throw new Error('YAML: bad indentation at line 3'); } } }, { allows: owner, now: () => NOW });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ kind: 'config.invalid', severity: 'danger', detail: 'YAML: bad indentation at line 3' });
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
      plugins: async () => [{ status: 'rejected', reason: new Error('boom') }, { status: 'fulfilled', value: plugin({ instanceKey: 'weather', status: 'degraded', issues: ['broken'] }) }],
      errorLogs: async () => null,
      mcpServers: () => { throw new Error('no snapshot'); },
    }, { allows: owner });
    expect(list.unavailable).toEqual(['plugins', 'mcp', 'logs']);
    expect(list.items.map(item => item.kind)).toEqual(['plugin.error']);
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
      plugins: async () => [{ status: 'fulfilled', value: plugin({ instanceKey: 'weather', status: 'degraded', issues }) }],
    };
    const read = () => collectAttention(sources, { allows: owner, observations, now: () => clock });
    const first = await read();
    clock += 60_000;
    issues = ['second'];
    const second = await read();
    const pick = (list: typeof first, kind: string) => list.items.find(item => item.kind === kind)!;
    expect(pick(second, 'plugin.error').id).toBe(pick(first, 'plugin.error').id);
    expect(pick(second, 'plugin.error').id).toBe(attentionItemId('plugin.error', { plugin: 'weather' }));
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
