/**
 * ADR 0056 §1: Discord guild member → normalized `sender.platform`.
 *
 * - `standing`: guild owner → `owner`; `Administrator` / `ModerateMembers` → `admin`; other members →
 *   `member`. Direct messages report nothing.
 * - `roles`: the member's guild roles (`@everyone` excluded), with names when the event carries them.
 * - `permissions`: the member's guild permission flags as snake_case names (`ban_members`, `manage_roles`, …).
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
  if (typeof bitfield !== 'string' && typeof bitfield !== 'number' && typeof bitfield !== 'bigint') return [];
  let value: bigint;
  try { value = BigInt(bitfield); } catch { return []; }
  return discordPermissionNames(bit => (value & bit) === bit);
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
