import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseHost } from '@zhin.js/core/runtime';
import { authorizeConsoleRpc, principalAllows, type ConsolePrincipal } from '@zhin.js/host-http';
import { featureScopeTarget } from '@zhin.js/console-protocol';
import {
  ChatRoleService, ChatRoleStore, chatRoleIncludes, chatScopeChain, chatScopeCovers, createConfigChatRoleSource, createPlatformChatRoleSource,
  defineChatRoleTable, platformStandingFromSender,
} from '../../src/instance/chat-roles.js';
import { dispatchChatRolesConsoleRpc } from '../../src/instance/console/chat-roles-rpc.js';
import { sqliteAvailable } from './sqlite-availability.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

function service() {
  const platform = createPlatformChatRoleSource(() => ({ enabled: true, standings: ['owner', 'admin'] }));
  const roles = new ChatRoleService({ store: new ChatRoleStore(), sources: [
    createConfigChatRoleSource({
      resolveOwner: (alias, endpointId) => alias === 'qq' && endpointId === 'bot-1' ? 'boss' : undefined,
      resolveTrusted: (alias, endpointId) => alias === 'qq' && endpointId === 'bot-1' ? ['helper', 'boss'] : [],
      endpoints: () => [['qq', 'bot-1'], ['qq', 'bot-2']],
      globalOwners: () => ['root'], globalTrusted: () => ['friend'],
    }),
    platform,
  ] });
  return { roles, platform };
}

describe('chat roles (ADR 0056)', () => {
  it('orders owner ⊃ admin ⊃ trusted and inherits downward only', () => {
    expect(chatRoleIncludes('owner', 'admin')).toBe(true);
    expect(chatRoleIncludes('admin', 'owner')).toBe(false);
    expect(chatRoleIncludes(undefined, 'trusted')).toBe(false);
    expect(chatScopeChain('qq/bot-1/group:1')).toEqual(['', 'qq', 'qq/bot-1', 'qq/bot-1/group:1']);
    expect(chatScopeCovers('qq', 'qq/bot-1/group:1')).toBe(true);
    expect(chatScopeCovers('qq/bot-1', 'qq')).toBe(false);
  });

  it('resolves stored, configured and mapped roles along the chain', async () => {
    const { roles } = service();
    await roles.store.grant({ level: 'adapter', key: 'qq', adapter: 'qq', userId: 'alice', role: 'admin' });
    await roles.store.grant({ level: 'conversation', key: 'qq/bot-2/group:9', adapter: 'qq', userId: 'alice', role: 'owner' });
    expect(roles.roleAt({ adapter: 'qq', userId: 'alice' }, 'qq/bot-1/group:1')).toBe('admin');
    expect(roles.roleAt({ adapter: 'qq', userId: 'alice' }, 'qq/bot-2/group:9')).toBe('owner');
    expect(roles.roleAt({ adapter: 'qq', userId: 'alice' }, 'qq')).toBe('admin');
    expect(roles.roleAt({ adapter: 'qq', userId: 'alice' }, '')).toBeUndefined();
    expect(roles.roleAt({ adapter: 'tg', userId: 'alice' }, 'tg/x/group:1')).toBeUndefined();
    // Config: account owner / trusted → endpoint; ai.trigger lists → global on every adapter.
    expect(roles.roleAt({ adapter: 'qq', userId: 'boss' }, 'qq/bot-1/group:1')).toBe('owner');
    expect(roles.roleAt({ adapter: 'qq', userId: 'boss' }, 'qq/bot-2/group:1')).toBeUndefined();
    expect(roles.roleAt({ adapter: 'qq', userId: 'helper' }, 'qq/bot-1')).toBe('trusted');
    expect(roles.roleAt({ adapter: 'tg', userId: 'root' }, 'tg/x/group:1')).toBe('owner');
    expect(roles.roleAt({ adapter: 'qq', userId: 'friend' }, '')).toBe('trusted');
    // Mapping: platform admin → admin of the message's conversation only.
    const context = { conversationKey: 'qq/bot-1/group:1', platform: { standing: 'admin' as const } };
    expect(roles.roleAt({ adapter: 'qq', userId: 'mod' }, 'qq/bot-1/group:1', context)).toBe('admin');
    expect(roles.roleAt({ adapter: 'qq', userId: 'mod' }, 'qq/bot-1', context)).toBeUndefined();
    expect(roles.roleAt({ adapter: 'qq', userId: 'mod' }, 'qq/bot-1/group:2', context)).toBeUndefined();
    expect(roles.roleAbove({ adapter: 'qq', userId: 'alice' }, 'qq/bot-2/group:9')).toBe('admin');
    expect(platformStandingFromSender({ roles: ['member', 'owner'] })).toBeUndefined();
    expect(platformStandingFromSender({ platform: { standing: 'admin' } })).toEqual({ standing: 'admin' });
  });

  it('resolves a message sender and lists entries with sources', async () => {
    const { roles, platform } = service();
    const snapshot = { tree: new Map([['root/qq', { instanceKey: 'qq' }]]),
      projections: new Map([['zhin.adapter', { owner: () => 'root/qq', endpointEntry: () => ({ desired: { endpointId: 'bot-1' } }) }]]) } as never;
    const resolved = roles.effectiveRoles(snapshot, { conversation: { kind: 'group', id: '1', endpoint: { id: 'ep' } }, sender: { id: 'mod', platform: { standing: 'admin' } } });
    expect(resolved).toMatchObject({ identity: { adapter: 'qq', userId: 'mod' }, conversationKey: 'qq/bot-1/group:1', role: 'admin',
      entries: [{ source: 'mapping', level: 'conversation' }] });
    // Private chats carry no platform standing.
    expect(roles.effectiveRoles(snapshot, { conversation: { kind: 'private', id: 'mod', endpoint: { id: 'ep' } }, sender: { id: 'mod', platform: { standing: 'admin' } } })?.role).toBeUndefined();
    platform.record({ adapter: 'qq', userId: 'mod' }, { conversationKey: 'qq/bot-1/group:1', platform: { standing: 'owner' } }, 5);
    await roles.store.grant({ level: 'endpoint', key: 'qq/bot-1', adapter: 'qq', userId: 'eve', role: 'trusted' });
    const listed = roles.list('qq/bot-1/group:1').map(entry => `${entry.source}:${entry.role}:${entry.userId}@${entry.key}`);
    expect(listed).toEqual(expect.arrayContaining(['grant:trusted:eve@qq/bot-1', 'config:owner:root@', 'config:trusted:friend@',
      'config:owner:boss@qq/bot-1', 'config:trusted:helper@qq/bot-1', 'mapping:admin:mod@qq/bot-1/group:1']));
    expect(roles.list('qq/bot-2').some(entry => entry.key === 'qq/bot-1')).toBe(false);
    expect(roles.list('qq', true).some(entry => entry.key === 'qq/bot-1/group:1')).toBe(true);
  });

  it.skipIf(!sqliteAvailable)('persists grants in chat_roles and replaces a different role', async () => {
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
    const { roles } = service();
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
    expect(listed.roles.map(entry => `${entry.source}:${entry.userId}`)).toEqual(expect.arrayContaining(['grant:x', 'config:boss']));
    expect((await call('chat-roles.revoke', { level: 'conversation', key: 'qq/bot-1/group:1', adapter: 'qq', userId: 'x' }))!.body.data).toMatchObject({ status: 'saved' });
    expect(roles.store.list()).toEqual([]);
    expect((await dispatchChatRolesConsoleRpc({ type: 'chat-roles.list', data: { level: 'global' } }, {}))!.status).toBe(403);
  });
});
