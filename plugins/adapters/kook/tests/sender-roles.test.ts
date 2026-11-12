import { describe, expect, it, vi } from 'vitest';
import { resolveTurnCapabilities } from 'zhin.js/adapter';
import kook from '../adapters/kook/index.js';
import { KookSenderRoleResolver, kookPermissionNames } from '../src/sender-roles.js';

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
    expect(results[1]).toEqual({ standing: 'admin', roles: [{ id: '7', name: 'Admins' }], permissions: ['administrator', 'kick_members'] });
    expect(results[2]).toEqual({ standing: 'member', roles: [{ id: '8' }] });
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
