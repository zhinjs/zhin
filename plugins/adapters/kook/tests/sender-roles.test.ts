import { describe, expect, it, vi } from 'vitest';
import { KookSenderRoleResolver } from '../src/sender-roles.js';

function clientWith(delayMs = 20) {
  const getGuildInfo = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { user_id: 'owner-1' };
  });
  const getRoleList = vi.fn(async () => [{ role_id: 7, permissions: 1 }, { role_id: 8, permissions: 0 }]);
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
    expect(results.map((result) => result.role)).toEqual(['owner', 'admin', undefined]);
  });

  it('treats a failed lookup as an ordinary member and keeps raw role ids out of roles', async () => {
    const client = {
      getGuildInfo: vi.fn(async () => { throw new Error('boom'); }),
      pickGuild: () => ({ getRoleList: vi.fn(async () => { throw new Error('boom'); }) }),
    };
    const resolver = new KookSenderRoleResolver(() => client as never);
    await expect(resolver.resolve({ guildId: 'g1', authorId: 'u1', authorRoles: [7] }))
      .resolves.toEqual({ permissions: ['role:7'] });
  });
});
