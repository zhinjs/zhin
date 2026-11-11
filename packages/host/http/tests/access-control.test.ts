import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONSOLE_RPC_PERMISSIONS, resolveConsoleRpcPermission } from '@zhin.js/console-protocol';
import {
  authorizeConsoleHttp,
  authorizeConsoleRpc,
  authorizeConsoleWebSocket,
  globalPermissions,
  pluginRpcWriteAllowed,
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
    expect(await registry.authenticate('')).toEqual({ kind: 'bootstrap', open: true });
    expect(registry.resolveAccess('').unrestricted).toBe(true);
    // An open Host is not an explicit credential.
    expect(registry.resolve('')).toBeNull();
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
    expect(plugin.allowed).toBe(true);
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
    // Non-scoped permissions need a global binding even when the role carries them.
    expect(authorizeConsoleRpc(adapterOperator, { type: 'ping' }).allowed).toBe(false);
    expect(authorizeConsoleRpc(adapterOperator, { type: 'endpoint.list' }).allowed).toBe(true);
    const endpointOperator = userPrincipal('operator', { kind: 'endpoint', key: 'qq/bot-1' });
    expect(authorizeConsoleRpc(endpointOperator, send('qq', 'bot-1')).allowed).toBe(true);
    expect(authorizeConsoleRpc(endpointOperator, send('qq', 'bot-2')).allowed).toBe(false);
    expect(authorizeConsoleRpc(endpointOperator, { type: 'plugin.root/qq.endpoint-stop', data: { id: 'bot-1' } }).allowed).toBe(false);
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
    expect(authorizeConsoleWebSocket(userPrincipal('operator'), '/onebot/v11')).toBe(false);
    expect(authorizeConsoleWebSocket(userPrincipal('admin'), '/onebot/v11')).toBe(true);
  });

  it('audits only RPC type and key names, never values', () => {
    const detail = rpcAuditDetail({ type: 'env:save', requestId: 1, filename: '.env', content: 'SECRET=value', data: { token: 'x' } });
    expect(detail).toEqual({ type: 'env:save', keys: ['content', 'filename', 'token'] });
    expect(JSON.stringify(detail)).not.toContain('SECRET');
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
