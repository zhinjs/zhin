import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONSOLE_RPC_PERMISSIONS, resolveConsoleRpcPermission } from '@zhin.js/console-protocol';
import {
  authorizeConsoleHttp,
  authorizeConsoleRpc,
  authorizeConsoleWebSocket,
  globalPermissions,
  pluginRpcWriteAllowed,
  requestMeta,
  rpcAuditDetail,
  type ConsoleAccessProvider,
} from '../src/access-control.js';
import { TokenRegistry } from '../src/token-registry.js';
import { VIEWER, userPrincipal } from './fixtures/principals.js';

const SRC = join(import.meta.dirname, '..', 'src');

function provider(initialized: boolean, sessions: Record<string, ReturnType<typeof userPrincipal>> = {}): ConsoleAccessProvider & { set(value: boolean): void } {
  let state = initialized;
  return {
    set(value) { state = value; },
    initialized: () => state,
    authenticate: async token => sessions[token] ?? null,
  };
}

describe('TokenRegistry (ADR 0049 §1)', () => {
  it('is open without credentials and before setup', async () => {
    const registry = new TokenRegistry();
    expect(registry.hasAnyToken()).toBe(false);
    // Only an explicit in-process caller (tests, embedding) or a loopback peer gets the open Host.
    expect(await registry.authenticate('', { inProcess: true })).toEqual({ kind: 'bootstrap', open: true });
    // An unknown peer address is not local.
    expect(await registry.authenticate('')).toBeNull();
    expect(await registry.authenticate('', requestMeta(new Request('http://h/')))).toBeNull();
    expect(await registry.authenticate('', requestMeta(new Request('http://h/'), undefined, { inProcess: true }))).toEqual({ kind: 'bootstrap', open: true });
    expect(registry.resolveAccess('').unrestricted).toBe(true);
    // An open Host is not an explicit credential.
    expect(registry.resolve('')).toBeNull();
  });

  it('opens an open Host to loopback peers without proxy hops only', async () => {
    const registry = new TokenRegistry();
    const open = { kind: 'bootstrap', open: true };
    expect(await registry.authenticate('', requestMeta(new Request('http://h/'), '127.0.0.1'))).toEqual(open);
    expect(await registry.authenticate('', requestMeta(new Request('http://h/'), '::1'))).toEqual(open);
    expect(await registry.authenticate('', requestMeta(new Request('http://h/'), '::ffff:127.0.0.1'))).toEqual(open);
    expect(await registry.authenticate('', requestMeta(new Request('http://h/'), '192.168.1.20'))).toBeNull();
    const proxied = new Request('http://h/', { headers: { 'x-forwarded-for': '203.0.113.9' } });
    expect(await registry.authenticate('', requestMeta(proxied, '127.0.0.1'))).toBeNull();
    // A bootstrap token or a finished setup is never affected.
    const withToken = new TokenRegistry({ primaryToken: 'boot' });
    expect(await withToken.authenticate('boot', requestMeta(new Request('http://h/'), '192.168.1.20'))).toEqual({ kind: 'bootstrap', open: false });
  });

  it('accepts http.token only until an enabled owner exists', async () => {
    const registry = new TokenRegistry({ primaryToken: 'boot' });
    const backend = provider(false, { 'user-session': VIEWER });
    registry.useAccessProvider(backend);
    expect(await registry.authenticate('boot')).toEqual({ kind: 'bootstrap', open: false });
    expect(registry.resolve('boot')).toBe('full');
    expect(await registry.authenticate('nope')).toBeNull();
    backend.set(true);
    expect(await registry.authenticate('boot')).toBeNull();
    expect(registry.resolve('boot')).toBeNull();
    expect(await registry.authenticate('user-session')).toBe(VIEWER);
    expect(registry.accessFor(VIEWER)).toMatchObject({ unrestricted: false, roles: ['viewer'] });
    expect(registry.accessFor(VIEWER).permissions).toContain('status.view');
  });

  it('locks a token-less Host once setup is done, and never throws from a broken backend', async () => {
    const registry = new TokenRegistry();
    registry.useAccessProvider({ initialized: () => true, authenticate: async () => { throw new Error('db down'); } });
    expect(registry.hasAnyToken()).toBe(true);
    expect(await registry.authenticate('anything')).toBeNull();
    expect(await registry.authenticate('')).toBeNull();
  });

  it('authorizes MCP/A2A bearers by permission without opening them to an open Host', async () => {
    const registry = new TokenRegistry({ primaryToken: 'boot' });
    const backend = provider(false, { admin: userPrincipal('admin'), viewer: VIEWER });
    registry.useAccessProvider(backend);
    expect(await registry.authorizeBearer('boot', 'mcp.access')).toBe(true);
    backend.set(true);
    expect(await registry.authorizeBearer('boot', 'mcp.access')).toBe(false);
    expect(await registry.authorizeBearer('admin', 'mcp.access')).toBe(true);
    expect(await registry.authorizeBearer('viewer', 'a2a.access')).toBe(false);
    expect(await new TokenRegistry().authorizeBearer('x', 'mcp.access')).toBe(false);
  });

  it('refuses a second, different provider', () => {
    const registry = new TokenRegistry();
    const dispose = registry.useAccessProvider(provider(false));
    expect(() => registry.useAccessProvider(provider(false))).toThrow(/already installed/u);
    dispose();
    expect(() => registry.useAccessProvider(provider(false))).not.toThrow();
  });
});

describe('access control decisions', () => {
  it('denies unmapped RPC to every user and maps plugin writes separately', () => {
    const owner = userPrincipal('owner');
    expect(authorizeConsoleRpc(owner, { type: 'something.new' })).toMatchObject({ allowed: false, code: 'unmapped' });
    expect(authorizeConsoleRpc(owner, { type: 'iam.users.create' })).toMatchObject({ allowed: true, write: true });
    expect(authorizeConsoleRpc(userPrincipal('admin'), { type: 'iam.users.create' })).toMatchObject({ allowed: false, code: 'forbidden' });
    expect(authorizeConsoleRpc(userPrincipal('admin'), { type: 'iam.users.list' })).toMatchObject({ allowed: true, write: false });
    const plugin = authorizeConsoleRpc(VIEWER, { type: 'plugin.root/rss.status' });
    expect(plugin).toMatchObject({ allowed: true, delegated: true, write: false });
    // Delegation needs a mapped plugin type; bootstrap keeps its own rules.
    expect(authorizeConsoleRpc(VIEWER, { type: 'plugin.not-root.status' })).toMatchObject({ allowed: false, code: 'unmapped' });
    expect(authorizeConsoleRpc({ kind: 'bootstrap', open: false }, { type: 'plugin.root/rss.status' })).toMatchObject({ allowed: false, code: 'setup_required' });
    expect(pluginRpcWriteAllowed(VIEWER, resolveConsoleRpcPermission('plugin.root/rss.status'))).toBe(false);
    expect(pluginRpcWriteAllowed(userPrincipal('operator'), resolveConsoleRpcPermission('plugin.root/rss.add'))).toBe(true);
    expect(authorizeConsoleRpc({ kind: 'bootstrap', open: true }, { type: 'something.new' }).allowed).toBe(true);
  });

  it('checks adapter / endpoint scope for scoped permissions only', () => {
    const adapterOperator = userPrincipal('operator', { kind: 'adapter', key: 'qq' });
    const send = (adapter: string, endpointKey: string) => ({ type: 'endpoint.send_message', data: { adapter, endpointKey } });
    expect(authorizeConsoleRpc(adapterOperator, send('qq', 'bot-1')).allowed).toBe(true);
    expect(authorizeConsoleRpc(adapterOperator, send('tg', 'bot-1')).allowed).toBe(false);
    expect(authorizeConsoleRpc(adapterOperator, { type: 'feature.set-enabled', data: { plugin: 'rss', level: 'endpoint', key: 'qq/bot-1' } }).allowed).toBe(true);
    expect(authorizeConsoleRpc(adapterOperator, { type: 'feature.set-enabled', data: { plugin: 'rss', level: 'global' } }).allowed).toBe(false);
    // The global switch is plugin lifecycle (plugin.manage): a global operator's feature.toggle is not enough.
    const operator = userPrincipal('operator');
    expect(authorizeConsoleRpc(operator, { type: 'feature.set-enabled', data: { plugin: 'rss', level: 'adapter', key: 'qq' } }).allowed).toBe(true);
    expect(authorizeConsoleRpc(operator, { type: 'feature.set-enabled', data: { plugin: 'rss', level: 'global' } })).toMatchObject({ allowed: false, code: 'forbidden' });
    expect(authorizeConsoleRpc(operator, { type: 'plugin:set-enabled', instanceKey: 'rss', enabled: false })).toMatchObject({ allowed: false, code: 'forbidden' });
    expect(authorizeConsoleRpc(userPrincipal('admin'), { type: 'feature.set-enabled', data: { plugin: 'rss', level: 'global' } })).toMatchObject({ allowed: true, write: true });
    expect(authorizeConsoleRpc(userPrincipal('admin'), { type: 'plugin:set-enabled', instanceKey: 'rss', enabled: false })).toMatchObject({ allowed: true, write: true });
    // Non-scoped permissions need a global binding even when the role carries them.
    expect(authorizeConsoleRpc(adapterOperator, { type: 'ping' }).allowed).toBe(false);
    expect(authorizeConsoleRpc(adapterOperator, { type: 'endpoint.list' }).allowed).toBe(true);
    const endpointOperator = userPrincipal('operator', { kind: 'endpoint', key: 'qq/bot-1' });
    expect(authorizeConsoleRpc(endpointOperator, send('qq', 'bot-1')).allowed).toBe(true);
    expect(authorizeConsoleRpc(endpointOperator, send('qq', 'bot-2')).allowed).toBe(false);
    // Plugin RPC is delegated to the plugin dispatcher, which checks the method's permissions.
    expect(authorizeConsoleRpc(endpointOperator, { type: 'plugin.root/qq.endpoint-stop', data: { id: 'bot-1' } }))
      .toMatchObject({ allowed: true, delegated: true, write: true });
    expect(globalPermissions(endpointOperator)).toEqual([]);
  });

  it('gates HTTP and WebSocket by principal kind', () => {
    expect(authorizeConsoleHttp(undefined, 'POST', '/auth/login')).toMatchObject({ allowed: true });
    expect(authorizeConsoleHttp(undefined, 'GET', '/system/status')).toMatchObject({ allowed: false, status: 401 });
    expect(authorizeConsoleHttp({ kind: 'bootstrap', open: false }, 'GET', '/system/status')).toMatchObject({ allowed: false, code: 'setup_required' });
    expect(authorizeConsoleHttp({ kind: 'bootstrap', open: false }, 'POST', '/auth/setup')).toMatchObject({ allowed: true });
    expect(authorizeConsoleHttp(VIEWER, 'GET', '/unregistered')).toMatchObject({ allowed: false, status: 403 });
    expect(authorizeConsoleWebSocket(VIEWER, '/sandbox')).toBe(false);
    expect(authorizeConsoleWebSocket(userPrincipal('operator'), '/sandbox')).toBe(true);
    // Per-endpoint sandbox sockets inherit the `/sandbox` rule.
    expect(authorizeConsoleWebSocket(userPrincipal('operator'), '/sandbox/bot%201')).toBe(true);
    expect(authorizeConsoleWebSocket(VIEWER, '/sandbox/bot-2')).toBe(false);
    expect(authorizeConsoleWebSocket(userPrincipal('operator'), '/sandboxed')).toBe(false);
    // Non-Console sockets are never host-authenticated for users (adapters use `auth: 'protocol'`).
    expect(authorizeConsoleWebSocket(userPrincipal('operator'), '/onebot/v11')).toBe(false);
    expect(authorizeConsoleWebSocket(userPrincipal('owner'), '/onebot/v11')).toBe(false);
    expect(authorizeConsoleWebSocket({ kind: 'bootstrap', open: false }, '/onebot/v11')).toBe(false);
    expect(authorizeConsoleWebSocket({ kind: 'bootstrap', open: false }, '/sandbox')).toBe(false);
    expect(authorizeConsoleWebSocket({ kind: 'bootstrap', open: true }, '/sandbox')).toBe(true);
  });

  it('audits only RPC type and key names, never values', () => {
    const detail = rpcAuditDetail({ type: 'env:save', requestId: 1, filename: '.env', content: 'SECRET=value', data: { token: 'x' } });
    expect(detail).toEqual({ type: 'env:save', keys: ['content', 'filename', 'token'], file: '.env', mode: 'replace' });
    expect(JSON.stringify(detail)).not.toContain('value');
    expect(JSON.stringify(detail)).not.toContain('SECRET');
  });

  it('records the env file and variable names of env:reveal / env:save, never values (issue #1250)', () => {
    const reveal = rpcAuditDetail(
      { type: 'env:reveal', requestId: 1, filename: '.env', key: 'BOT_TOKEN' },
      { success: true, data: { file: '.env', key: 'BOT_TOKEN', value: 'fake-revealed-secret' } },
    );
    expect(reveal).toEqual({ type: 'env:reveal', keys: ['filename', 'key'], file: '.env', key: 'BOT_TOKEN' });
    const save = rpcAuditDetail({
      type: 'env:save', requestId: 2, filename: '.env.production',
      changes: [{ key: 'PORT', value: 'fake-port-value' }, { key: 'OLD', delete: true }, { value: 'fake-orphan' }],
    });
    expect(save).toEqual({ type: 'env:save', keys: ['changes', 'filename'], file: '.env.production', set: ['PORT'], deleted: ['OLD'] });
    expect(JSON.stringify([reveal, save])).not.toMatch(/fake-/u);
  });

  it('env:reveal needs both env permissions and is audited as a write', () => {
    const message = { type: 'env:reveal', filename: '.env', key: 'BOT_TOKEN' };
    expect(authorizeConsoleRpc(userPrincipal('owner'), message)).toMatchObject({ allowed: true, write: true, permission: 'ops.env.write' });
    expect(authorizeConsoleRpc(userPrincipal('admin'), message)).toMatchObject({ allowed: true, write: true });
    for (const role of ['viewer', 'operator'] as const) {
      expect(authorizeConsoleRpc(userPrincipal(role), message)).toMatchObject({ allowed: false, code: 'forbidden' });
    }
    const only = (permission: string) => ({ ...userPrincipal('viewer'), grants: [{ role: 'x', scope: { kind: 'global' as const }, permissions: [permission] }] });
    expect(authorizeConsoleRpc(only('ops.env.read'), message)).toMatchObject({ allowed: false, error: '缺少权限 ops.env.write', reason: 'insufficient_permission' });
    // The second permission (`alsoRequires`) carries a denial reason as well, for the audit `detail.reason`.
    expect(authorizeConsoleRpc(only('ops.env.write'), message)).toMatchObject({ allowed: false, error: '缺少权限 ops.env.read', reason: 'insufficient_permission' });
    expect(authorizeConsoleRpc(only('ops.env.read'), { type: 'env:get', filename: '.env' })).toMatchObject({ allowed: true, write: false });
  });
});

describe('RPC permission coverage', () => {
  it('registers a permission for every RPC type the Host dispatchers handle', () => {
    const files = [
      join(SRC, 'console-rpc.ts'),
      join(SRC, 'console-rpc-handlers.ts'),
      join(SRC, 'console-plugin-rpc.ts'),
      ...readdirSync(join(SRC, 'console-rpc-extended')).map(name => join(SRC, 'console-rpc-extended', name)),
    ];
    const types = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/case '([a-z][a-z0-9_.:-]+)'/gu)) {
        // Inner switches over content/segment kinds are not RPC types.
        if (/[.:]/u.test(match[1]!)) types.add(match[1]!);
      }
    }
    expect(types.size).toBeGreaterThan(40);
    const missing = [...types].filter(type => !Object.hasOwn(CONSOLE_RPC_PERMISSIONS, type));
    expect(missing).toEqual([]);
  });
});

describe('plugin permissions by level (ADR 0049 amendment 2026-11-11)', () => {
  const catalog = [
    { id: 'onebot11:read', level: 'read', declared: false, owners: ['root/onebot11'] },
    { id: 'rss:write', level: 'operate', declared: true, owners: ['root/rss'] },
    { id: 'ops:approve', level: 'manage', declared: false, owners: ['root'] },
  ] as const;
  const registry = () => {
    const value = new TokenRegistry();
    value.usePluginPermissions(() => catalog);
    return value;
  };

  it('expands built-in role grants over the catalog for page gating', () => {
    const tokens = registry();
    expect(tokens.accessFor(VIEWER).permissions).toEqual(expect.arrayContaining(['onebot11:read']));
    expect(tokens.accessFor(VIEWER).permissions).not.toContain('rss:write');
    const operator = tokens.accessFor(userPrincipal('operator')).permissions;
    expect(operator).toEqual(expect.arrayContaining(['onebot11:read', 'rss:write']));
    expect(operator).not.toContain('ops:approve');
    expect(tokens.accessFor(userPrincipal('admin')).permissions).toEqual(expect.arrayContaining(['onebot11:read', 'rss:write', 'ops:approve']));
    expect(globalPermissions(userPrincipal('operator'), catalog)).toEqual(operator);
    expect(tokens.pluginPermissionLevels()('rss:write')).toBe('operate');
  });

  it('keeps the global owner unrestricted, but not an owner token narrowed below the catalog', () => {
    const tokens = registry();
    expect(tokens.accessFor(userPrincipal('owner')).unrestricted).toBe(true);
    const narrowed = {
      ...userPrincipal('owner'),
      kind: 'api-token' as const,
      grants: [{ role: 'owner', scope: { kind: 'global' as const }, permissions: ['status.view', 'onebot11:read'] }],
    };
    const access = tokens.accessFor(narrowed);
    expect(access.unrestricted).toBe(false);
    expect(access.permissions).toEqual(['onebot11:read', 'status.view']);
  });

  it('ignores plugin permissions held through adapter or endpoint bindings', () => {
    const tokens = registry();
    const scoped = userPrincipal('admin', { kind: 'adapter', key: 'onebot11' });
    expect(tokens.accessFor(scoped).permissions).not.toContain('onebot11:read');
  });

  it('falls back to an empty catalog and refuses a second source', () => {
    const tokens = new TokenRegistry();
    expect(tokens.pluginPermissions()).toEqual([]);
    expect(tokens.accessFor(VIEWER).permissions).not.toContain('onebot11:read');
    const dispose = tokens.usePluginPermissions(() => catalog);
    expect(() => tokens.usePluginPermissions(() => [])).toThrow(/already installed/u);
    dispose();
    tokens.usePluginPermissions(() => { throw new Error('snapshot gone'); });
    expect(tokens.pluginPermissions()).toEqual([]);
  });
});
