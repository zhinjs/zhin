/**
 * Who may change a conversation's earthquake subscriptions.
 *
 * - Private chat: the user manages their own conversation, no restriction.
 * - Group or channel: the zhin chat role `admin` of the conversation or higher (ADR 0056).
 *   Subscriptions are a zhin function: a platform group owner / admin needs a granted role.
 *
 * The rule itself lives in `canManageConversation` (`zhin.js/command`).
 */
export const SUBSCRIPTION_PERMISSION_DENIED_MESSAGE =
  '只有本会话的 zhin 管理员（admin）或机器人主人（owner）可以在群聊中修改地震订阅；私聊中可以直接订阅本会话。';
