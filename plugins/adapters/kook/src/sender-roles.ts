/**
 * KOOK 入站发送者角色投影。
 *
 * 事件只携带数字角色 id，无法直接判断群主 / 管理员；这里按服务器缓存
 * guild.view（群主 id）与 guild-role.list（角色权限位），把发送者投影为
 * 跨平台规范角色 owner / admin。原始角色 id 以 `role:<id>` 形式放入 permissions，
 * 不进入 `sender.roles`。
 */
import type { KookClientTransport } from './ws.js';

/** KOOK 角色权限位：0x1 = 管理员。 */
const KOOK_ROLE_ADMIN_BIT = 1;
const CACHE_TTL_MS = 60_000;

export interface KookSenderRoleProjection {
  /** 规范角色：owner / admin；普通成员为 undefined。 */
  readonly role?: 'owner' | 'admin';
  readonly permissions: readonly string[];
}

interface GuildSnapshot {
  readonly at: number;
  readonly ownerId?: string;
  readonly adminRoleIds: ReadonlySet<string>;
}

export class KookSenderRoleResolver {
  readonly #guilds = new Map<string, GuildSnapshot>();
  /** One lookup per guild at a time: concurrent messages on a cache miss share it. */
  readonly #lookups = new Map<string, Promise<GuildSnapshot | undefined>>();

  constructor(private readonly getClient: () => KookClientTransport | null) {}

  async resolve(input: {
    readonly guildId?: string;
    readonly authorId: string;
    readonly authorRoles?: readonly number[];
  }): Promise<KookSenderRoleProjection> {
    const roleIds = (input.authorRoles ?? []).map(String);
    const permissions = roleIds.map((id) => `role:${id}`);
    if (!input.guildId) return { permissions };

    const snapshot = await this.#snapshot(input.guildId);
    if (snapshot?.ownerId !== undefined && snapshot.ownerId === input.authorId) {
      return { role: 'owner', permissions: [...permissions, 'guild_owner', 'guild_admin'] };
    }
    if (snapshot && roleIds.some((id) => snapshot.adminRoleIds.has(id))) {
      return { role: 'admin', permissions: [...permissions, 'guild_admin'] };
    }
    return { permissions };
  }

  async #snapshot(guildId: string): Promise<GuildSnapshot | undefined> {
    const cached = this.#guilds.get(guildId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;
    let lookup = this.#lookups.get(guildId);
    if (!lookup) {
      lookup = this.#fetch(guildId).finally(() => this.#lookups.delete(guildId));
      this.#lookups.set(guildId, lookup);
    }
    return lookup;
  }

  async #fetch(guildId: string): Promise<GuildSnapshot | undefined> {
    const now = Date.now();
    const client = this.getClient();
    if (!client) return undefined;
    let ownerId: string | undefined;
    const adminRoleIds = new Set<string>();
    try {
      const info = await client.getGuildInfo?.(guildId);
      if (info?.user_id != null && String(info.user_id)) ownerId = String(info.user_id);
    } catch { /* 保守：视为无群主信息 */ }
    try {
      for (const role of await client.pickGuild(guildId).getRoleList()) {
        if ((Number(role.permissions) & KOOK_ROLE_ADMIN_BIT) !== 0) adminRoleIds.add(String(role.role_id));
      }
    } catch { /* 保守：视为无管理员角色 */ }
    const snapshot: GuildSnapshot = { at: now, ...(ownerId ? { ownerId } : {}), adminRoleIds };
    this.#guilds.set(guildId, snapshot);
    return snapshot;
  }
}
