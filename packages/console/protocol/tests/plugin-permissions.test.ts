import {
  CONSOLE_BUILTIN_ROLES,
  CONSOLE_PERMISSIONS,
  CONSOLE_PLUGIN_LEVEL_PERMISSIONS,
  buildConsolePluginPermissionCatalog,
  expandPluginPermissions,
  grantsAllow,
  inferConsolePluginPermissionLevel,
  isConsolePermission,
  isConsolePluginPermission,
  normalizeConsolePluginPermissionDeclaration,
  permissionListHoldsPluginPermission,
  pluginPermissionLevelResolver,
  type ConsoleBuiltinRoleName,
  type ConsoleGrant,
} from '../src/index.js';

const grant = (role: ConsoleBuiltinRoleName, scope: ConsoleGrant['scope'] = { kind: 'global' }): ConsoleGrant[] =>
  [{ role, scope, permissions: CONSOLE_BUILTIN_ROLES[role].permissions }];

describe('plugin permission levels (ADR 0049 amendment 2026-11-11)', () => {
  it('infers the level from the action suffix', () => {
    expect(inferConsolePluginPermissionLevel('onebot11:read')).toBe('read');
    expect(inferConsolePluginPermissionLevel('ambient:view')).toBe('read');
    expect(inferConsolePluginPermissionLevel('tool_approvals:read')).toBe('read');
    for (const id of ['ops:approve', 'rss:manage', 'qq:admin', 'onebot11:write', 'agent:config', 'ops:config.write']) {
      expect(inferConsolePluginPermissionLevel(id), id).toBe('manage');
    }
    expect(inferConsolePluginPermissionLevel('tool_approvals:resolve')).toBe('operate');
    expect(inferConsolePluginPermissionLevel('reminder:send')).toBe('operate');
    expect(inferConsolePluginPermissionLevel('ops:config.read')).toBe('read');
  });

  it('accepts only <plugin>:<action> and keeps the level permissions in the catalog', () => {
    for (const id of ['onebot11:read', 'bilibili-live:write', 'tool_approvals:read', 'ops:config.write']) {
      expect(isConsolePluginPermission(id), id).toBe(true);
    }
    for (const id of ['status.view', 'Onebot:read', 'rss:', ':read', 'rss:read:x', 'rss:Read', 'a b:read', 7]) {
      expect(isConsolePluginPermission(id), String(id)).toBe(false);
    }
    for (const permission of Object.values(CONSOLE_PLUGIN_LEVEL_PERMISSIONS)) {
      expect(isConsolePermission(permission)).toBe(true);
      expect(isConsolePluginPermission(permission)).toBe(false);
    }
    expect(CONSOLE_PERMISSIONS.PLUGIN_PERMS_READ).toBe(CONSOLE_PLUGIN_LEVEL_PERMISSIONS.read);
    expect(CONSOLE_PERMISSIONS.PLUGIN_PERMS_OPERATE).toBe(CONSOLE_PLUGIN_LEVEL_PERMISSIONS.operate);
    expect(CONSOLE_PERMISSIONS.PLUGIN_PERMS_MANAGE).toBe(CONSOLE_PLUGIN_LEVEL_PERMISSIONS.manage);
  });

  it('validates declarations', () => {
    expect(normalizeConsolePluginPermissionDeclaration({ id: 'rss:write', level: 'operate', description: ' 编辑订阅 ' }))
      .toEqual({ id: 'rss:write', level: 'operate', description: '编辑订阅' });
    expect(() => normalizeConsolePluginPermissionDeclaration({ id: 'rss.write', level: 'read' })).toThrow(/<plugin>:<action>/u);
    expect(() => normalizeConsolePluginPermissionDeclaration({ id: 'rss:write', level: 'admin' })).toThrow(/level/u);
    expect(() => normalizeConsolePluginPermissionDeclaration({ id: 'rss:write', level: 'read', extra: 1 })).toThrow(/unknown keys/u);
    expect(() => normalizeConsolePluginPermissionDeclaration({ id: 'rss:write', level: 'read', description: '' })).toThrow(/description/u);
  });

  it('builds a catalog: declared levels win, conflicting declarations keep the strictest', () => {
    const catalog = buildConsolePluginPermissionCatalog(
      [
        { owner: 'root/rss', permission: 'rss:write' },
        { owner: 'root/rss', permission: 'rss:read' },
        { owner: 'root/qq', permission: 'qq:read' },
        { owner: 'root/qq', permission: 'status.view' },
      ],
      [
        { owner: 'root/rss', declaration: { id: 'rss:write', level: 'operate', description: '编辑订阅' } },
        { owner: 'root/a', declaration: { id: 'shared:thing', level: 'read' } },
        { owner: 'root/b', declaration: { id: 'shared:thing', level: 'manage' } },
      ],
    );
    expect(catalog.map(entry => entry.id)).toEqual(['qq:read', 'rss:read', 'rss:write', 'shared:thing']);
    expect(catalog.find(entry => entry.id === 'rss:write')).toEqual({
      id: 'rss:write', level: 'operate', declared: true, description: '编辑订阅', owners: ['root/rss'],
    });
    expect(catalog.find(entry => entry.id === 'rss:read')).toMatchObject({ level: 'read', declared: false });
    expect(catalog.find(entry => entry.id === 'shared:thing')).toMatchObject({ level: 'manage', owners: ['root/a', 'root/b'] });
  });

  it('grants plugin permissions to the built-in roles by level', () => {
    const levelOf = pluginPermissionLevelResolver([{ id: 'rss:write', level: 'operate' }]);
    const cases: Array<[string, Record<ConsoleBuiltinRoleName, boolean>]> = [
      ['onebot11:read', { viewer: true, operator: true, admin: true, owner: true }],
      ['tool_approvals:resolve', { viewer: false, operator: true, admin: true, owner: true }],
      ['rss:write', { viewer: false, operator: true, admin: true, owner: true }],
      ['onebot11:write', { viewer: false, operator: false, admin: true, owner: true }],
      ['ops:approve', { viewer: false, operator: false, admin: true, owner: true }],
    ];
    for (const [permission, expected] of cases) {
      for (const role of Object.keys(expected) as ConsoleBuiltinRoleName[]) {
        expect(grantsAllow(grant(role), permission, undefined, levelOf), `${role} ${permission}`).toBe(expected[role]);
      }
    }
    // Without the declaration rss:write infers manage.
    expect(grantsAllow(grant('operator'), 'rss:write')).toBe(false);
  });

  it('honours only global bindings for plugin permissions', () => {
    expect(grantsAllow(grant('admin', { kind: 'adapter', key: 'qq' }), 'qq:read')).toBe(false);
    expect(grantsAllow(grant('admin', { kind: 'adapter', key: 'qq' }), 'qq:read', { kind: 'adapter', adapter: 'qq' })).toBe(false);
    expect(grantsAllow(grant('viewer'), 'qq:read', { kind: 'any' })).toBe(true);
    // Scoped catalog permissions are unchanged.
    expect(grantsAllow(grant('operator', { kind: 'adapter', key: 'qq' }), 'endpoint.operate', { kind: 'adapter', adapter: 'qq' })).toBe(true);
  });

  it('holds explicitly listed ids and expands level grants over a catalog', () => {
    expect(permissionListHoldsPluginPermission(['ops:approve'], 'ops:approve')).toBe(true);
    expect(permissionListHoldsPluginPermission(['status.view'], 'ops:approve')).toBe(false);
    expect(permissionListHoldsPluginPermission(['plugin.perms.read'], 'status.view')).toBe(false);
    const catalog = [{ id: 'a:read', level: 'read' as const }, { id: 'a:approve', level: 'manage' as const }];
    expect(expandPluginPermissions(['plugin.perms.read', 'status.view'], catalog)).toEqual(['a:read', 'plugin.perms.read', 'status.view']);
    expect(expandPluginPermissions(CONSOLE_BUILTIN_ROLES.owner.permissions, catalog)).toEqual(expect.arrayContaining(['a:read', 'a:approve']));
  });
});
