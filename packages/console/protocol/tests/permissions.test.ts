import {
  AGENT_COLLABORATION_RPC,
  ATTENTION_RPC,
  CONFIG_RPC,
  CONSOLE_BUILTIN_ROLES,
  CONSOLE_PERMISSION_LIST,
  CONSOLE_RPC_PERMISSIONS,
  CONSOLE_WRITE_PERMISSIONS,
  ENDPOINT_RPC,
  IAM_RPC,
  INBOX_RPC,
  LOGIN_RPC,
  ONBOARDING_RPC,
  PLUGIN_RPC,
  SIDE_EVENT_RPC,
  bindingScopeCovers,
  consoleRpcPermission,
  grantsAllow,
  grantsAllowAlsoRequired,
  isConsolePermission,
  isPluginConsoleRpcType,
  normalizePluginConsoleRpcType,
  parsePluginConsoleRpcType,
  parseConsoleBindingScope,
  resolveConsoleHttpPermission,
  resolveConsoleWsPermission,
  resolveConsoleRpcPermission,
  type ConsoleGrant,
} from '../src/index.js';

describe('Console permission catalog (ADR 0049 §3)', () => {
  it('maps every catalogued Console RPC to a known permission', () => {
    const catalogs = [SIDE_EVENT_RPC, LOGIN_RPC, INBOX_RPC, ENDPOINT_RPC, CONFIG_RPC, PLUGIN_RPC, AGENT_COLLABORATION_RPC, IAM_RPC, ONBOARDING_RPC, ATTENTION_RPC];
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

  it('registers the #1250 configuration file account methods like the other account methods', () => {
    expect(resolveConsoleRpcPermission('plugin.root/qq.endpoint-import', { data: { id: 'bot-1', start: true } })).toMatchObject({
      kind: 'exact', permission: 'endpoint.manage', target: { kind: 'endpoint', adapter: 'qq', endpoint: 'bot-1' },
    });
    expect(resolveConsoleRpcPermission('plugin.root/qq.endpoint-writeback', { data: { ids: ['bot-1'] } })).toMatchObject({
      kind: 'exact', permission: 'endpoint.manage', target: { kind: 'adapter', adapter: 'qq' }, alsoRequires: ['ops.config.write'],
    });
    // Only the write-back rewrites the configuration file.
    expect(resolveConsoleRpcPermission('plugin.root/qq.endpoint-import', { data: { id: 'bot-1' } })).not.toHaveProperty('alsoRequires');
    expect(resolveConsoleRpcPermission('plugin.root/qq.endpoint-drift')).toMatchObject({
      kind: 'exact', permission: 'endpoint.view', target: { kind: 'adapter', adapter: 'qq' },
    });
  });

  it('endpoint-writeback needs ops.config.write globally on top of endpoint.manage (#1250)', () => {
    const rule = resolveConsoleRpcPermission('plugin.root/qq.endpoint-writeback', { data: { ids: ['bot-1'] } });
    const accountOperator: ConsoleGrant[] = [{ permissions: ['endpoint.manage'], scope: { kind: 'adapter', key: 'qq' } }];
    expect(grantsAllowAlsoRequired(accountOperator, rule)).toBe(false);
    // ops.config.write scoped to the adapter is not enough: configuration writes are global.
    expect(grantsAllowAlsoRequired([...accountOperator, { permissions: ['ops.config.write'], scope: { kind: 'adapter', key: 'qq' } }], rule)).toBe(false);
    expect(grantsAllowAlsoRequired([...accountOperator, { permissions: ['ops.config.write'], scope: { kind: 'global' } }], rule)).toBe(true);
    expect(grantsAllowAlsoRequired(accountOperator, resolveConsoleRpcPermission('plugin.root/qq.endpoint-import', { data: { id: 'bot-1' } }))).toBe(true);
  });

  it('normalizes camelCase / action. plugin RPC spellings to the one canonical method', () => {
    expect(normalizePluginConsoleRpcType('plugin.root/qq.action.endpointWriteback')).toEqual({
      type: 'plugin.root/qq.endpoint-writeback', pluginId: 'root/qq', method: 'endpoint-writeback', rawMethod: 'endpointWriteback',
    });
    expect(normalizePluginConsoleRpcType('plugin.root.status')).toMatchObject({ type: 'plugin.root.status', rawMethod: 'status' });
    expect(normalizePluginConsoleRpcType('plugin.root.action')).toMatchObject({ method: 'action' });
    expect(normalizePluginConsoleRpcType('plugin.root/qq.action.endpoint-writeback')?.type).toBe('plugin.root/qq.endpoint-writeback');
    // The canonical form is exactly what parsePluginConsoleRpcType accepts.
    expect(parsePluginConsoleRpcType(normalizePluginConsoleRpcType('plugin.root/qq.endpointImport')!.type))
      .toEqual({ pluginId: 'root/qq', method: 'endpoint-import' });
    for (const bad of ['plugin.root.EndpointWriteback', 'plugin.root.foo.bar', 'plugin.other.status', 'plugin.root.', 42]) {
      expect(normalizePluginConsoleRpcType(bad), String(bad)).toBeNull();
    }
    // Plugin-shaped but not addressable: only the generic (delegate-then-deny) rule, never account semantics.
    for (const shaped of ['plugin.root/qq.EndpointWriteback', 'plugin.root/qq.endpoint.writeback']) {
      expect(isPluginConsoleRpcType(shaped), shaped).toBe(true);
      expect(resolveConsoleRpcPermission(shaped), shaped).toMatchObject({ kind: 'plugin' });
    }
    expect(isPluginConsoleRpcType('plugin.other.status')).toBe(false);
  });

  it('resolves every spelling of an account method to the same rule, alsoRequires included', () => {
    const payload = { data: { ids: ['bot-1'], id: 'bot-1' } };
    const kebab = resolveConsoleRpcPermission('plugin.root/qq.endpoint-writeback', payload);
    for (const type of ['plugin.root/qq.endpointWriteback', 'plugin.root/qq.action.endpointWriteback', 'plugin.root/qq.action.endpoint-writeback']) {
      expect(resolveConsoleRpcPermission(type, payload), type).toEqual(kebab);
      expect(grantsAllowAlsoRequired([{ permissions: ['endpoint.manage'], scope: { kind: 'global' } }], resolveConsoleRpcPermission(type, payload)), type).toBe(false);
    }
    const stop = resolveConsoleRpcPermission('plugin.root/qq.endpoint-stop', payload);
    expect(stop).toMatchObject({ permission: 'endpoint.manage', target: { kind: 'endpoint', endpoint: 'bot-1' } });
    for (const type of ['plugin.root/qq.endpointStop', 'plugin.root/qq.action.endpointStop']) {
      expect(resolveConsoleRpcPermission(type, payload), type).toEqual(stop);
    }
    expect(resolveConsoleRpcPermission('plugin.root/qq.endpointDrift')).toEqual(resolveConsoleRpcPermission('plugin.root/qq.endpoint-drift'));
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

  it('requires plugin.manage for the global plugin switch (gateway transaction, ADR 0054 §4)', async () => {
    const { isGlobalFeatureSwitch, FEATURE_GLOBAL_SWITCH_PERMISSION } = await import('../src/index.js');
    expect(CONSOLE_RPC_PERMISSIONS['plugin:set-enabled']).toBe('plugin.manage');
    expect(FEATURE_GLOBAL_SWITCH_PERMISSION).toBe('plugin.manage');
    expect(resolveConsoleRpcPermission('feature.set-enabled', { data: { plugin: 'rss', level: 'global', enabled: false } }))
      .toMatchObject({ kind: 'exact', permission: 'plugin.manage', target: { kind: 'global' } });
    expect(resolveConsoleRpcPermission('feature.set-enabled', { plugin: 'rss', level: 'global', enabled: false }))
      .toMatchObject({ permission: 'plugin.manage' });
    // A `global` anywhere in the envelope keeps the stronger requirement.
    expect(resolveConsoleRpcPermission('feature.set-enabled', { level: 'global', data: { level: 'adapter', key: 'qq' } }))
      .toMatchObject({ permission: 'plugin.manage' });
    for (const level of ['adapter', 'endpoint', 'conversation']) {
      expect(resolveConsoleRpcPermission('feature.set-enabled', { data: { plugin: 'rss', level, key: 'qq' } }), level)
        .toMatchObject({ permission: 'feature.toggle' });
    }
    expect(consoleRpcPermission('feature.set-enabled')).toBe('feature.toggle');
    expect(isGlobalFeatureSwitch({ type: 'feature.set-enabled', data: { level: 'global' } })).toBe(true);
    expect(isGlobalFeatureSwitch({ type: 'feature.set-enabled', level: 'global' })).toBe(true);
    // Read like the instance dispatcher: `data` wins when it is an object.
    expect(isGlobalFeatureSwitch({ type: 'feature.set-enabled', level: 'global', data: { level: 'adapter' } })).toBe(false);
    expect(isGlobalFeatureSwitch({ type: 'feature.set-enabled', data: { level: 'adapter' } })).toBe(false);
    expect(isGlobalFeatureSwitch({ type: 'feature.set-override', data: { level: 'global' } })).toBe(false);
    expect(isGlobalFeatureSwitch(null)).toBe(false);
    const toggleOnly = [{ scope: { kind: 'global' as const }, permissions: ['feature.toggle'] }];
    const rule = resolveConsoleRpcPermission('feature.set-enabled', { data: { plugin: 'rss', level: 'global', enabled: true } });
    expect(rule?.kind === 'exact' && grantsAllow(toggleOnly, rule.permission, rule.target)).toBe(false);
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
    // Write SQL and schema changes are owner-only by default.
    expect(CONSOLE_BUILTIN_ROLES.owner.permissions).toContain('ops.database.schema');
    expect(CONSOLE_BUILTIN_ROLES.admin.permissions).not.toContain('ops.database.schema');
    expect(CONSOLE_BUILTIN_ROLES.admin.permissions).toContain('ops.database.write');
    expect(CONSOLE_BUILTIN_ROLES.operator.permissions).not.toContain('ops.database.schema');
    expect(CONSOLE_BUILTIN_ROLES.viewer.permissions).not.toContain('ops.database.schema');
    expect(CONSOLE_BUILTIN_ROLES.viewer.permissions).toContain('iam.view');
    expect(CONSOLE_BUILTIN_ROLES.viewer.permissions).not.toContain('ops.config.read');
    expect(CONSOLE_BUILTIN_ROLES.viewer.permissions).not.toContain('ops.env.read');
    expect(CONSOLE_BUILTIN_ROLES.viewer.permissions.every(p => p.endsWith('.view') || p.endsWith('.read'))).toBe(true);
    expect(CONSOLE_BUILTIN_ROLES.operator.permissions).toEqual([
      'status.view', 'endpoint.view', 'endpoint.operate', 'feature.view', 'feature.configure', 'feature.toggle', 'agent.view', 'ops.schedule.read',
      'plugin.perms.read', 'plugin.perms.operate',
    ]);
  });

  it('maps the Console SQL editor and schema editor RPCs (all raw SQL is schema, structured reads are reads)', () => {
    expect(consoleRpcPermission('db:query')).toBe('ops.database.schema');
    expect(consoleRpcPermission('db:select')).toBe('ops.database.read');
    expect(consoleRpcPermission('db:schema:describe')).toBe('ops.database.read');
    expect(consoleRpcPermission('db:schema:preview')).toBe('ops.database.read');
    expect(consoleRpcPermission('db:execute')).toBe('ops.database.schema');
    expect(consoleRpcPermission('db:schema:apply')).toBe('ops.database.schema');
    expect(CONSOLE_WRITE_PERMISSIONS.has('ops.database.schema')).toBe(true);
    expect(CONSOLE_WRITE_PERMISSIONS.has('ops.database.read')).toBe(false);
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
    // #1250: recent Agent turns need agent.view, ahead of the /introspection status.view prefix.
    expect(resolveConsoleHttpPermission('GET', '/introspection/recent-turns')?.permission).toBe('agent.view');
    expect(resolveConsoleHttpPermission('GET', '/introspection/commands')?.permission).toBe('status.view');
    expect(resolveConsoleHttpPermission('GET', '/console/terminal/targets')?.permission).toBe('ops.terminal');
    expect(resolveConsoleHttpPermission('POST', '/console/terminal/tickets')?.permission).toBe('ops.terminal');
    // Gateway-owned (ADR 0054 §4, ADR 0053 §4).
    expect(resolveConsoleHttpPermission('GET', '/gateway/packages/progress')?.permission).toBe('plugin.manage');
    expect(CONSOLE_RPC_PERMISSIONS[ONBOARDING_RPC.UPDATE]).toBe('plugin.manage');
  });

  it('maps only the Console WebSocket paths, including per-endpoint sandbox sockets', () => {
    expect(resolveConsoleWsPermission('/sandbox')).toBe('endpoint.operate');
    expect(resolveConsoleWsPermission('/sandbox/bot-1')).toBe('endpoint.operate');
    expect(resolveConsoleWsPermission('/sandbox-x')).toBeNull();
    expect(resolveConsoleWsPermission('/onebot/v11')).toBeNull();
  });
});

describe('conversation level and chat roles (ADR 0055 / 0056)', () => {
  it('registers feature.conversations and chat-roles.* and scopes conversation keys to their endpoint', async () => {
    const protocol = await import('../src/index.js');
    expect(protocol.CONSOLE_RPC_PERMISSIONS['feature.conversations']).toBe('feature.view');
    for (const type of Object.values(protocol.CHAT_ROLES_RPC)) expect(protocol.CONSOLE_RPC_PERMISSIONS[type], type).toBe('iam.manage');
    expect(protocol.featureScopeTarget('conversation', 'qq/bot-1/group:1')).toEqual({ kind: 'endpoint', adapter: 'qq', endpoint: 'bot-1' });
    expect(protocol.featureScopeTarget('conversation', 'qq/bot-1/room:1')).toEqual({ kind: 'global' });
    expect(protocol.featureScopeTarget('endpoint', 'qq/bot-1/group:1')).toEqual({ kind: 'global' });
    expect(protocol.featureScopeTarget('adapter', 'qq')).toEqual({ kind: 'adapter', adapter: 'qq' });
    const scoped = [{ scope: { kind: 'endpoint' as const, key: 'qq/bot-1' }, permissions: ['feature.toggle', 'iam.manage'] }];
    const rule = (type: string, data: Record<string, unknown>) => protocol.resolveConsoleRpcPermission(type, data);
    const allowed = (type: string, data: Record<string, unknown>) => {
      const resolved = rule(type, data);
      return resolved?.kind === 'exact' && protocol.grantsAllow(scoped, resolved.permission, resolved.target);
    };
    expect(allowed('feature.set-enabled', { level: 'conversation', key: 'qq/bot-1/group:1' })).toBe(true);
    expect(allowed('feature.set-enabled', { level: 'conversation', key: 'qq/bot-2/group:1' })).toBe(false);
    expect(allowed('chat-roles.grant', { level: 'conversation', key: 'qq/bot-1/private:x' })).toBe(true);
    expect(allowed('chat-roles.grant', { level: 'adapter', key: 'qq' })).toBe(false);
    expect(allowed('iam.users.create', { adapter: 'qq', endpointKey: 'bot-1' })).toBe(false);
  });

  it('round-trips escaped conversation keys', async () => {
    const { formatFeatureConversationKey, parseFeatureConversationKey } = await import('../src/index.js');
    const key = formatFeatureConversationKey({ adapter: 'qq', endpointId: 'bot', kind: 'channel', id: 'a/b%:c' });
    expect(key).toBe('qq/bot/channel:a%2Fb%25:c');
    expect(parseFeatureConversationKey(key)).toEqual({ adapter: 'qq', endpointId: 'bot', kind: 'channel', id: 'a/b%:c' });
    expect(parseFeatureConversationKey('qq/bot/channel:a%2fb')).toBeUndefined();
    expect(() => formatFeatureConversationKey({ adapter: 'qq', endpointId: 'b/c', kind: 'group', id: '1' })).toThrow(TypeError);
  });
});
