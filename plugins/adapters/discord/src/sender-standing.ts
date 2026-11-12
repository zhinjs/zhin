/**
 * ADR 0056 §1: Discord guild member → normalized `sender.platform`.
 *
 * - `standing`: guild owner → `owner`; `Administrator` / `ModerateMembers` → `admin`; other members →
 *   `member`. Direct messages report nothing.
 * - `roles`: the member's guild roles (`@everyone` excluded), with names when the event carries them.
 * - `permissions`: the member's **guild-level** permission flags as snake_case names (`ban_members`,
 *   `manage_roles`, …). Gateway mode reads `GuildMember.permissions` (server-wide, no channel overwrites)
 *   for senders and the Bot alike. Interactions only carry channel-level bitfields (overwrites applied),
 *   so they report just the flags that cannot be overwritten per channel (identical at both levels) —
 *   all flags when the member is an administrator.
 */
import { PermissionFlagsBits } from 'discord.js';
import type { PlatformStanding } from '@zhin.js/im-contract';
import type { DiscordInboundMessage } from './protocol.js';

const FLAG_ENTRIES = Object.entries(PermissionFlagsBits) as [string, bigint][];

/** `ManageRoles` → `manage_roles`, `SendTTSMessages` → `send_tts_messages`. */
export function discordPermissionName(flag: string): string {
  return flag.replace(/([A-Z]+)([A-Z][a-z])/gu, '$1_$2').replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase();
}

/** All permission flag names the predicate grants. */
export function discordPermissionNames(has: (bit: bigint) => boolean): string[] {
  const names: string[] = [];
  for (const [flag, bit] of FLAG_ENTRIES) {
    try {
      if (has(bit)) names.push(discordPermissionName(flag));
    } catch {
      // A partial permission view cannot answer this bit; leave it out.
    }
  }
  return names;
}

/** Permission names from an interaction's decimal bitfield string (`member.permissions`). */
export function discordPermissionNamesFromBitfield(bitfield: unknown): string[] {
  const value = parseBitfield(bitfield);
  return value === undefined ? [] : discordPermissionNames(bit => (value & bit) === bit);
}

function parseBitfield(bitfield: unknown): bigint | undefined {
  if (typeof bitfield !== 'string' && typeof bitfield !== 'number' && typeof bitfield !== 'bigint') return undefined;
  try { return BigInt(bitfield); } catch { return undefined; }
}

/** Flags Discord does not allow in channel overwrites: a channel-level bitfield shows their guild value. */
const GUILD_ONLY_FLAGS: readonly bigint[] = [
  PermissionFlagsBits.Administrator, PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ViewAuditLog, PermissionFlagsBits.ViewGuildInsights,
  PermissionFlagsBits.ChangeNickname, PermissionFlagsBits.ManageNicknames, PermissionFlagsBits.ManageGuildExpressions,
  PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ViewCreatorMonetizationAnalytics,
  PermissionFlagsBits.CreateGuildExpressions,
];

/**
 * Guild-level permission names from a channel-level bitfield (interaction `member.permissions` /
 * `app_permissions`): an administrator holds every flag server-wide; otherwise only the flags that
 * channel overwrites cannot change are reported, so a channel overwrite (e.g. "Manage Permissions" in
 * one channel) never reads as a server-wide `manage_roles`.
 */
export function discordGuildPermissionNamesFromChannelBitfield(bitfield: unknown): string[] {
  const value = parseBitfield(bitfield);
  if (value === undefined) return [];
  if ((value & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) return discordPermissionNames(() => true);
  return discordPermissionNames(bit => GUILD_ONLY_FLAGS.includes(bit) && (value & bit) === bit);
}

/** Normalized standing from guild-level permission names (the guild owner is reported separately). */
export function discordStandingFromPermissions(permissions: readonly string[], isOwner = false): PlatformStanding['standing'] {
  return isOwner ? 'owner'
    : permissions.includes('administrator') || permissions.includes('moderate_members') ? 'admin' : 'member';
}

export function discordSenderStanding(msg: DiscordInboundMessage): PlatformStanding | undefined {
  if (!msg.guildId) return undefined;
  const permissions = msg.platformPermissions ?? [];
  const legacy = msg.permissionTokens ?? [];
  const standing = msg.isGuildOwner
    ? 'owner'
    : permissions.includes('administrator') || permissions.includes('moderate_members')
      || legacy.includes('ADMINISTRATOR') || legacy.includes('MODERATE_MEMBERS')
      ? 'admin'
      : 'member';
  return {
    standing,
    ...(msg.authorRoles?.length ? { roles: msg.authorRoles } : {}),
    ...(permissions.length ? { permissions } : {}),
  };
}
