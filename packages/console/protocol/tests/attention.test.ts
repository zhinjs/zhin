import {
  ATTENTION_RPC,
  CONSOLE_RPC_PERMISSIONS,
  CONSOLE_WRITE_PERMISSIONS,
  attentionItemId,
  attentionRevision,
  compareAttentionItems,
  grantsAllow,
  isConsoleAttentionRpcType,
  resolveConsoleRpcPermission,
  type ConsoleGrant,
} from '../src/index.js';

describe('attention.list (Console attention inbox)', () => {
  it('is a read registered with status.view at the global target', () => {
    expect(ATTENTION_RPC.LIST).toBe('attention.list');
    expect(CONSOLE_RPC_PERMISSIONS['attention.list']).toBe('status.view');
    expect(CONSOLE_WRITE_PERMISSIONS.has('status.view')).toBe(false);
    expect(resolveConsoleRpcPermission('attention.list', { type: 'attention.list', data: { locale: 'en' } }))
      .toEqual({ kind: 'exact', permission: 'status.view', target: { kind: 'global' } });
    expect(isConsoleAttentionRpcType('attention.list')).toBe(true);
    expect(isConsoleAttentionRpcType('attention.dismiss')).toBe(false);
  });

  it('admits viewers (global status.view) and refuses principals without it', () => {
    const viewer: ConsoleGrant[] = [{ role: 'viewer', scope: { kind: 'global' }, permissions: ['status.view'] }];
    const scopedOnly: ConsoleGrant[] = [{ role: 'operator', scope: { kind: 'endpoint', key: 'qq/bot' }, permissions: ['endpoint.view'] }];
    expect(grantsAllow(viewer, 'status.view')).toBe(true);
    expect(grantsAllow(scopedOnly, 'status.view')).toBe(false);
  });

  it('derives ids from kind + subject only, independent of key order and state', () => {
    const a = attentionItemId('endpoint.offline', { adapter: 'qq', endpointKey: 'bot' });
    expect(a).toBe(attentionItemId('endpoint.offline', { endpointKey: 'bot', adapter: 'qq' }));
    expect(a).toMatch(/^endpoint\.offline:[0-9a-f]{8}$/u);
    expect(a).not.toBe(attentionItemId('login.pending', { adapter: 'qq', endpointKey: 'bot' }));
    expect(a).not.toBe(attentionItemId('endpoint.offline', { adapter: 'qq', endpointKey: 'bot2' }));
    expect(attentionItemId('logs.errors')).toBe(attentionItemId('logs.errors', {}));
    expect(attentionRevision({ count: 1 })).not.toBe(attentionRevision({ count: 2 }));
    expect(attentionRevision({ a: 1, b: 2 })).toBe(attentionRevision({ b: 2, a: 1 }));
  });

  it('sorts danger, warning, info, then oldest first', () => {
    const items = [
      { id: 'c', severity: 'info' as const, since: '2026-01-01T00:00:00.000Z' },
      { id: 'b', severity: 'warning' as const, since: '2026-01-02T00:00:00.000Z' },
      { id: 'a', severity: 'warning' as const, since: '2026-01-01T00:00:00.000Z' },
      { id: 'd', severity: 'danger' as const, since: '2026-01-03T00:00:00.000Z' },
    ];
    expect([...items].sort(compareAttentionItems).map(item => item.id)).toEqual(['d', 'a', 'b', 'c']);
  });
});
