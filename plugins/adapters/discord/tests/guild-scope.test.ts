import { describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createHttpHost } from '@zhin.js/host-http/node';
import { createDiscordEndpointManagement, DiscordInteractionsEndpoint } from '../src/endpoint.js';
import { resolveDiscordConfig } from '../src/protocol.js';
import { discordGuildPermissionNamesFromChannelBitfield } from '../src/sender-standing.js';
import addRole from '../agents/discord/skills/discord-guild/tools/add_role/index.js';
import removeRole from '../agents/discord/skills/discord-guild/tools/remove_role/index.js';
import listRoles from '../agents/discord/skills/discord-guild/tools/list_roles/index.js';
import createThread from '../agents/discord/skills/discord-guild/tools/create_thread/index.js';
import { discordFixture } from './fixture.js';

const conversation = { endpoint: { adapter: 'discord', id: 'bot' }, kind: 'channel' as const, id: 'c1', parent: { kind: 'channel' as const, id: 'g1' } };

function guildFixture(options: { requesterTop?: number; ownerId?: string } = {}) {
  const roles = new Map([
    ['low', { id: 'low', position: 1 }], ['mid', { id: 'mid', position: 5 }], ['high', { id: 'high', position: 9 }],
    ['bot-role', { id: 'bot-role', position: 2, managed: true }],
  ]);
  const add = vi.fn(async () => undefined);
  const remove = vi.fn(async () => undefined);
  const guild = {
    id: 'g1', ownerId: options.ownerId ?? 'owner',
    roles: { fetch: vi.fn(async (id?: string) => (id ? roles.get(id) ?? null : roles)), cache: new Map() },
    members: { fetch: vi.fn(async (id: string) => id === 'requester'
      ? { roles: { highest: { id: 'mid', position: options.requesterTop ?? 5 } } }
      : { roles: { add, remove } }) },
  };
  const guilds = { fetch: vi.fn(async () => guild) };
  const channels = { fetch: vi.fn(async () => ({ isThreadOnly: () => false, threads: { create: vi.fn(async () => ({ id: 't1' })) } })) };
  const context = {
    locale: 'en', signal: new AbortController().signal,
    $client: { guilds, channels },
    origin: { kind: 'im', platform: 'discord', conversation },
    principal: { subjectId: 'requester', roles: [] },
  } as never;
  return { guild, guilds, channels, add, remove, context };
}

describe('Discord role tools (H1/H2)', () => {
  it('have no guild / channel id inputs', () => {
    for (const tool of [addRole, removeRole, listRoles, createThread]) {
      const shape = (tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape;
      expect(shape).not.toHaveProperty('guild_id');
      expect(shape).not.toHaveProperty('channel_id');
    }
  });

  it('acts in the current guild, ignoring a model-supplied guild_id', async () => {
    const f = guildFixture();
    expect(await addRole.execute({ guild_id: 'other', user_id: 'u2', role_id: 'low' } as never, f.context)).toMatchObject({ success: true });
    expect(f.guilds.fetch).toHaveBeenCalledWith('g1');
    expect(f.add).toHaveBeenCalledWith('low');
    await listRoles.execute({ guild_id: 'other' } as never, f.context);
    expect(f.guilds.fetch).toHaveBeenLastCalledWith('g1');
    await createThread.execute({ channel_id: 'other', name: 'x' } as never, f.context);
    expect(f.channels.fetch).toHaveBeenCalledWith('c1');
  });

  it.each([['add_role', addRole, 'add'], ['remove_role', removeRole, 'remove']] as const)(
    '%s refuses roles at or above the requester’s highest role', async (_name, tool, method) => {
      for (const role of ['mid', 'high', 'bot-role']) {
        const f = guildFixture();
        expect(await tool.execute({ user_id: 'u2', role_id: role }, f.context)).toMatchObject({ success: false });
        expect(f[method]).not.toHaveBeenCalled();
      }
      const f = guildFixture();
      expect(await tool.execute({ user_id: 'u2', role_id: 'low' }, f.context)).toMatchObject({ success: true });
      expect(f[method]).toHaveBeenCalledWith('low');
    });

  it('exempts the guild owner from the hierarchy check', async () => {
    const f = guildFixture({ ownerId: 'requester', requesterTop: 0 });
    expect(await addRole.execute({ user_id: 'u2', role_id: 'high' }, f.context)).toMatchObject({ success: true });
  });

  it('refuses outside a guild channel', async () => {
    const f = guildFixture();
    const dm = { ...(f.context as object), origin: { kind: 'im', platform: 'discord', conversation: { ...conversation, kind: 'private', parent: undefined } } } as never;
    await expect(addRole.execute({ user_id: 'u2', role_id: 'low' }, dm)).rejects.toThrow('Discord server channel');
    expect(f.add).not.toHaveBeenCalled();
  });
});

describe('Discord guild-level permission scope (M7/L4)', () => {
  it('reads channel-level bitfields as guild-level names only', () => {
    const names = discordGuildPermissionNamesFromChannelBitfield(String(PermissionFlagsBits.ManageRoles | PermissionFlagsBits.KickMembers | PermissionFlagsBits.SendMessages));
    expect(names).toEqual(['kick_members']);
    expect(discordGuildPermissionNamesFromChannelBitfield(String(PermissionFlagsBits.Administrator))).toEqual(expect.arrayContaining(['administrator', 'manage_roles', 'ban_members']));
  });

  it('reports the Bot’s guild-level permissions, not the channel overwrite view', async () => {
    const guildPerms = new Set([PermissionFlagsBits.ManageRoles]);
    const me = {
      permissions: { has: (bit: bigint) => guildPerms.has(bit) },
      roles: { cache: new Map([['r', { id: 'r', name: 'Bot' }]]) },
    };
    const channel = {
      guild: { id: 'g1', ownerId: 'owner', members: { me } },
      permissionsFor: () => ({ has: () => true }),
    };
    const management = createDiscordEndpointManagement(() => ({
      user: { id: 'self' }, channels: { fetch: async () => channel },
    }) as never);
    expect(await management.inspectSelfStanding!({ conversation, signal: new AbortController().signal } as never))
      .toEqual({ standing: 'member', roles: [{ id: 'r', name: 'Bot' }], permissions: ['manage_roles'] });
  });

  it('interactions mode reports the Bot standing from app_permissions of the latest interaction', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    const f = await discordFixture(() => new DiscordInteractionsEndpoint({
      id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'discord'), http,
      config: resolveDiscordConfig({ id: 'discord', token: 'tok', connection: 'interactions', applicationId: 'app', publicKey: 'a'.repeat(64) }) as never,
    }), undefined, { receive: vi.fn(async () => Object.freeze({ matched: false })), send: vi.fn(async () => 'sent') }, undefined);
    try {
      await f.start(); f.open();
      const request = { conversation, signal: new AbortController().signal } as never;
      expect(await f.management.inspectSelfStanding!(request)).toBeUndefined();
      (f.endpoint as unknown as DiscordInteractionsEndpoint).admit({
        id: 'i1', content: '/ping', channelId: 'c1', channelKind: 'channel', guildId: 'g1', authorId: 'u', authorName: 'u', createdTimestamp: 0,
        event: { app_permissions: String(PermissionFlagsBits.ManageRoles | PermissionFlagsBits.BanMembers) },
      });
      expect(await f.management.inspectSelfStanding!(request)).toEqual({ standing: 'member', permissions: ['ban_members'] });
    } finally { await f.stop(); await http.close(); }
  });
});
