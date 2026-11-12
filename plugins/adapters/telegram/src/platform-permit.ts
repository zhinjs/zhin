/**
 * Telegram platform permit — ChatMember 状态 + 细粒度权限
 *
 * `role` 使用跨平台规范名 owner / admin（原生 creator / administrator 仅作兼容输入）；
 * 细粒度能力放在 `permissions`。
 */
import type { PlatformStanding } from '@zhin.js/im-contract';
import type { PermissionSubject } from '@zhin.js/permission';


export function platformPermit(perm: string): string {
  return `platform-permission:${perm}`;
}

const FACTORY_PERM_MAP: Record<string, string> = {
  admin: 'chat_administrator',
  owner: 'chat_creator',
};

export function telegramGroupPermitResolver(logicalPerm: string): string {
  return platformPermit(FACTORY_PERM_MAP[logicalPerm] ?? logicalPerm);
}

export function normalizeTelegramChatMember(member: {
  status?: string;
  can_restrict_members?: boolean;
  can_pin_messages?: boolean;
  can_delete_messages?: boolean;
  can_manage_chat?: boolean;
}): { role?: string; permissions: string[] } {
  const permissions: string[] = [];
  const status = member.status;
  if (status === 'creator') {
    permissions.push('chat_creator', 'chat_administrator', 'restrict_members', 'pin_messages');
    return { role: 'owner', permissions };
  }
  if (status === 'administrator') {
    permissions.push('chat_administrator');
    if (member.can_restrict_members) permissions.push('restrict_members');
    if (member.can_pin_messages) permissions.push('pin_messages');
    if (member.can_delete_messages) permissions.push('delete_messages');
    if (member.can_manage_chat) permissions.push('manage_chat');
    return { role: 'admin', permissions };
  }
  return { role: 'member', permissions };
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
 * `permissions`（如 `restrict_members`、`pin_messages`）；member / 仍在群内的 restricted → `member`
 * （restricted 的 `can_*` 同样上报）；left / kicked → `guest`。Telegram 没有身份组，`roles` 不上报。
 */
export function telegramChatMemberStanding(member: { readonly status?: string; readonly is_member?: boolean }): PlatformStanding {
  const granted = Object.entries(member as Readonly<Record<string, unknown>>)
    .filter(([key, value]) => key.startsWith('can_') && value === true)
    .map(([key]) => key.slice(4));
  const status = member.status;
  if (status === 'creator') return { standing: 'owner', permissions: [...TELEGRAM_ADMIN_RIGHTS] };
  if (status === 'administrator') return { standing: 'admin', ...(granted.length ? { permissions: granted } : {}) };
  if (status === 'left' || status === 'kicked' || (status === 'restricted' && member.is_member === false)) return { standing: 'guest' };
  return { standing: 'member', ...(status === 'restricted' && granted.length ? { permissions: granted } : {}) };
}

export function checkTelegramPlatformPermit(perm: string, subject: PermissionSubject): boolean {
  // Native role names (e.g. Telegram `creator`) may still arrive until every adapter reports
  // the normalized standing (ADR 0056 §1); compare as plain strings.
  const role = subject.sender?.platform?.standing as string | undefined;
  const permissions = subject.sender?.platform?.permissions ?? [];
  // Accepts legacy UPPER_SNAKE tokens and ADR 0056 §1 snake_case platform permission names.
  const has = (t: string) => permissions.includes(t) || permissions.includes(t.toLowerCase());

  switch (perm) {
    case 'chat_creator':
      return role === 'owner' || role === 'creator' || has('chat_creator');
    case 'chat_administrator':
      return role === 'owner' || role === 'admin' || role === 'creator' || role === 'administrator' || has('chat_administrator');
    case 'restrict_members':
      return has('restrict_members') || role === 'owner' || role === 'creator';
    case 'pin_messages':
      return has('pin_messages') || role === 'owner' || role === 'creator';
    case 'manage_chat':
      return has('manage_chat') || role === 'owner' || role === 'creator';
    default:
      return false;
  }
}

