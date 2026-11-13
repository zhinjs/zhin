import {
  CONSOLE_BUILTIN_ROLES,
  CONSOLE_RPC_PERMISSIONS,
  CONSOLE_WRITE_PERMISSIONS,
  GATEWAY_INSTANCE_RPC,
  GATEWAY_PACKAGES_RPC,
  GATEWAY_PLUGINS_RPC,
  GATEWAY_RPC,
  GATEWAY_RPC_PERMISSIONS,
  isConsolePermission,
  resolveConsoleRpcPermission,
} from '../src/index.js';

describe('gateway RPC catalog (ADR 0054 §4 / §5)', () => {
  it('lists every packages / instance RPC in the Console permission map', () => {
    expect(Object.keys(GATEWAY_RPC).length).toBe(Object.keys(GATEWAY_PACKAGES_RPC).length + Object.keys(GATEWAY_INSTANCE_RPC).length + Object.keys(GATEWAY_PLUGINS_RPC).length);
    for (const type of Object.values(GATEWAY_RPC)) {
      expect(isConsolePermission(GATEWAY_RPC_PERMISSIONS[type]), type).toBe(true);
      expect(CONSOLE_RPC_PERMISSIONS[type], type).toBe(GATEWAY_RPC_PERMISSIONS[type]);
      expect(resolveConsoleRpcPermission(type)).toMatchObject({ kind: 'exact', permission: GATEWAY_RPC_PERMISSIONS[type], target: { kind: 'global' } });
    }
  });

  it('uses plugin.manage for packages and status.view / ops.restart for the instance', () => {
    expect(GATEWAY_RPC_PERMISSIONS['gateway.packages.install']).toBe('plugin.manage');
    expect(GATEWAY_RPC_PERMISSIONS['gateway.packages.plan']).toBe('plugin.manage');
    expect(GATEWAY_RPC_PERMISSIONS['gateway.packages.list']).toBe('feature.view');
    expect(GATEWAY_RPC_PERMISSIONS['gateway.plugins.declare']).toBe('plugin.manage');
    expect(GATEWAY_RPC_PERMISSIONS['gateway.plugins.enable']).toBe('plugin.manage');
    expect(GATEWAY_RPC_PERMISSIONS['gateway.plugins.disable']).toBe('plugin.manage');
    expect(GATEWAY_RPC_PERMISSIONS['gateway.instance.status']).toBe('status.view');
    expect(GATEWAY_RPC_PERMISSIONS['gateway.instance.logs']).toBe('status.view');
    for (const type of ['gateway.instance.start', 'gateway.instance.stop', 'gateway.instance.restart'] as const) {
      expect(GATEWAY_RPC_PERMISSIONS[type]).toBe('ops.restart');
    }
    expect(CONSOLE_WRITE_PERMISSIONS.has('ops.restart')).toBe(true);
    expect(CONSOLE_WRITE_PERMISSIONS.has('plugin.manage')).toBe(true);
  });

  it('grants instance lifecycle to owner / admin, not to operator / viewer', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(CONSOLE_BUILTIN_ROLES[role].permissions).toContain('ops.restart');
      expect(CONSOLE_BUILTIN_ROLES[role].permissions).toContain('plugin.manage');
    }
    for (const role of ['operator', 'viewer'] as const) {
      expect(CONSOLE_BUILTIN_ROLES[role].permissions).not.toContain('ops.restart');
      expect(CONSOLE_BUILTIN_ROLES[role].permissions).not.toContain('plugin.manage');
      expect(CONSOLE_BUILTIN_ROLES[role].permissions).toContain('status.view');
    }
  });
});
