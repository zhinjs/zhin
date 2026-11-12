/**
 * Telegram platform standing — ChatMember 状态 + 管理员权限（ADR 0056 §1）
 *
 * `standing` 使用跨平台规范名 owner / admin / member / guest；细粒度管理员权限放在 `permissions`。
 */
import type { PlatformStanding } from '@zhin.js/im-contract';

export function platformPermit(perm: string): string {
  return `platform-permission:${perm}`;
}

/** Administrator rights a chat creator implicitly holds (Bot API `ChatAdministratorRights`). */
const TELEGRAM_ADMIN_RIGHTS = [
  'manage_chat', 'delete_messages', 'manage_video_chats', 'restrict_members', 'promote_members', 'change_info',
  'invite_users', 'post_stories', 'edit_stories', 'delete_stories', 'post_messages', 'edit_messages', 'pin_messages',
  'manage_topics',
] as const;

/**
 * ADR 0056 §1：`getChatMember` 结果 → `sender.platform`。
 * creator → `owner`（拥有全部管理员权限）；administrator → `admin`，其 `can_*` 权限去掉前缀进
 * `permissions`（如 `restrict_members`、`pin_messages`）；member / 仍在群内的 restricted → `member`；
 * left / kicked → `guest`。Telegram 没有身份组，`roles` 不上报。
 *
 * 只有管理员权限作为平台权限上报：restricted 成员的 `can_*`（如 `can_pin_messages`）是对其个人的
 * 发言许可，普通成员同样可能按群默认权限拥有，两者都不上报，`platform-permission:*` 只由管理员满足。
 */
export function telegramChatMemberStanding(member: { readonly status?: string; readonly is_member?: boolean }): PlatformStanding {
  const status = member.status;
  if (status === 'creator') return { standing: 'owner', permissions: [...TELEGRAM_ADMIN_RIGHTS] };
  if (status === 'administrator') {
    const granted = Object.entries(member as Readonly<Record<string, unknown>>)
      .filter(([key, value]) => key.startsWith('can_') && value === true)
      .map(([key]) => key.slice(4));
    return { standing: 'admin', ...(granted.length ? { permissions: granted } : {}) };
  }
  if (status === 'left' || status === 'kicked' || (status === 'restricted' && member.is_member === false)) return { standing: 'guest' };
  return { standing: 'member' };
}
