import { describe, expect, it, vi } from 'vitest';
import blacklist from '../agents/kook/skills/kook/tools/blacklist/index.js';
import grantRole from '../agents/kook/skills/kook/tools/grant_role/index.js';
import revokeRole from '../agents/kook/skills/kook/tools/revoke_role/index.js';
import createRole from '../agents/kook/skills/kook/tools/create_role/index.js';
import deleteRole from '../agents/kook/skills/kook/tools/delete_role/index.js';

function fixture(kind: 'channel' | 'private' = 'channel') {
  const member = { grant: vi.fn(async () => true), revoke: vi.fn(async () => true), addToBlackList: vi.fn(async () => true), removeFromBlackList: vi.fn(async () => true) };
  const guild = { createRole: vi.fn(async (name: string) => ({ role_id: 1, name })), deleteRole: vi.fn(async () => true) };
  const client = { pickGuildMember: vi.fn(() => member), pickGuild: vi.fn(() => guild) };
  const conversation = { endpoint: { adapter: 'kook', id: 'bot' }, kind, id: 'c1', ...(kind === 'channel' ? { parent: { kind: 'channel' as const, id: 'g1' } } : {}) };
  const context = { locale: 'en', signal: new AbortController().signal, $client: client, origin: { kind: 'im', platform: 'kook', conversation } } as never;
  return { client, member, guild, context };
}

describe('KOOK server tools act on the current server only (platform permits are per conversation)', () => {
  it('have no guild_id input', () => {
    for (const tool of [blacklist, grantRole, revokeRole, createRole, deleteRole]) {
      expect((tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape).not.toHaveProperty('guild_id');
    }
  });

  it('ignore a model-supplied guild_id', async () => {
    const f = fixture();
    await grantRole.execute({ guild_id: 'other', user_id: 'u', role_id: 'r' } as never, f.context);
    await revokeRole.execute({ guild_id: 'other', user_id: 'u', role_id: 'r' } as never, f.context);
    await blacklist.execute({ guild_id: 'other', action: 'add', user_id: 'u' } as never, f.context);
    expect(f.client.pickGuildMember.mock.calls).toEqual([['g1', 'u'], ['g1', 'u'], ['g1', 'u']]);
    await createRole.execute({ guild_id: 'other', name: 'n' } as never, f.context);
    await deleteRole.execute({ guild_id: 'other', role_id: 'r' } as never, f.context);
    expect(f.client.pickGuild.mock.calls).toEqual([['g1'], ['g1']]);
  });

  it('refuse outside a server channel', async () => {
    const f = fixture('private');
    await expect(grantRole.execute({ user_id: 'u', role_id: 'r' }, f.context)).rejects.toThrow('KOOK server');
    expect(f.member.grant).not.toHaveBeenCalled();
  });
});
