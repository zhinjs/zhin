import { describe, expect, it, vi } from 'vitest';
import { resolveTurnCapabilities } from 'zhin.js/adapter';
import kook from '../adapters/kook/index.js';
import { KOOK_ROLE_PERMISSIONS, KookSenderRoleResolver, kookPermissionNames } from '../src/sender-roles.js';

function clientWith(delayMs = 20) {
  const getGuildInfo = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { user_id: 'owner-1' };
  });
  const getRoleList = vi.fn(async () => [{ role_id: 7, name: 'Admins', permissions: 1 | 64 }, { role_id: 8, permissions: 0 }]);
  const client = { getGuildInfo, pickGuild: () => ({ getRoleList }) };
  return { client, getGuildInfo, getRoleList };
}

describe('KookSenderRoleResolver', () => {
  it('shares one guild lookup across concurrent messages on a cold cache', async () => {
    const { client, getGuildInfo, getRoleList } = clientWith();
    const resolver = new KookSenderRoleResolver(() => client as never);
    const results = await Promise.all([
      resolver.resolve({ guildId: 'g1', authorId: 'owner-1', authorRoles: [] }),
      resolver.resolve({ guildId: 'g1', authorId: 'u2', authorRoles: [7] }),
      resolver.resolve({ guildId: 'g1', authorId: 'u3', authorRoles: [8] }),
    ]);
    expect(getGuildInfo).toHaveBeenCalledTimes(1);
    expect(getRoleList).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result?.standing)).toEqual(['owner', 'admin', 'member']);
    expect(results[1]).toEqual({ standing: 'admin', roles: [{ id: '7', name: 'Admins' }], permissions: [...KOOK_ROLE_PERMISSIONS] });
    expect(results[2]).toEqual({ standing: 'member', roles: [{ id: '8' }] });
  });

  it('expands the server owner to every permission and merges the everyone role (role_id 0)', async () => {
    const client = {
      getGuildInfo: vi.fn(async () => ({ user_id: 'owner-1' })),
      pickGuild: () => ({ getRoleList: vi.fn(async () => [
        { role_id: 0, name: '@全体成员', permissions: 2 ** 12 | 2 ** 3 },
        { role_id: 9, name: 'Helpers', permissions: 2 ** 6 },
      ]) }),
    };
    const resolver = new KookSenderRoleResolver(() => client as never);
    await expect(resolver.resolve({ guildId: 'g1', authorId: 'owner-1', authorRoles: [] }))
      .resolves.toEqual({ standing: 'owner', permissions: [...KOOK_ROLE_PERMISSIONS] });
    await expect(resolver.resolve({ guildId: 'g1', authorId: 'u2', authorRoles: [9] }))
      .resolves.toEqual({ standing: 'member', roles: [{ id: '9', name: 'Helpers' }], permissions: ['create_invite', 'kick_members', 'send_messages'] });
    await expect(resolver.resolve({ guildId: 'g1', authorId: 'u3', authorRoles: [] }))
      .resolves.toEqual({ standing: 'member', permissions: ['create_invite', 'send_messages'] });
  });

  it('reports nothing when the guild lookups fail (standing unknown)', async () => {
    const client = {
      getGuildInfo: vi.fn(async () => { throw new Error('boom'); }),
      pickGuild: () => ({ getRoleList: vi.fn(async () => { throw new Error('boom'); }) }),
    };
    const resolver = new KookSenderRoleResolver(() => client as never);
    await expect(resolver.resolve({ guildId: 'g1', authorId: 'u1', authorRoles: [7] }))
      .resolves.toBeUndefined();
  });

  it('still proves admin from the role list when the owner lookup fails', async () => {
    const client = {
      getGuildInfo: vi.fn(async () => { throw new Error('boom'); }),
      pickGuild: () => ({ getRoleList: vi.fn(async () => [{ role_id: 7, permissions: 1 }]) }),
    };
    const resolver = new KookSenderRoleResolver(() => client as never);
    await expect(resolver.resolve({ guildId: 'g1', authorId: 'u1', authorRoles: [7] })).resolves.toMatchObject({ standing: 'admin' });
    await expect(resolver.resolve({ guildId: 'g1', authorId: 'u2', authorRoles: [] })).resolves.toBeUndefined();
  });

  it('reports nothing outside a guild and maps permission bits', async () => {
    const resolver = new KookSenderRoleResolver(() => clientWith(0).client as never);
    await expect(resolver.resolve({ authorId: 'u1', authorRoles: [7] })).resolves.toBeUndefined();
    expect(kookPermissionNames(2 ** 10 | 2 ** 7)).toEqual(['ban_members', 'manage_roles']);
    expect(kookPermissionNames(0)).toEqual([]);
  });

  it('declares standing, roles and permissions for channel conversations', () => {
    const conversation = (kind: 'channel' | 'private') => ({ endpoint: { id: 'e', adapter: 'kook' }, kind, id: '1' });
    expect(resolveTurnCapabilities({ profile: kook.profile!, conversation: conversation('channel') }).get('scene.platformStanding'))
      .toEqual({ standing: true, roles: true, permissions: true });
    expect(resolveTurnCapabilities({ profile: kook.profile!, conversation: conversation('private') }).has('scene.platformStanding')).toBe(false);
  });
});
