import { describe, expect, it } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { resolveTurnCapabilities } from 'zhin.js/adapter';
import discord from '../adapters/discord/index.js';
import { normalizeDiscordMessage } from '../src/gateway.js';
import { interactionToInboundMessage } from '../src/protocol.js';
import { discordPermissionName, discordPermissionNamesFromBitfield, discordSenderStanding } from '../src/sender-standing.js';

function guildMessage(options: { ownerId?: string; granted?: readonly bigint[]; roles?: { id: string; name: string }[] }) {
  const granted = new Set(options.granted ?? []);
  return {
    id: 'm1', content: 'hi', createdTimestamp: 1, author: { id: 'u1', username: 'alice', bot: false },
    channel: { id: 'c1', type: 0 },
    guild: { id: 'g1', ownerId: options.ownerId ?? 'someone-else' },
    member: {
      displayName: 'Alice',
      permissions: { has: (bit: bigint) => granted.has(bit) },
      roles: { cache: new Map([['g1', { id: 'g1', name: '@everyone' }], ...(options.roles ?? []).map((role) => [role.id, role] as const)]) },
    },
    attachments: new Map(), embeds: [], stickers: new Map(),
  };
}

describe('Discord sender.platform (ADR 0056 §1)', () => {
  it('names permission flags in snake_case', () => {
    expect(discordPermissionName('ManageRoles')).toBe('manage_roles');
    expect(discordPermissionName('SendTTSMessages')).toBe('send_tts_messages');
    expect(discordPermissionName('UseVAD')).toBe('use_vad');
  });

  it('reports guild roles (without @everyone) and permission flags for a moderator', () => {
    const msg = normalizeDiscordMessage(guildMessage({
      granted: [PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.BanMembers],
      roles: [{ id: 'r-mod', name: 'Moderators' }],
    }))!;
    expect(discordSenderStanding(msg)).toEqual({
      standing: 'admin',
      roles: [{ id: 'r-mod', name: 'Moderators' }],
      permissions: ['ban_members', 'moderate_members'],
    });
  });

  it('marks the guild owner and plain members', () => {
    expect(discordSenderStanding(normalizeDiscordMessage(guildMessage({ ownerId: 'u1' }))!)?.standing).toBe('owner');
    expect(discordSenderStanding(normalizeDiscordMessage(guildMessage({ granted: [PermissionFlagsBits.SendMessages] }))!))
      .toEqual({ standing: 'member', permissions: ['send_messages'] });
  });

  it('reports nothing for direct messages', () => {
    expect(discordSenderStanding({ id: 'm', content: '', channelId: 'd', channelKind: 'private', authorId: 'u', authorName: 'u', createdTimestamp: 0 })).toBeUndefined();
  });

  it('reads slash-command member permissions bitfield and role ids', () => {
    const bitfield = String(PermissionFlagsBits.Administrator | PermissionFlagsBits.KickMembers);
    expect(discordPermissionNamesFromBitfield(bitfield)).toEqual(['kick_members', 'administrator']);
    const msg = interactionToInboundMessage({ id: 'i1', type: 2, guild_id: 'g1', channel_id: 'c1',
      member: { user: { id: 'u1', username: 'alice' }, permissions: bitfield, roles: ['r1', 'g1'] }, data: { name: 'ping' } });
    // An administrator holds every flag server-wide.
    expect(discordSenderStanding(msg)).toEqual({ standing: 'admin', roles: [{ id: 'r1' }], permissions: expect.arrayContaining(['kick_members', 'administrator', 'manage_roles']) });
    // Otherwise only guild-only flags: a channel overwrite granting "Manage Permissions" is not server-wide `manage_roles`.
    const overwritten = interactionToInboundMessage({ id: 'i2', type: 2, guild_id: 'g1', channel_id: 'c1',
      member: { user: { id: 'u1', username: 'alice' }, permissions: String(PermissionFlagsBits.ManageRoles | PermissionFlagsBits.KickMembers), roles: [] }, data: { name: 'ping' } });
    expect(discordSenderStanding(overwritten)).toEqual({ standing: 'member', permissions: ['kick_members'] });
    expect(discordPermissionNamesFromBitfield('not-a-number')).toEqual([]);
  });

  it('declares standing, roles and permissions for guild channels', () => {
    const conversation = (kind: 'channel' | 'private') => ({ endpoint: { id: 'e', adapter: 'discord' }, kind, id: '1' });
    expect(resolveTurnCapabilities({ profile: discord.profile!, conversation: conversation('channel') }).get('scene.platformStanding'))
      .toEqual({ standing: true, roles: true, permissions: true });
    expect(resolveTurnCapabilities({ profile: discord.profile!, conversation: conversation('private') }).has('scene.platformStanding')).toBe(false);
  });
});
