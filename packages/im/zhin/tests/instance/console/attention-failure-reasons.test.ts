import { describe, expect, it } from 'vitest';
import { CONSOLE_ATTENTION_KINDS, CONSOLE_ATTENTION_KIND_PERMISSIONS, grantsAllow, type ConsoleGrant, type ConsoleScopeTarget } from '@zhin.js/console-protocol';
import {
  AttentionSourceCache,
  AttentionWarnings,
  attentionFailureReason,
  collectAttention,
  preparationHint,
  type AttentionSources,
} from '../../../src/instance/console/attention.js';

const NOW = Date.parse('2026-11-15T08:00:00.000Z');
const owner = () => true;
const allowsFor = (grants: ConsoleGrant[]) => (permission: string, target?: ConsoleScopeTarget) => grantsAllow(grants, permission, target);
const notReady = () => { throw new Error('Root is not accepting generation operations (idle)'); };

describe('attention.list failure reasons (#1270)', () => {
  it('answers 「启动中」 while the instance is not ready, without reading sources or warning', async () => {
    const warned: string[] = [];
    const debugged: string[] = [];
    let read = false;
    const list = await collectAttention({
      ready: () => false,
      mcpServers: () => { read = true; return []; },
    }, { allows: owner, now: () => NOW, warnings: new AttentionWarnings(message => warned.push(message), { debug: message => debugged.push(message) }) });
    expect(list).toEqual({ status: 'starting', items: [], generatedAt: new Date(NOW).toISOString() });
    expect(read).toBe(false);
    expect(warned).toEqual([]);
    expect(debugged.length).toBe(1);
  });

  it('logs a source refused by a stopping Root at debug, not as a WARN', async () => {
    const warned: string[] = [];
    const debugged: string[] = [];
    const list = await collectAttention({ ready: () => true, mcpServers: notReady, unschedulableJobs: notReady },
      { allows: owner, warnings: new AttentionWarnings(message => warned.push(message), { debug: message => debugged.push(message) }) });
    expect(list.unavailable).toEqual(['mcp', 'schedule']);
    expect(warned).toEqual([]);
    expect(debugged).toHaveLength(2);
    // Real faults still warn.
    await collectAttention({ mcpServers: () => { throw new Error('broken'); } },
      { allows: owner, warnings: new AttentionWarnings(message => warned.push(message)) });
    expect(warned).toEqual(['attention.list: source mcp unavailable: broken']);
  });

  it('says why an MCP server is not connected, and marks a reason from before the restart', async () => {
    const list = await collectAttention({
      mcpServers: () => [
        { name: 'github', connected: false, lastError: { category: 'auth', message: 'HTTP 401 Bearer abc.def', at: NOW - 1000 } },
        { name: 'files', connected: false, lastError: { category: 'network', message: 'ECONNREFUSED' }, restored: true },
        { name: 'plain', connected: false },
      ],
    }, { allows: owner, now: () => NOW });
    const byServer = Object.fromEntries(list.items.map(item => [item.subject?.mcpServer, item]));
    expect(byServer.github!.detail).toBe('Agent 暂时无法调用它提供的工具。 最近一次连接失败（auth）：HTTP 401 Bearer ***');
    expect(byServer.github!.reason).toEqual({ category: 'auth', code: 'connect-failed', message: 'HTTP 401 Bearer ***', at: new Date(NOW - 1000).toISOString() });
    expect(byServer.files!.detail).toContain('（重启前记录）');
    expect(byServer.files!.reason?.restored).toBe(true);
    expect(byServer.plain!.reason).toBeUndefined();
  });

  it('marks an Endpoint reason restored from the journal', async () => {
    const list = await collectAttention({
      endpoints: () => [{ adapter: 'github', name: 'zhin-dev', connected: false, phase: 'offline', transportState: 'closed',
        lastError: { category: 'auth', message: 'Bad credentials', at: NOW - 5000, restored: true } }],
    }, { allows: owner, now: () => NOW });
    expect(list.items[0]!.detail).toContain('最近一次启动失败（auth）：Bad credentials（重启前记录）');
    expect(list.items[0]!.reason).toMatchObject({ category: 'auth', code: 'start-failed', restored: true });
  });

  it('lists model accounts that need an operator, with preparation step / reason / upstream status (agent.view)', async () => {
    const sources: AttentionSources = {
      inferenceAccounts: async () => [
        { accountId: 'accounts:a', label: 'Antigravity', serviceLabel: 'Google Antigravity', state: 'preparation-failed', revision: 3,
          preparationFailure: { code: 'project-unavailable', step: 'onboard-operation', upstreamStatus: 200, reason: 'UNSUPPORTED_CLIENT', restored: true, at: NOW - 60_000 } },
        { accountId: 'accounts:b', label: 'Codex', serviceLabel: 'OpenAI Codex', state: 'reauthorize', revision: 2 },
        { accountId: 'accounts:c', label: 'byesu', serviceLabel: 'byesu', state: 'uncertain', revision: 1, failure: 'invalid-response', failureStatus: 502 },
      ],
    };
    const list = await collectAttention(sources, { allows: owner, now: () => NOW });
    const byAccount = Object.fromEntries(list.items.map(item => [item.subject?.inferenceAccount, item]));
    const prepared = byAccount['accounts:a']!;
    expect(prepared).toMatchObject({ kind: 'inference.account', severity: 'danger', source: 'inference',
      title: '模型账号 Antigravity 已登录，但准备未完成', since: new Date(NOW - 60_000).toISOString(),
      action: { path: '/features/ai?account=accounts%3Aa' },
      reason: { category: 'preparation', code: 'project-unavailable', step: 'onboard-operation', reason: 'UNSUPPORTED_CLIENT', upstreamStatus: 200, restored: true } });
    expect(prepared.detail).toContain('code=project-unavailable step=onboard-operation upstreamStatus=200 reason=UNSUPPORTED_CLIENT');
    expect(prepared.detail).toContain('Antigravity 直连目前可能卡在这一步');
    expect(prepared.detail).toContain('（重启前记录）');
    expect(byAccount['accounts:b']).toMatchObject({ title: '模型账号 Codex 需要重新登录', reason: { code: 'reauthorize' } });
    expect(byAccount['accounts:c']).toMatchObject({ severity: 'warning', reason: { code: 'uncertain', reason: 'invalid-response', upstreamStatus: 502 } });
    expect(byAccount['accounts:c']!.detail).toContain('(invalid-response HTTP 502)');
    // Without agent.view the source is not read at all.
    const viewer = await collectAttention(sources, { allows: allowsFor([{ role: 'viewer', scope: { kind: 'global' }, permissions: ['status.view'] }]) });
    expect(viewer.items).toEqual([]);
  });

  it('raises config.ineffective for a sub-agent model choice the runtime ignores', async () => {
    const list = await collectAttention({
      ineffectiveConfig: async () => [
        { path: 'purposes.agents.planner', reason: 'binding-name', agents: ['tools__planner'] },
        { path: 'purposes.agents.typo', reason: 'no-target' },
      ],
    }, { allows: owner, locale: 'en', now: () => NOW });
    expect(list.items.map(item => [item.kind, item.subject?.configPath, item.reason?.code])).toEqual([
      ['config.ineffective', 'purposes.agents.planner', 'binding-name'],
      ['config.ineffective', 'purposes.agents.typo', 'no-target'],
    ]);
    expect(list.items[0]!.detail).toContain('sub-agent tools__planner does not use it');
  });

  it('maps every kind to the permission that shows it', () => {
    expect(Object.keys(CONSOLE_ATTENTION_KIND_PERMISSIONS).sort()).toEqual([...CONSOLE_ATTENTION_KINDS].sort());
    expect(CONSOLE_ATTENTION_KIND_PERMISSIONS['inference.account']).toBe('agent.view');
    expect(CONSOLE_ATTENTION_KIND_PERMISSIONS['config.ineffective']).toBe('agent.view');
  });

  it('picks the preparation hint from the sanitized reason', () => {
    expect(preparationHint({ reason: 'UNSUPPORTED_CLIENT' })).toBe('unsupportedClient');
    expect(preparationHint({ reason: 'project-required' })).toBe('project');
    expect(preparationHint({ reason: 'validation-required' })).toBe('validation');
    expect(preparationHint({ reason: 'transport' })).toBe('retry');
    expect(preparationHint({ reason: 'UNAVAILABLE', upstreamStatus: 503 })).toBe('retry');
    expect(preparationHint({ reason: 'PERMISSION_DENIED', upstreamStatus: 403 })).toBe('other');
  });

  // Review of #1278: every sample that used to pass through unmasked.
  it.each([
    ['{"access_token":"ya29.a0AfH6SMBx","refresh_token":"1//0gLx"}', '{"access_token":***,"refresh_token":***}'],
    ['GET https://generativelanguage.googleapis.com/v1/models?key=AIzaSyDUMMYDUMMYDUMMYDUMMY failed', 'GET https://generativelanguage.googleapis.com/v1/models?*** failed'],
    ['GET /v1/models?key=AIzaSyDUMMYDUMMYDUMMYDUMMY failed', 'GET …/models?key=*** failed'],
    ['request failed with Cookie: session=abc123; theme=dark', 'request failed with Cookie: ***'],
    ['invalid key sk-proj-abcdef123456 rejected', 'invalid key *** rejected'],
    ['Authorization: sk-abc123456', 'Authorization: ***'],
    ['authorization=Token abc123', 'authorization=Token ***'],
    ["x-api-key: 'abc'", 'x-api-key: ***'],
    ['api_key=abc&other=1', 'api_key=***&other=1'],
    ['secret: s3cr3t, password=hunter2', 'secret: ***, password=***'],
    ['leaked AIzaSyDUMMYDUMMYDUMMYDUMMYXX here', 'leaked *** here'],
    ['opaque abcdefghijklmnopqrstuvwxyz0123 value', 'opaque *** value'],
    ['login pass=hunter2 pwd: x1', 'login pass=*** pwd: ***'],
    ['callback sig=abc&session_id=s1', 'callback sig=***&session_id=***'],
  ])('masks %s', (input, expected) => {
    expect(attentionFailureReason(new Error(input))).toBe(expected);
  });

  it('keeps ordinary codes and statuses readable', () => {
    expect(attentionFailureReason('Account preparation failed: code=project-unavailable step=onboard-operation upstreamStatus=200 reason=UNSUPPORTED_CLIENT'))
      .toBe('Account preparation failed: code=project-unavailable step=onboard-operation upstreamStatus=200 reason=UNSUPPORTED_CLIENT');
    expect(attentionFailureReason('connect ECONNREFUSED 127.0.0.1:443')).toBe('connect ECONNREFUSED 127.0.0.1:443');
  });

  // Review of #1278: the server filters every kind by the permission CONSOLE_ATTENTION_KIND_PERMISSIONS names.
  function sourcesForEveryKind(): AttentionSources {
    return {
      loginTasks: () => [{ id: 'login-1', adapter: 'icqq', endpointKey: '10001', type: 'qrcode', createdAt: NOW - 1 }],
      endpoints: () => [{ adapter: 'qq', name: 'bot', connected: false, phase: 'offline', transportState: 'closed' }],
      endpointConfigDrift: async () => [{ instanceKey: 'qq', adapter: 'qq', configOnly: ['a'], savedOnly: [], changed: [] }],
      plugins: async () => ({
        dependencies: { status: 'failed', error: 'Missing service: database' },
        states: [
          { status: 'fulfilled', value: { instanceKey: 'weather', status: 'degraded', dependencies: 'passed', disabled: false, issues: ['broken'],
            validation: { valid: false, errors: [{ path: 'key', message: 'required' }], missingEnv: [] } } },
        ],
      }),
      configuration: {
        source: async () => { throw Object.assign(new Error('bad'), { code: 'EACCES' }); },
      },
      toolApprovals: () => [{ id: 'appr-1', toolName: 'group_kick', sessionKey: 's', createdAt: NOW - 1 }],
      mcpServers: () => [{ name: 'search', connected: false }],
      unschedulableJobs: () => [{ jobId: 'job-1', reason: 'no_next_run', since: NOW - 1 }],
      errorLogs: async () => ({ count: 1, latest: new Date(NOW).toISOString() }),
      chatRoles: async () => ({ hasGlobalOwner: false, claimOpen: false,
        imported: { at: NOW - 1, entries: [{ source: 'qq.owner', adapter: 'qq', userId: '1', role: 'owner', level: 'global', result: 'granted' }] },
        pending: [{ id: 'p1', source: 'qq.admins', adapter: 'qq', userId: '2', role: 'admin', seenAt: NOW - 1 }] }),
      inferenceAccounts: async () => [{ accountId: 'accounts:a', label: 'A', serviceLabel: 'S', state: 'reauthorize', revision: 1 }],
      ineffectiveConfig: async () => [{ path: 'purposes.agents.typo', reason: 'no-target' }],
    };
  }

  it('produces every kind for a principal holding every permission', async () => {
    const kinds = new Set((await collectAttention(sourcesForEveryKind(), { allows: owner, now: () => NOW })).items.map(item => item.kind));
    // config.invalid and config.apply-failed come from the same read; this fixture makes the file unreadable.
    expect([...CONSOLE_ATTENTION_KINDS].filter(kind => !kinds.has(kind)).sort()).toEqual(['config.apply-failed', 'config.literal-secrets']);
  });

  it.each(Object.entries(CONSOLE_ATTENTION_KIND_PERMISSIONS))('lists %s only with %s', async (kind, permission) => {
    const only = (granted: (name: string) => boolean) => collectAttention(sourcesForEveryKind(), {
      allows: name => granted(name), allowsPluginPermission: name => granted(name), now: () => NOW });
    const kindsWith = new Set((await only(name => name === permission)).items.map(item => item.kind));
    // `tool-approval.pending` also accepts the other approval level, `ops:approve`.
    const alternatives = kind === 'tool-approval.pending' ? [permission, 'ops:approve'] : [permission];
    const kindsWithout = new Set((await only(name => !alternatives.includes(name))).items.map(item => item.kind));
    if (kind !== 'config.apply-failed' && kind !== 'config.literal-secrets') expect(kindsWith.has(kind as never)).toBe(true);
    expect(kindsWithout.has(kind as never)).toBe(false);
  });

  it('hides config.ineffective and inference.account from a principal without agent.view', async () => {
    const list = await collectAttention(sourcesForEveryKind(), { allows: name => name !== 'agent.view', now: () => NOW });
    expect(list.items.some(item => item.kind === 'config.ineffective' || item.kind === 'inference.account')).toBe(false);
    expect(list.unavailable).toBeUndefined();
  });

  it('shares the model account read between requests through the 15 s cache', async () => {
    let reads = 0;
    let clock = NOW;
    const sources: AttentionSources = { inferenceAccounts: async () => { reads += 1; return []; } };
    const cache = new AttentionSourceCache({ now: () => clock });
    await collectAttention(sources, { allows: owner, cache });
    await collectAttention(sources, { allows: owner, cache });
    expect(reads).toBe(1);
    clock += 15_000;
    await collectAttention(sources, { allows: owner, cache });
    expect(reads).toBe(2);
  });

  it('stays fast on huge single-line input (no quadratic backtracking, #1278)', () => {
    for (const input of ['key'.repeat(34_000), 'a'.repeat(100_000), `${'key'.repeat(34_000)}=1`, `x ${'a1'.repeat(50_000)}`]) {
      const started = performance.now();
      const reason = attentionFailureReason(new Error(input));
      expect(performance.now() - started).toBeLessThan(50);
      expect(reason.length).toBeLessThanOrEqual(200);
    }
  });

  it('keeps `signal:` readable while masking a `sig` value', () => {
    expect(attentionFailureReason('aborted, signal: SIGTERM')).toBe('aborted, signal: SIGTERM');
  });
});
