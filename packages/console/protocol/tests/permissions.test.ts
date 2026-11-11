import {
  AGENT_COLLABORATION_RPC,
  CONFIG_RPC,
  CONSOLE_BUILTIN_ROLES,
  CONSOLE_PERMISSION_LIST,
  CONSOLE_RPC_PERMISSIONS,
  ENDPOINT_RPC,
  IAM_RPC,
  INBOX_RPC,
  LOGIN_RPC,
  PLUGIN_RPC,
  SIDE_EVENT_RPC,
  bindingScopeCovers,
  grantsAllow,
  isConsolePermission,
  parseConsoleBindingScope,
  resolveConsoleHttpPermission,
  resolveConsoleWsPermission,
  resolveConsoleRpcPermission,
  type ConsoleGrant,
} from '../src/index.js';

describe('Console permission catalog (ADR 0049 §3)', () => {
  it('maps every catalogued Console RPC to a known permission', () => {
    const catalogs = [SIDE_EVENT_RPC, LOGIN_RPC, INBOX_RPC, ENDPOINT_RPC, CONFIG_RPC, PLUGIN_RPC, AGENT_COLLABORATION_RPC, IAM_RPC];
    for (const catalog of catalogs) {
      for (const type of Object.values(catalog)) {
        expect(CONSOLE_RPC_PERMISSIONS[type], type).toBeDefined();
        expect(isConsolePermission(CONSOLE_RPC_PERMISSIONS[type]), type).toBe(true);
      }
    }
    for (const type of ['feature.list', 'feature.matrix', 'feature.get', 'feature.set-override', 'feature.remove-override', 'feature.set-enabled']) {
      expect(CONSOLE_RPC_PERMISSIONS[type], type).toBeDefined();
    }
    for (const permission of Object.values(CONSOLE_RPC_PERMISSIONS)) expect(isConsolePermission(permission)).toBe(true);
  });

  it('denies unknown types and maps plugin RPC to feature.view / feature.configure', () => {
    expect(resolveConsoleRpcPermission('made.up')).toBeNull();
    expect(resolveConsoleRpcPermission('')).toBeNull();
    expect(resolveConsoleRpcPermission('plugin.root/rss.status')).toMatchObject({ kind: 'plugin', read: 'feature.view', write: 'feature.configure' });
    expect(resolveConsoleRpcPermission('plugin.root/qq.endpoint-add')).toMatchObject({
      kind: 'exact', permission: 'endpoint.manage', target: { kind: 'adapter', adapter: 'qq' },
    });
    expect(resolveConsoleRpcPermission('plugin.root/qq.endpoint-stop', { data: { id: 'bot-1' } })).toMatchObject({
      permission: 'endpoint.manage', target: { kind: 'endpoint', adapter: 'qq', endpoint: 'bot-1' },
    });
  });

  it('refines config:patch by instanceKey and extracts scope targets from payloads', () => {
    expect(resolveConsoleRpcPermission('config:patch', { patches: [] })).toMatchObject({ permission: 'agent.configure' });
    expect(resolveConsoleRpcPermission('config:patch', { instanceKey: 'rss' })).toMatchObject({ permission: 'feature.configure' });
    expect(resolveConsoleRpcPermission('feature.set-override', { data: { plugin: 'rss', level: 'adapter', key: 'qq' } }))
      .toMatchObject({ target: { kind: 'adapter', adapter: 'qq' } });
    expect(resolveConsoleRpcPermission('feature.set-enabled', { data: { plugin: 'rss', level: 'endpoint', key: 'qq/bot-1' } }))
      .toMatchObject({ target: { kind: 'endpoint', adapter: 'qq', endpoint: 'bot-1' } });
    expect(resolveConsoleRpcPermission('feature.set-enabled', { data: { level: 'global' } })).toMatchObject({ target: { kind: 'global' } });
    expect(resolveConsoleRpcPermission('endpoint.send_message', { data: { adapter: 'qq', endpointKey: 'bot-1' } }))
      .toMatchObject({ target: { kind: 'endpoint', adapter: 'qq', endpoint: 'bot-1' } });
    // Conflicting top-level vs data fields fall back to a global requirement.
    expect(resolveConsoleRpcPermission('endpoint.send_message', { adapter: 'qq', endpointKey: 'a', data: { adapter: 'qq', endpointKey: 'b' } }))
      .toMatchObject({ target: { kind: 'global' } });
    expect(resolveConsoleRpcPermission('endpoint.list')).toMatchObject({ target: { kind: 'any' } });
    expect(resolveConsoleRpcPermission('inbox.recent', {})).toMatchObject({ target: { kind: 'global' } });
  });

  it('applies binding scopes only to scoped permissions', () => {
    const adapter = { kind: 'adapter', key: 'qq' } as const;
    const endpoint = { kind: 'endpoint', key: 'qq/bot-1' } as const;
    const target = { kind: 'endpoint', adapter: 'qq', endpoint: 'bot-1' } as const;
    expect(bindingScopeCovers(adapter, 'endpoint.operate', target)).toBe(true);
    expect(bindingScopeCovers(adapter, 'endpoint.operate', { kind: 'adapter', adapter: 'tg' })).toBe(false);
    expect(bindingScopeCovers(endpoint, 'endpoint.operate', target)).toBe(true);
    expect(bindingScopeCovers(endpoint, 'endpoint.operate', { kind: 'adapter', adapter: 'qq' })).toBe(false);
    expect(bindingScopeCovers(adapter, 'status.view', target)).toBe(false);
    expect(bindingScopeCovers(adapter, 'endpoint.view', { kind: 'global' })).toBe(false);
    expect(bindingScopeCovers({ kind: 'global' }, 'status.view', { kind: 'global' })).toBe(true);
    const grants: ConsoleGrant[] = [{ scope: adapter, permissions: ['endpoint.view'] }];
    expect(grantsAllow(grants, 'endpoint.view', { kind: 'any' })).toBe(true);
    expect(grantsAllow(grants, 'endpoint.operate', target)).toBe(false);
    expect(parseConsoleBindingScope('endpoint', 'qq')).toBeNull();
    expect(parseConsoleBindingScope('adapter', 'qq/x')).toBeNull();
    expect(parseConsoleBindingScope('global', undefined)).toEqual({ kind: 'global' });
  });

  it('defines the built-in roles of ADR 0049 §4', () => {
    expect(CONSOLE_BUILTIN_ROLES.owner.permissions).toEqual(CONSOLE_PERMISSION_LIST);
    expect(CONSOLE_BUILTIN_ROLES.admin.permissions).not.toContain('ops.terminal');
    expect(CONSOLE_BUILTIN_ROLES.admin.permissions).not.toContain('iam.manage');
    expect(CONSOLE_BUILTIN_ROLES.admin.permissions).toContain('mcp.access');
    expect(CONSOLE_BUILTIN_ROLES.viewer.permissions).toContain('iam.view');
    expect(CONSOLE_BUILTIN_ROLES.viewer.permissions).not.toContain('ops.config.read');
    expect(CONSOLE_BUILTIN_ROLES.viewer.permissions).not.toContain('ops.env.read');
    expect(CONSOLE_BUILTIN_ROLES.viewer.permissions.every(p => p.endsWith('.view') || p.endsWith('.read'))).toBe(true);
    expect(CONSOLE_BUILTIN_ROLES.operator.permissions).toEqual([
      'status.view', 'endpoint.view', 'endpoint.operate', 'feature.view', 'feature.configure', 'feature.toggle', 'agent.view', 'ops.schedule.read',
      'plugin.perms.read', 'plugin.perms.operate',
    ]);
  });

  it('maps HTTP routes, preferring the most specific rule and denying unknown routes', () => {
    expect(resolveConsoleHttpPermission('GET', '/system/status')?.permission).toBe('status.view');
    expect(resolveConsoleHttpPermission('POST', '/console/request')?.permission).toBe('rpc');
    expect(resolveConsoleHttpPermission('POST', '/auth/login')?.permission).toBe('public');
    expect(resolveConsoleHttpPermission('GET', '/auth/me')?.permission).toBe('public');
    expect(resolveConsoleHttpPermission('POST', '/auth/setup/database')?.permission).toBe('bootstrap');
    expect(resolveConsoleHttpPermission('GET', '/agent/inference/targets')?.permission).toBe('agent.view');
    expect(resolveConsoleHttpPermission('POST', '/agent/inference/apply')?.permission).toBe('agent.configure');
    expect(resolveConsoleHttpPermission('GET', '/plugins/%40zhin.js%2Fx')?.permission).toBe('feature.view');
    expect(resolveConsoleHttpPermission('POST', '/plugins')).toBeNull();
    expect(resolveConsoleHttpPermission('GET', '/config')).toBeNull();
    expect(resolveConsoleHttpPermission('GET', '/introspectionx')).toBeNull();
    expect(resolveConsoleHttpPermission('GET', '/console/terminal/targets')?.permission).toBe('ops.terminal');
    expect(resolveConsoleHttpPermission('POST', '/console/terminal/tickets')?.permission).toBe('ops.terminal');
  });

  it('maps only the Console WebSocket paths, including per-endpoint sandbox sockets', () => {
    expect(resolveConsoleWsPermission('/sandbox')).toBe('endpoint.operate');
    expect(resolveConsoleWsPermission('/sandbox/bot-1')).toBe('endpoint.operate');
    expect(resolveConsoleWsPermission('/sandbox-x')).toBeNull();
    expect(resolveConsoleWsPermission('/onebot/v11')).toBeNull();
  });
});
