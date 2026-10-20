/**
 * Who may change a conversation's Bilibili subscriptions.
 *
 * - Private chat: the user manages their own conversation, no restriction.
 * - Group or channel: only the group owner, group admins or the bot master.
 *
 * `permit` lists are AND-only, so this "private OR role(...)" rule is evaluated
 * with the same built-in permit checker the command router uses, against the
 * platform-agnostic command session (`scene` / `sender.role`) that adapters project.
 */
import { checkBuiltinPermit } from 'zhin.js/command';

export const SUBSCRIPTION_MANAGER_ROLES_PERMIT = 'role(owner,admin,master)';
export const PRIVATE_CHAT_PERMIT = 'private()';

export const SUBSCRIPTION_PERMISSION_DENIED_MESSAGE =
  '只有群主、群管理员或机器人主人可以在群聊中修改 B 站订阅；私聊中可以直接订阅本会话。';

export interface SubscriptionPermissionSubject {
  readonly adapter?: string;
  readonly scene?: { readonly id: string; readonly type: string };
  readonly sender?: { readonly id: string; readonly role: readonly string[] };
}

export function canManageSubscription(subject: SubscriptionPermissionSubject): boolean {
  if (checkBuiltinPermit(PRIVATE_CHAT_PERMIT, subject)) return true;
  return checkBuiltinPermit(SUBSCRIPTION_MANAGER_ROLES_PERMIT, subject);
}
