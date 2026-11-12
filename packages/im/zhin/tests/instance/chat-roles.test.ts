import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseHost } from '@zhin.js/core/runtime';
import { authorizeConsoleRpc, principalAllows, type ConsolePrincipal } from '@zhin.js/host-http';
import { featureScopeTarget } from '@zhin.js/console-protocol';
import {
  ChatRoleMappingStore, ChatRoleService, ChatRoleStore, createMappingChatRoleSource, defineChatRoleTable, type InstanceChatRoleService,
} from '../../src/instance/chat-roles.js';
import { dispatchChatRolesConsoleRpc } from '../../src/instance/console/chat-roles-rpc.js';
import { sqliteAvailable } from './sqlite-availability.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function service() {
  const mappings = new ChatRoleMappingStore();
  const platform = createMappingChatRoleSource({ conversationLayer: key => mappings.layer(key) });
  const roles: InstanceChatRoleService = new ChatRoleService({ store: new ChatRoleStore(), sources: [platform] });
  await roles.store.grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'boss', role: 'owner' });
  return { roles, platform, mappings };
}

const snapshot = (config: Record<string, unknown> = {}) => ({ tree: new Map([['root/qq', { instanceKey: 'qq' }]]), config: new Map([['root/qq', config]]),
  projections: new Map([['zhin.adapter', { owner: () => 'root/qq', endpointEntry: () => ({ desired: { endpointId: 'bot-1' } }) }]]) }) as never;

describe('chat role storage (ADR 0056)', () => {
  it('resolves a message sender and lists stored and mapped entries with sources', async () => {
    const { roles, platform } = await service();
    const resolved = roles.effectiveRoles(snapshot(), { conversation: { kind: 'group', id: '1', endpoint: { id: 'ep' } }, sender: { id: 'mod', platform: { standing: 'admin' } } });
    expect(resolved).toMatchObject({ identity: { adapter: 'qq', userId: 'mod' }, conversationKey: 'qq/bot-1/group:1', role: 'admin',
      entries: [{ source: 'mapping', level: 'conversation', detail: 'mapping:default standing=admin|owner' }] });
    // Private chats carry no platform standing.
    expect(roles.effectiveRoles(snapshot(), { conversation: { kind: 'private', id: 'mod', endpoint: { id: 'ep' } }, sender: { id: 'mod', platform: { standing: 'admin' } } })?.role).toBeUndefined();
    platform.record({ adapter: 'qq', userId: 'mod' }, { conversationKey: 'qq/bot-1/group:1', platform: { standing: 'owner' }, snapshot: snapshot() }, 5);
    await roles.store.grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'eve', role: 'trusted' });
    const listed = roles.list('qq/bot-1/group:1').map(entry => `${entry.source}:${entry.role}:${entry.userId}@${entry.key}`);
    expect(listed).toEqual(expect.arrayContaining(['grant:trusted:eve@qq/bot-1', 'grant:owner:boss@qq/bot-1', 'mapping:admin:mod@qq/bot-1/group:1']));
    expect(roles.list('qq/bot-2').some(entry => entry.key === 'qq/bot-1')).toBe(false);
    expect(roles.list('qq', true).some(entry => entry.key === 'qq/bot-1/group:1')).toBe(true);
  });

  it('stores conversation mapping rules with validation and revisions; trusted / owner only here', async () => {
    const { roles, mappings } = await service();
    const key = 'qq/bot-1/group:1';
    await expect(mappings.set({ key: 'qq/bot-1', mappings: [] })).rejects.toThrow(TypeError);
    await expect(mappings.set({ key, mappings: [{ match: {}, grant: 'admin' }] })).rejects.toThrow(/roles\.mappings\[0\]/u);
    expect(await mappings.set({ key, mappings: [{ match: { role: ['42'] }, grant: 'trusted' }], expectedRevision: 0, updatedBy: 'user:u' }))
      .toMatchObject({ status: 'saved', value: { revision: 1, inherit: true, updatedBy: 'user:u' } });
    expect((await mappings.set({ key, mappings: [], expectedRevision: 0 })).status).toBe('conflict');
    const context = { conversationKey: key, platform: { standing: 'member' as const, roles: [{ id: '42' }] }, snapshot: snapshot() };
    expect(roles.roleAt({ adapter: 'qq', userId: 'x' }, key, context)).toBe('trusted');
    expect(roles.roleAt({ adapter: 'qq', userId: 'x' }, 'qq/bot-1/group:2', { ...context, conversationKey: 'qq/bot-1/group:2' })).toBeUndefined();
    // inherit:false drops the default rule for this conversation only.
    expect((await mappings.set({ key, mappings: [], inherit: false, expectedRevision: 1 })).status).toBe('saved');
    expect(roles.roleAt({ adapter: 'qq', userId: 'mod' }, key, { ...context, platform: { standing: 'admin' } })).toBeUndefined();
    expect((await mappings.set({ key, mappings: [] })).status).toBe('saved');
    expect(mappings.get(key)).toBeUndefined();
    expect(roles.roleAt({ adapter: 'qq', userId: 'mod' }, key, { ...context, platform: { standing: 'admin' } })).toBe('admin');
  });

  it.skipIf(!sqliteAvailable)('persists grants in chat_roles and mapping rules in chat_role_mappings', async () => {
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
    const mappings = new ChatRoleMappingStore({ database: first });
    await store.load(); await mappings.load();
    expect(await store.grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'a', role: 'trusted', grantedBy: 'user:1' })).toBe('saved');
    expect(await store.grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'a', role: 'admin' })).toBe('saved');
    expect(await store.grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'a', role: 'admin' })).toBe('unchanged');
    await expect(store.grant({ level: 'endpoint', key: 'qq', adapter: 'qq', userId: 'a', role: 'admin' })).rejects.toThrow(TypeError);
    await expect(store.grant({ level: 'global', key: '', adapter: 'qq', userId: 'a', role: 'master' as never })).rejects.toThrow(TypeError);
    await mappings.set({ key: 'qq/bot-1/group:1', mappings: [{ match: { standing: ['owner'] }, grant: 'owner' }], inherit: false });
    await first.stop();
    const second = await open();
    const reloaded = new ChatRoleStore({ database: second });
    const reloadedMappings = new ChatRoleMappingStore({ database: second });
    await reloaded.load(); await reloadedMappings.load();
    expect(reloaded.list()).toMatchObject([{ level: 'endpoint', key: 'qq/bot-1', userId: 'a', role: 'admin', source: 'grant' }]);
    expect(reloadedMappings.layer('qq/bot-1/group:1')).toEqual({ level: 'conversation', rules: [{ match: { standing: ['owner'] }, grant: 'owner' }], inherit: false });
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

  it('reads every mapping layer and writes only the conversation layer', async () => {
    const { roles, mappings } = await service();
    const events: string[] = [];
    const live = snapshot({ roles: { mappings: [{ match: { standing: ['admin', 'owner'] }, grant: 'none' }, { match: { standing: ['owner'] }, grant: 'admin' }] } });
    const context = { roles, mappings, actor: 'user:u', snapshot: () => live, publishEvent: (type: string) => { events.push(type); },
      authorize: (request: { level: string; key?: string }) => principalAllows(scoped, 'iam.manage', featureScopeTarget(request.level, request.key)) };
    const call = (type: string, data: Record<string, unknown>) => dispatchChatRolesConsoleRpc({ type, data }, context);
    const key = 'qq/bot-1/group:1';
    const read = (await call('chat-roles.mappings', { level: 'conversation', key }))!;
    expect(read.status).toBe(200);
    expect(read.body.data).toEqual({
      layers: [{ level: 'default', rules: [{ match: { standing: ['admin', 'owner'] }, grant: 'admin' }], inherit: true },
        { level: 'adapter', rules: [{ match: { standing: ['admin', 'owner'] }, grant: 'none' }, { match: { standing: ['owner'] }, grant: 'admin' }], inherit: true }],
      effective: [{ match: { standing: ['owner'] }, grant: 'admin', level: 'adapter' }],
    });
    expect((await call('chat-roles.set-mappings', { level: 'endpoint', key: 'qq/bot-1', mappings: [] }))!.status).toBe(400);
    expect((await call('chat-roles.mappings', { level: 'global' }))!.status).toBe(403);
    expect((await dispatchChatRolesConsoleRpc({ type: 'chat-roles.mappings', data: { level: 'global' } }, { ...context, authorize: () => true }))!.status).toBe(400);
    expect((await call('chat-roles.set-mappings', { level: 'conversation', key, mappings: [{ match: { standing: ['member'] }, grant: 'boss' }] }))!.body.data)
      .toMatchObject({ status: 'invalid', error: expect.stringContaining('grant') });
    const saved = (await call('chat-roles.set-mappings', { level: 'conversation', key, expectedRevision: 0,
      mappings: [{ match: { permission: ['ban_members'] }, grant: 'trusted' }] }))!;
    expect(saved.body.data).toMatchObject({ status: 'saved', layer: { level: 'conversation', revision: 1, updatedBy: 'user:u' } });
    expect(events).toEqual(['chat-roles:updated']);
    expect((await call('chat-roles.set-mappings', { level: 'conversation', key, expectedRevision: 0, mappings: [] }))!.body.data).toMatchObject({ status: 'conflict' });
    expect(((await call('chat-roles.mappings', { level: 'conversation', key }))!.body.data as { effective: unknown[] }).effective).toEqual([
      { match: { standing: ['owner'] }, grant: 'admin', level: 'adapter' }, { match: { permission: ['ban_members'] }, grant: 'trusted', level: 'conversation' }]);
    // Scoped bindings: another adapter's conversation is out of scope.
    expect((await call('chat-roles.set-mappings', { level: 'conversation', key: 'tg/x/group:1', mappings: [] }))!.status).toBe(403);
  });
});
