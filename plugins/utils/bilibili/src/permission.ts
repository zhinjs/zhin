/**
 * Who may change a conversation's Bilibili subscriptions.
 *
 * - Private chat: the user manages their own conversation, no restriction.
 * - Group or channel: only the group owner, group admins or the bot master.
 *
 * The rule itself lives in `canManageConversation` (`zhin.js/command`); adapters project
 * the canonical `owner` / `admin` role names that it checks.
 */
export const SUBSCRIPTION_PERMISSION_DENIED_MESSAGE =
  '只有群主、群管理员或机器人主人可以在群聊中修改 B 站订阅；私聊中可以直接订阅本会话。';
