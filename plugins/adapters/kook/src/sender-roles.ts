/**
 * KOOK 入站发送者平台身份（ADR 0056 §1）。
 *
 * 事件只携带数字角色 id，无法直接判断群主 / 管理员；这里按服务器缓存
 * guild.view（群主 id）与 guild-role.list（角色名与权限位），把发送者归一为
 * `sender.platform`：
 * - `standing`：服务器主 → `owner`；持有带「管理员」权限位的角色 → `admin`；否则 `member`。
 *   查询失败、无法判断时不上报（不猜）。
 * - `roles`：发送者持有的服务器角色（id + 名称）。
 * - `permissions`：「全体成员」角色（role_id 0，每个成员都持有、事件里不列出）与这些角色权限位的并集，
 *   按 KOOK 权限名（snake_case）上报；服务器主与持有「管理员」位的成员拥有全部权限，展开为全部权限名。
 *   机器人自身身份（`inspectSelfStanding`）走同一套规则。
 */
import { TtlLookupCache } from 'zhin.js/adapter';
import type { PlatformStanding } from '@zhin.js/im-contract';
import type { KookClientTransport } from './ws.js';

const CACHE_TTL_MS = 60_000;
/** 「全体成员」：每个成员都持有的基础角色。 */
const EVERYONE_ROLE_ID = '0';

/** KOOK 角色权限位（按位序，见 KOOK 开发者文档「权限说明」）。 */
export const KOOK_ROLE_PERMISSIONS: readonly string[] = Object.freeze([
  'administrator', 'manage_guild', 'view_audit_log', 'create_invite', 'manage_invite', 'manage_channels',
  'kick_members', 'ban_members', 'manage_emojis', 'change_nickname', 'manage_roles', 'view_channels',
  'send_messages', 'manage_messages', 'attach_files', 'connect_voice', 'manage_voice', 'mention_everyone',
  'add_reaction', 'follow_reaction', 'passive_connect_voice', 'push_to_talk_only', 'free_voice_speak', 'speak',
  'deafen_members', 'mute_members', 'manage_nicknames', 'play_music',
]);

/** KOOK 权限位 → 权限名；未知位丢弃。 */
export function kookPermissionNames(bits: number): string[] {
  if (!Number.isFinite(bits) || bits <= 0) return [];
  return KOOK_ROLE_PERMISSIONS.filter((_, index) => Math.floor(bits / 2 ** index) % 2 === 1);
}

interface GuildRole {
  readonly name?: string;
  readonly permissions: number;
}

interface GuildSnapshot {
  readonly ownerId?: string;
  /** `undefined` when the role list lookup failed. */
  readonly roles?: ReadonlyMap<string, GuildRole>;
}

export class KookSenderRoleResolver {
  readonly #guilds = new TtlLookupCache<string, GuildSnapshot | undefined>({ ttlMs: CACHE_TTL_MS });

  constructor(private readonly getClient: () => KookClientTransport | null) {}

  async resolve(input: {
    readonly guildId?: string;
    readonly authorId: string;
    readonly authorRoles?: readonly number[];
  }): Promise<PlatformStanding | undefined> {
    if (!input.guildId) return undefined;
    const roleIds = [...new Set((input.authorRoles ?? []).map(String))];
    const snapshot = await this.#snapshot(input.guildId);
    if (!snapshot) return undefined;
    const held = roleIds.filter((id) => id !== EVERYONE_ROLE_ID).map((id) => ({ id, role: snapshot.roles?.get(id) }));
    const everyone = snapshot.roles?.get(EVERYONE_ROLE_ID)?.permissions ?? 0;
    const bits = held.reduce((sum, { role }) => sum | (role?.permissions ?? 0), everyone);
    const roles = held.map(({ id, role }) => (role?.name ? { id, name: role.name } : { id }));
    const isOwner = snapshot.ownerId !== undefined && snapshot.ownerId === input.authorId;
    const isAdmin = kookPermissionNames(bits).includes('administrator');
    // The server owner and administrators hold every permission (KOOK ignores per-bit grants for them).
    const permissions = isOwner || isAdmin ? [...KOOK_ROLE_PERMISSIONS] : kookPermissionNames(bits);
    // Without the owner id or the role list the standing cannot be decided; an admin role still proves admin.
    const standing = isOwner ? 'owner' : isAdmin ? 'admin'
      : snapshot.ownerId !== undefined && snapshot.roles ? 'member' : undefined;
    if (!standing) return undefined;
    return {
      standing,
      ...(roles.length ? { roles } : {}),
      ...(permissions.length ? { permissions } : {}),
    };
  }

  async #snapshot(guildId: string): Promise<GuildSnapshot | undefined> {
    return this.#guilds.getOrLoad(guildId, () => this.#fetch(guildId), {
      cacheWhen: (snapshot): snapshot is GuildSnapshot => snapshot !== undefined,
    });
  }

  async #fetch(guildId: string): Promise<GuildSnapshot | undefined> {
    const client = this.getClient();
    if (!client) return undefined;
    let ownerId: string | undefined;
    let roles: Map<string, GuildRole> | undefined;
    try {
      const info = await client.getGuildInfo?.(guildId);
      if (info?.user_id != null && String(info.user_id)) ownerId = String(info.user_id);
    } catch { /* 保守：视为无群主信息 */ }
    try {
      roles = new Map();
      for (const role of await client.pickGuild(guildId).getRoleList()) {
        const name = typeof (role as { name?: unknown }).name === 'string' ? (role as { name: string }).name : undefined;
        roles.set(String(role.role_id), { ...(name ? { name } : {}), permissions: Number(role.permissions) || 0 });
      }
    } catch { roles = undefined; /* 保守：视为无角色信息 */ }
    return { ...(ownerId ? { ownerId } : {}), ...(roles ? { roles } : {}) };
  }
}
