import { describe, expect, it, vi } from 'vitest';
import blacklist from '../agents/kook/skills/kook/tools/blacklist/index.js';
import grantRole from '../agents/kook/skills/kook/tools/grant_role/index.js';
import revokeRole from '../agents/kook/skills/kook/tools/revoke_role/index.js';
import createRole from '../agents/kook/skills/kook/tools/create_role/index.js';
import deleteRole from '../agents/kook/skills/kook/tools/delete_role/index.js';
import listRoles from '../agents/kook/skills/kook/tools/list_roles/index.js';

/** KOOK `position`: smaller is higher. 0 = 全体成员, 10 = 管理员, 20 = 版主, 30 = 成员. */
const ROLES = [
  { role_id: 0, name: '@全体成员', position: 999999 },
  { role_id: 10, name: '管理员', position: 1 },
  { role_id: 20, name: '版主', position: 2 },
  { role_id: 30, name: '成员', position: 3 },
];

function fixture(kind: 'channel' | 'private' = 'channel', options: { requester?: string; memberRoles?: Record<string, number[]> } = {}) {
  const member = { grant: vi.fn(async () => true), revoke: vi.fn(async () => true), addToBlackList: vi.fn(async () => true), removeFromBlackList: vi.fn(async () => true) };
  const guild = { createRole: vi.fn(async (name: string) => ({ role_id: 1, name })), deleteRole: vi.fn(async () => true), getRoleList: vi.fn(async () => ROLES) };
  const memberRoles = options.memberRoles ?? { requester: [20] };
  const client = {
    pickGuildMember: vi.fn(() => member),
    pickGuild: vi.fn(() => guild),
    getGuildInfo: vi.fn(async () => ({ id: 'g1', user_id: 'owner' })),
    request: { get: vi.fn(async (_url: string, { params }: { params: { user_id: string } }) => ({ data: { roles: memberRoles[params.user_id] ?? [] } })) },
  };
  const conversation = { endpoint: { adapter: 'kook', id: 'bot' }, kind, id: 'c1', ...(kind === 'channel' ? { parent: { kind: 'channel' as const, id: 'g1' } } : {}) };
  const context = {
    locale: 'en', signal: new AbortController().signal, $client: client,
    origin: { kind: 'im', platform: 'kook', conversation },
    principal: { subjectId: options.requester ?? 'requester', roles: [] },
  } as never;
  return { client, member, guild, context };
}

describe('KOOK server tools act on the current server only (platform permits are per conversation)', () => {
  it('have no guild_id input', () => {
    for (const tool of [blacklist, grantRole, revokeRole, createRole, deleteRole, listRoles]) {
      expect((tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape).not.toHaveProperty('guild_id');
    }
  });

  it('ignore a model-supplied guild_id', async () => {
    const f = fixture();
    await grantRole.execute({ guild_id: 'other', user_id: 'u', role_id: '30' } as never, f.context);
    await revokeRole.execute({ guild_id: 'other', user_id: 'u', role_id: '30' } as never, f.context);
    await blacklist.execute({ guild_id: 'other', action: 'add', user_id: 'u' } as never, f.context);
    expect(f.client.pickGuildMember.mock.calls).toEqual([['g1', 'u'], ['g1', 'u'], ['g1', 'u']]);
    await createRole.execute({ guild_id: 'other', name: 'n' } as never, f.context);
    await deleteRole.execute({ guild_id: 'other', role_id: 'r' } as never, f.context);
    await listRoles.execute({ guild_id: 'other' } as never, f.context);
    expect(f.client.pickGuild.mock.calls.every(([id]) => id === 'g1')).toBe(true);
    expect(f.client.request.get.mock.calls.every(([, { params }]) => (params as { guild_id: string }).guild_id === 'g1')).toBe(true);
  });

  it('refuse outside a server channel', async () => {
    const f = fixture('private');
    await expect(grantRole.execute({ user_id: 'u', role_id: 'r' }, f.context)).rejects.toThrow('KOOK server');
    expect(f.member.grant).not.toHaveBeenCalled();
  });
});

describe('KOOK role hierarchy: the requester may only manage roles / members below their highest role', () => {
  it('grants and revokes a role below the requester (larger position)', async () => {
    const f = fixture();
    await expect(grantRole.execute({ user_id: 'u', role_id: '30' }, f.context)).resolves.toMatchObject({ success: true });
    await expect(revokeRole.execute({ user_id: 'u', role_id: '30' }, f.context)).resolves.toMatchObject({ success: true });
    expect(f.member.grant).toHaveBeenCalledWith('30');
    expect(f.member.revoke).toHaveBeenCalledWith('30');
  });

  it("refuses the requester's own highest role and higher roles", async () => {
    const f = fixture();
    for (const role_id of ['20', '10']) {
      await expect(grantRole.execute({ user_id: 'requester', role_id }, f.context)).resolves.toMatchObject({ success: false, message: expect.stringContaining('not below your highest role') });
      await expect(revokeRole.execute({ user_id: 'u', role_id }, f.context)).resolves.toMatchObject({ success: false });
    }
    expect(f.member.grant).not.toHaveBeenCalled();
    expect(f.member.revoke).not.toHaveBeenCalled();
  });

  it('uses the highest of several held roles', async () => {
    const f = fixture('channel', { memberRoles: { requester: [30, 10] } });
    await expect(grantRole.execute({ user_id: 'u', role_id: '20' }, f.context)).resolves.toMatchObject({ success: true });
  });

  it('refuses requesters without a ranked role, unknown roles and 全体成员', async () => {
    const f = fixture('channel', { memberRoles: { requester: [0] } });
    await expect(grantRole.execute({ user_id: 'u', role_id: '30' }, f.context)).resolves.toMatchObject({ success: false });
    await expect(grantRole.execute({ user_id: 'u', role_id: '0' }, f.context)).resolves.toMatchObject({ success: false, message: expect.stringContaining('does not exist') });
    await expect(grantRole.execute({ user_id: 'u', role_id: '404' }, f.context)).resolves.toMatchObject({ success: false, message: expect.stringContaining('does not exist') });
    expect(f.member.grant).not.toHaveBeenCalled();
  });

  it('refuses without a requester identity', async () => {
    const f = fixture();
    (f.context as { principal?: unknown }).principal = undefined;
    await expect(grantRole.execute({ user_id: 'u', role_id: '30' }, f.context)).resolves.toMatchObject({ success: false });
    expect(f.member.grant).not.toHaveBeenCalled();
  });

  it('exempts the server owner', async () => {
    const f = fixture('channel', { requester: 'owner' });
    await expect(grantRole.execute({ user_id: 'u', role_id: '10' }, f.context)).resolves.toMatchObject({ success: true });
    expect(f.member.grant).toHaveBeenCalledWith('10');
  });

  it('blacklists only members ranked below the requester, never the owner', async () => {
    const f = fixture('channel', { memberRoles: { requester: [20], peer: [20], boss: [10], low: [30] } });
    for (const user_id of ['peer', 'boss', 'owner']) {
      await expect(blacklist.execute({ action: 'add', user_id }, f.context)).resolves.toMatchObject({ success: false });
    }
    expect(f.member.addToBlackList).not.toHaveBeenCalled();
    await expect(blacklist.execute({ action: 'add', user_id: 'low' }, f.context)).resolves.toMatchObject({ success: true });
    await expect(blacklist.execute({ action: 'add', user_id: 'plain' }, f.context)).resolves.toMatchObject({ success: true });
    await expect(blacklist.execute({ action: 'remove', user_id: 'boss' }, f.context)).resolves.toMatchObject({ success: true });
  });
});
