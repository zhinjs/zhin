import { describe, expect, it } from 'vitest';
import { CONSOLE_ATTENTION_KINDS, CONSOLE_ATTENTION_KIND_PERMISSIONS, grantsAllow, type ConsoleGrant, type ConsoleScopeTarget } from '@zhin.js/console-protocol';
import {
  AttentionWarnings,
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
});
