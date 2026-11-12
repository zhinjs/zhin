import { describe, expect, it, vi } from 'vitest';
import { projectQqGuildSenderStanding } from '../src/platform-permit.js';
import addRole from '../agents/qq/skills/qq/tools/add_role/index.js';
import removeRole from '../agents/qq/skills/qq/tools/remove_role/index.js';
import createRole from '../agents/qq/skills/qq/tools/create_role/index.js';
import listRoles from '../agents/qq/skills/qq/tools/list_roles/index.js';
import listChannels from '../agents/qq/skills/qq/tools/list_channels/index.js';
import memberDetail from '../agents/qq/skills/qq/tools/member_detail/index.js';
import channelInfo from '../agents/qq/skills/qq/tools/channel_info/index.js';

function fixture(kind: 'channel' | 'private' = 'channel') {
  const client = {
    memberService: { addMemberRole: vi.fn(async () => undefined), removeMemberRole: vi.fn(async () => undefined), getGuildMemberInfo: vi.fn(async () => ({})) },
    guildService: { createRole: vi.fn(async () => ({ id: 'r' })), getRoles: vi.fn(async () => []) },
    channelService: { getList: vi.fn(async () => []), getInfo: vi.fn(async (id: string) => ({ id, guild_id: id === 'foreign' ? 'G_OTHER' : 'G1' })) },
  };
  const conversation = { endpoint: { adapter: 'qq', id: 'bot' }, kind, id: 'C1', parent: { kind: 'channel' as const, id: 'G1' } };
  return { client, context: { locale: 'en', signal: new AbortController().signal, $client: client, origin: { kind: 'im', platform: 'qq', conversation } } as never };
}

describe('QQ guild tools act on the current guild only (platform permits are per conversation)', () => {
  it('have no guild_id input', () => {
    for (const tool of [addRole, removeRole, createRole, listRoles, listChannels, memberDetail]) {
      const shape = (tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape;
      expect(shape).not.toHaveProperty('guild_id');
    }
  });

  it('ignore model-supplied guild / channel ids', async () => {
    const f = fixture();
    const foreign = { guild_id: 'G_OTHER', channel_id: 'C_OTHER' };
    await addRole.execute({ ...foreign, user_id: 'u', role_id: 'r' } as never, f.context);
    await removeRole.execute({ ...foreign, user_id: 'u', role_id: 'r' } as never, f.context);
    await createRole.execute({ ...foreign, name: 'n' } as never, f.context);
    await listRoles.execute(foreign as never, f.context);
    await listChannels.execute(foreign as never, f.context);
    await memberDetail.execute({ ...foreign, user_id: 'u' } as never, f.context);
    expect(f.client.memberService.addMemberRole).toHaveBeenCalledWith('G1', 'C1', 'u', 'r');
    expect(f.client.memberService.removeMemberRole).toHaveBeenCalledWith('G1', 'C1', 'u', 'r');
    expect(f.client.guildService.createRole).toHaveBeenCalledWith('G1', expect.objectContaining({ name: 'n' }));
    expect(f.client.guildService.getRoles).toHaveBeenCalledWith('G1');
    expect(f.client.channelService.getList).toHaveBeenCalledWith('G1');
    expect(f.client.memberService.getGuildMemberInfo).toHaveBeenCalledWith('G1', 'u');
  });

  it('channel_info refuses a child channel of another guild', async () => {
    const f = fixture();
    await expect(channelInfo.execute({}, f.context)).resolves.toMatchObject({ id: 'C1' });
    await expect(channelInfo.execute({ channel_id: 'foreign' }, f.context)).rejects.toThrow();
  });

  it('refuse outside a guild channel', async () => {
    const f = fixture('private');
    await expect(addRole.execute({ user_id: 'u', role_id: 'r' }, f.context)).rejects.toThrow();
    expect(f.client.memberService.addMemberRole).not.toHaveBeenCalled();
  });
});

describe('QQ sender standing (L3)', () => {
  it('is reported only in guild child channels', () => {
    expect(projectQqGuildSenderStanding(['4'], { kind: 'channel' })).toMatchObject({ standing: 'owner' });
    expect(projectQqGuildSenderStanding(['4'], { kind: 'private' })).toBeUndefined();
    expect(projectQqGuildSenderStanding(['2'], { kind: 'group' })).toBeUndefined();
  });
});
