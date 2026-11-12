/**
 * QQ 官方频道 platform permit（guild/channel，非 QQ 群 group_*）
 */
import type { PlatformStanding } from '@zhin.js/im-contract';


export function platformPermit(perm: string): string {
  return `platform-permission:${perm}`;
}

/**
 * QQ 官方频道事件 `member.roles` 中的内置身份 id：4 = 频道主，2 = 超级管理员，
 * 5 = 子频道管理员，1 = 普通成员。事件已自带，无需额外 API；5 不视为 admin。
 */
const QQ_GUILD_OWNER_ROLE_ID = '4';
const QQ_GUILD_ADMIN_ROLE_ID = '2';
const QQ_GUILD_BUILTIN_ROLE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  '1': '普通成员',
  '2': '超级管理员',
  '4': '频道主',
  '5': '子频道管理员',
});

/**
 * ADR 0056 §1 入站平台身份：频道主 / 超级管理员 → `owner` / `admin`，其余为 `member`；
 * 原始身份组 id 进 `roles`（内置身份带名称）。只在频道子频道会话上报；QQ 群、单聊与频道私信不上报。
 * QQ 官方事件没有权限位，`permissions` 不上报。
 */
export function projectQqGuildSenderStanding(
  authorRoles: readonly string[] | undefined,
  conversation: { readonly kind: string },
): PlatformStanding | undefined {
  // Only guild child channels carry a guild standing; group, private and guild direct messages report nothing.
  if (conversation.kind !== 'channel' || !authorRoles?.length) return undefined;
  const ids = [...new Set(authorRoles.map(String).filter(Boolean))];
  const standing = ids.includes(QQ_GUILD_OWNER_ROLE_ID) ? 'owner' : ids.includes(QQ_GUILD_ADMIN_ROLE_ID) ? 'admin' : 'member';
  return {
    standing,
    roles: ids.map((id) => (QQ_GUILD_BUILTIN_ROLE_NAMES[id] ? { id, name: QQ_GUILD_BUILTIN_ROLE_NAMES[id] } : { id })),
  };
}
