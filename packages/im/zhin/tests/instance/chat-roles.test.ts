import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseHost } from '@zhin.js/core/runtime';
import { authorizeConsoleRpc, principalAllows, type ConsolePrincipal } from '@zhin.js/host-http';
import { featureScopeTarget } from '@zhin.js/console-protocol';
import {
  ChatRoleService, ChatRoleStore, defineChatRoleTable, type InstanceChatRoleService,
} from '../../src/instance/chat-roles.js';
import { CHAT_ROLES_RPC } from '@zhin.js/console-protocol';
import { dispatchChatRolesConsoleRpc } from '../../src/instance/console/chat-roles-rpc.js';
import { sqliteAvailable } from './sqlite-availability.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function service() {
  const roles: InstanceChatRoleService = new ChatRoleService({ store: new ChatRoleStore() });
  await roles.store.grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'boss', role: 'owner' });
  return { roles };
}

const snapshot = (config: Record<string, unknown> = {}) => ({ tree: new Map([['root/qq', { instanceKey: 'qq' }]]), config: new Map([['root/qq', config]]),
  projections: new Map([['zhin.adapter', { owner: () => 'root/qq', endpointEntry: () => ({ desired: { endpointId: 'bot-1' } }) }]]) }) as never;

describe('chat role storage (ADR 0056)', () => {
  it('resolves a message sender from stored grants only; platform standing grants no zhin role', async () => {
    const { roles } = await service();
    const resolved = roles.effectiveRoles(snapshot(), { conversation: { kind: 'group', id: '1', endpoint: { id: 'ep' } }, sender: { id: 'mod', platform: { standing: 'admin' } } });
    expect(resolved).toEqual({ identity: { adapter: 'qq', userId: 'mod' }, conversationKey: 'qq/bot-1/group:1', entries: [] });
    expect(roles.effectiveRoles(snapshot(), { conversation: { kind: 'group', id: '1', endpoint: { id: 'ep' } }, sender: { id: 'boss' } }))
      .toMatchObject({ role: 'owner', entries: [{ source: 'grant', level: 'endpoint' }] });
    await roles.store.grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'eve', role: 'trusted' });
    const listed = roles.list('qq/bot-1/group:1').map(entry => `${entry.source}:${entry.role}:${entry.userId}@${entry.key}`);
    expect(listed.sort()).toEqual(['grant:owner:boss@qq/bot-1', 'grant:trusted:eve@qq/bot-1']);
    expect(roles.list('qq/bot-2').some(entry => entry.key === 'qq/bot-1')).toBe(false);
    await roles.store.grant({ level: 'conversation', key: 'qq/bot-1/group:1', adapter: 'qq', userId: 'mod', role: 'admin' });
    expect(roles.list('qq', true).some(entry => entry.key === 'qq/bot-1/group:1')).toBe(true);
  });

  it.skipIf(!sqliteAvailable)('persists grants in chat_roles', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-chat-roles-'));
    directories.push(directory);
    const open = async () => {
      const host = createDatabaseHost({ dialect: 'sqlite', filename: join(directory, 'bot.db') });
      defineChatRoleTable(host);
      await host.start();
      return host;
    };
    const first = await open();
    const store = new ChatRoleStore({ database: first });
    await store.load();
    expect(await store.grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'a', role: 'trusted', grantedBy: 'user:1' })).toBe('saved');
    expect(await store.grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'a', role: 'admin' })).toBe('saved');
    expect(await store.grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'a', role: 'admin' })).toBe('unchanged');
    await expect(store.grant({ level: 'endpoint', key: 'qq', adapter: 'qq', userId: 'a', role: 'admin' })).rejects.toThrow(TypeError);
    await expect(store.grant({ level: 'global', key: '', adapter: 'qq', userId: 'a', role: 'master' as never })).rejects.toThrow(TypeError);
    await first.stop();
    const second = await open();
    const reloaded = new ChatRoleStore({ database: second });
    await reloaded.load();
    expect(reloaded.list()).toMatchObject([{ level: 'endpoint', key: 'qq/bot-1', userId: 'a', role: 'admin', source: 'grant' }]);
    expect(await reloaded.revoke({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'a' })).toBe('saved');
    expect(reloaded.list()).toEqual([]);
    await second.stop();
  });
});

describe('chat-roles.* Console RPC', () => {
  const scoped: ConsolePrincipal = { kind: 'user', userId: 'u', username: 'u', roles: ['ops'],
    grants: [{ scope: { kind: 'adapter', key: 'qq' }, permissions: ['iam.manage'] }] } as never;

  it('is iam.manage and an adapter-scoped binding counts for scopes under it', () => {
    expect(authorizeConsoleRpc(scoped, { type: 'chat-roles.grant', data: { level: 'conversation', key: 'qq/bot-1/group:1' } }).allowed).toBe(true);
    expect(authorizeConsoleRpc(scoped, { type: 'chat-roles.grant', data: { level: 'endpoint', key: 'qq/bot-1' } }).allowed).toBe(true);
    expect(authorizeConsoleRpc(scoped, { type: 'chat-roles.grant', data: { level: 'endpoint', key: 'tg/x' } }).allowed).toBe(false);
    expect(authorizeConsoleRpc(scoped, { type: 'chat-roles.grant', data: { level: 'global' } }).allowed).toBe(false);
    // Console accounts stay global even when a payload names an adapter.
    expect(authorizeConsoleRpc(scoped, { type: 'iam.users.create', data: { adapter: 'qq', endpointKey: 'bot-1' } }).allowed).toBe(false);
    expect(principalAllows(scoped, 'iam.manage', featureScopeTarget('conversation', 'qq/bot-1/group:1'))).toBe(true);
  });

  it('lists, grants and revokes with scope and identity validation', async () => {
    const { roles } = await service();
    const events: string[] = [];
    const context = { roles, actor: 'user:u', publishEvent: (type: string) => { events.push(type); },
      authorize: (request: { level: string; key?: string }) => principalAllows(scoped, 'iam.manage', featureScopeTarget(request.level, request.key)) };
    const call = (type: string, data: Record<string, unknown>) => dispatchChatRolesConsoleRpc({ type, data }, context);
    expect(await dispatchChatRolesConsoleRpc({ type: 'feature.list' }, context)).toBeNull();
    const granted = await call('chat-roles.grant', { level: 'conversation', key: 'qq/bot-1/group:1', adapter: 'qq', userId: 'x', role: 'admin' });
    expect(granted).toMatchObject({ status: 200, body: { data: { status: 'saved', entry: { role: 'admin', source: 'grant', grantedBy: 'user:u' } } } });
    expect(events).toEqual(['chat-roles:updated']);
    expect((await call('chat-roles.grant', { level: 'global', adapter: 'qq', userId: 'x', role: 'owner' }))!.status).toBe(403);
    expect((await call('chat-roles.grant', { level: 'endpoint', key: 'qq/bot-1', adapter: 'tg', userId: 'x', role: 'admin' }))!.status).toBe(400);
    expect((await call('chat-roles.grant', { level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'x', role: 'master' }))!.status).toBe(400);
    const listed = (await call('chat-roles.list', { level: 'conversation', key: 'qq/bot-1/group:1' }))!.body.data as { roles: { source: string; userId: string }[] };
    expect(listed.roles.map(entry => `${entry.source}:${entry.userId}`)).toEqual(expect.arrayContaining(['grant:x', 'grant:boss']));
    expect((await call('chat-roles.revoke', { level: 'conversation', key: 'qq/bot-1/group:1', adapter: 'qq', userId: 'x' }))!.body.data).toMatchObject({ status: 'saved' });
    expect(roles.store.list().map(entry => entry.userId)).toEqual(['boss']);
    expect((await dispatchChatRolesConsoleRpc({ type: 'chat-roles.list', data: { level: 'global' } }, {}))!.status).toBe(403);
  });

  it('needs global iam.manage for anything touching owner; scoped callers see inherited entries redacted', async () => {
    const { roles } = await service();
    await roles.store.grant({ level: 'global', key: '', adapter: 'qq', userId: 'root', role: 'owner' });
    await roles.store.grant({ level: 'conversation', key: 'qq/bot-1/group:1', adapter: 'qq', userId: 'king', role: 'owner' });
    const endpointScoped: ConsolePrincipal = { kind: 'user', userId: 'e', username: 'e', roles: ['ops'],
      grants: [{ scope: { kind: 'endpoint', key: 'qq/bot-1' }, permissions: ['iam.manage'] }] } as never;
    const globalAdmin: ConsolePrincipal = { kind: 'user', userId: 'g', username: 'g', roles: ['ops'],
      grants: [{ scope: { kind: 'global' }, permissions: ['iam.manage'] }] } as never;
    const as = (principal: ConsolePrincipal) => (type: string, data: Record<string, unknown>) => dispatchChatRolesConsoleRpc({ type, data }, {
      roles, authorize: request => principalAllows(principal, 'iam.manage', featureScopeTarget(request.level, request.key)) });
    const scopedCall = as(endpointScoped);
    const conversation = { level: 'conversation', key: 'qq/bot-1/group:1', adapter: 'qq' };
    // An endpoint-bound account cannot make itself (or anyone) an owner, even in its own conversation.
    expect(await scopedCall('chat-roles.grant', { ...conversation, userId: 'e', role: 'owner' })).toMatchObject({ status: 403, body: { error: '授予或撤销 owner 需要全局 iam.manage 权限' } });
    // Nor replace or remove an existing owner grant with a lower role.
    expect((await scopedCall('chat-roles.grant', { ...conversation, userId: 'king', role: 'trusted' }))!.status).toBe(403);
    expect((await scopedCall('chat-roles.revoke', { ...conversation, userId: 'king' }))!.status).toBe(403);
    expect(roles.store.get('conversation', 'qq/bot-1/group:1', { adapter: 'qq', userId: 'king' })?.role).toBe('owner');
    // admin / trusted stay scoped.
    expect((await scopedCall('chat-roles.grant', { ...conversation, userId: 'mod', role: 'admin' }))!.status).toBe(200);
    // Inherited from above the binding: role and level only.
    const listed = (await scopedCall('chat-roles.list', { level: 'conversation', key: 'qq/bot-1/group:1' }))!.body.data as { roles: Record<string, unknown>[] };
    expect(listed.roles.find(entry => entry.level === 'global')).toEqual({ level: 'global', key: '', role: 'owner', source: 'grant', redacted: true });
    expect(listed.roles.find(entry => entry.userId === 'boss')).toMatchObject({ level: 'endpoint', role: 'owner' });
    expect(JSON.stringify(listed)).not.toContain('root');
    // A global iam.manage account handles owner anywhere and sees every identity.
    const globalCall = as(globalAdmin);
    expect((await globalCall('chat-roles.grant', { ...conversation, userId: 'king', role: 'admin' }))!.status).toBe(200);
    expect((await globalCall('chat-roles.grant', { level: 'global', adapter: 'qq', userId: 'root2', role: 'owner' }))!.status).toBe(200);
    expect(JSON.stringify((await globalCall('chat-roles.list', { level: 'conversation', key: 'qq/bot-1/group:1' }))!.body)).toContain('root');
  });

  it('answers 503 instead of saved when the database cannot persist grants', async () => {
    const database = { dialect: 'memory', started: true, models: new Map() } as never;
    const roles: InstanceChatRoleService = new ChatRoleService({ store: new ChatRoleStore({ database }) });
    const reply = await dispatchChatRolesConsoleRpc({ type: 'chat-roles.grant', data: { level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'x', role: 'admin' } },
      { roles, authorize: () => true });
    expect(reply).toMatchObject({ status: 503, body: { success: false, code: 'chat-roles-unpersisted' } });
    expect(roles.store.list()).toEqual([]);
  });

  it('has no mapping RPC: chat-roles.mappings / set-mappings were removed', async () => {
    const { roles } = await service();
    expect(Object.values(CHAT_ROLES_RPC).sort()).toEqual(['chat-roles.grant', 'chat-roles.imports.list', 'chat-roles.imports.resolve', 'chat-roles.list', 'chat-roles.revoke']);
    // ADR 0060: the import RPCs belong to their own dispatcher (global iam.manage).
    expect(await dispatchChatRolesConsoleRpc({ type: 'chat-roles.imports.list' }, { roles, authorize: () => true })).toBeNull();
    for (const type of ['chat-roles.mappings', 'chat-roles.set-mappings']) {
      expect(await dispatchChatRolesConsoleRpc({ type, data: { level: 'conversation', key: 'qq/bot-1/group:1' } }, { roles, authorize: () => true })).toBeNull();
      expect(authorizeConsoleRpc(scoped, { type, data: { level: 'conversation', key: 'qq/bot-1/group:1' } }).allowed).toBe(false);
    }
  });
});

describe('owner approval address (ADR 0056 §2)', () => {
  it('asks only a global owner with an identity on the adapter, never an account owner', async () => {
    const { createFeatureHost } = await import('../../src/instance/feature-host-installer.js');
    const database = { dialect: 'memory', started: false, models: new Map(), define: () => undefined } as never;
    const host = createFeatureHost({ database, hostConfig: {}, snapshots: () => ({ acquire: () => { throw new Error('unused'); } }) as never });
    // `new ChatRoleStore({ database })` refuses writes it cannot persist: seed like the in-memory migration does.
    host.roles.store.seed([
      { level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'account-owner', role: 'owner' },
      { level: 'global', key: '', adapter: 'tg', userId: 'tg-root', role: 'owner' },
    ]);
    expect(host.resolveEndpointOwner('qq', 'bot-1')).toBeUndefined();
    host.roles.store.seed([{ level: 'global', key: '', adapter: 'qq', userId: 'root', role: 'owner' }]);
    expect(host.resolveEndpointOwner('qq', 'bot-1')).toBe('root');
  });
});
