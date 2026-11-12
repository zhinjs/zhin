/**
 * Who may change a conversation's earthquake subscriptions.
 *
 * - Private chat: the user manages their own conversation, no restriction.
 * - Group or channel: the chat role `admin` of the conversation (group owners / admins get it
 *   through the default mapping rule) or higher (ADR 0056).
 *
 * The rule itself lives in `canManageConversation` (`zhin.js/command`).
 */
export const SUBSCRIPTION_PERMISSION_DENIED_MESSAGE =
  '只有群主、群管理员或机器人主人可以在群聊中修改地震订阅；私聊中可以直接订阅本会话。';
