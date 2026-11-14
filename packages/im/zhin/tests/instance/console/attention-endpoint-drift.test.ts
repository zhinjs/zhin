import { describe, expect, it } from 'vitest';
import { grantsAllow, type ConsoleGrant, type ConsoleScopeTarget } from '@zhin.js/console-protocol';
import { collectAttention, type AttentionSources } from '../../../src/instance/console/attention.js';

const NOW = Date.parse('2026-11-14T08:00:00.000Z');
const allowsFor = (grants: ConsoleGrant[]) => (permission: string, target?: ConsoleScopeTarget) => grantsAllow(grants, permission, target);

const sources: AttentionSources = {
  endpoints: () => [{ adapter: 'qq', name: 'bot', connected: false, phase: 'offline', transportState: 'closed',
    lastError: { category: 'auth', message: 'The platform rejected the account credentials (E_AUTH)' } }],
  endpointConfigDrift: async () => [
    { instanceKey: 'qq', adapter: 'qq', configOnly: ['new'], savedOnly: ['gone'], changed: ['main'] },
    { instanceKey: 'icqq', adapter: 'icqq', configOnly: ['10002'], savedOnly: [], changed: [] },
  ],
};

describe('attention.list: endpoint configuration drift (#1250)', () => {
  it('lists one item per adapter instance with ids and kinds, linking to its accounts page', async () => {
    const list = await collectAttention(sources, { allows: () => true, now: () => NOW });
    const drift = list.items.filter(item => item.kind === 'endpoint.config-drift');
    // Items are sorted like every other attention item (severity, then first seen, then id).
    expect(drift.map(item => item.subject)).toEqual([{ adapter: 'icqq', plugin: 'icqq' }, { adapter: 'qq', plugin: 'qq' }]);
    const qq = drift.find(item => item.subject?.plugin === 'qq')!;
    expect(qq).toMatchObject({ severity: 'warning', source: 'endpoint-config', action: { path: '/plugins/qq' } });
    expect(qq.detail).toContain('仅在配置文件（未运行）：new');
    expect(qq.detail).toContain('已不在配置文件（仍按已保存账号运行）：gone');
    expect(qq.detail).toContain('配置不同：main');
    const offline = list.items.find(item => item.kind === 'endpoint.offline');
    expect(offline?.detail).toContain('auth');
  });

  it('shows an adapter instance only to callers who may view its accounts', async () => {
    const scoped = allowsFor([{ permissions: ['endpoint.view', 'status.view'], scope: { kind: 'adapter', key: 'icqq' } }]);
    const list = await collectAttention(sources, { allows: scoped, now: () => NOW });
    expect(list.items.filter(item => item.kind === 'endpoint.config-drift').map(item => item.subject?.plugin)).toEqual(['icqq']);
  });

  it('lists accounts whose start failed or waits for a retry, with the redacted reason', async () => {
    const list = await collectAttention({
      endpoints: () => [
        { adapter: 'qq', name: 'bad-config', connected: false, phase: 'failed', transportState: 'stopped',
          lastError: { category: 'config', message: 'Account configuration is invalid (E_CONFIG) token=abc123' } },
        { adapter: 'qq', name: 'flaky', connected: false, phase: 'retrying', transportState: 'closed',
          lastError: { category: 'network', message: 'Network unreachable (ECONNREFUSED)' } },
        { adapter: 'qq', name: 'starting', connected: false, phase: 'starting', transportState: 'connecting' },
        { adapter: 'qq', name: 'stopped', connected: false, phase: 'offline', transportState: 'stopped' },
      ],
    }, { allows: () => true, now: () => NOW });
    const offline = list.items.filter(item => item.kind === 'endpoint.offline');
    expect(offline.map(item => item.subject?.endpointKey).sort()).toEqual(['bad-config', 'flaky']);
    const bad = offline.find(item => item.subject?.endpointKey === 'bad-config')!;
    expect(bad.detail).toContain('config');
    expect(bad.detail).toContain('E_CONFIG');
    expect(bad.detail).not.toContain('abc123');
  });

  it('marks the source unavailable when it cannot be read', async () => {
    const list = await collectAttention({ endpointConfigDrift: async () => { throw new Error('boom'); } }, { allows: () => true, now: () => NOW });
    expect(list.unavailable).toEqual(['endpoint-config']);
  });
});
