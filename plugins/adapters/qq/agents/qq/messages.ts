import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  "operationFailed": {
    "zh-CN": "操作失败",
    "en": "Operation failed"
  },
  "roleAdded": {
    "zh-CN": "已给成员添加角色",
    "en": "Role added to the member"
  },
  "createFailed": {
    "zh-CN": "创建失败",
    "en": "Creation failed"
  },
  "namedRoleCreated": {
    "zh-CN": "角色 \"{p0}\" 创建成功",
    "en": "Role \"{p0}\" created"
  },
  "roleRemoved": {
    "zh-CN": "已移除成员的角色",
    "en": "Role removed from the member"
  },
  "conversationRequired": {
    "zh-CN": "此操作需要当前 QQ 官方机器人会话",
    "en": "This operation requires the current QQ official bot conversation"
  },
  "groupRequired": {
    "zh-CN": "此操作仅支持当前 QQ 群",
    "en": "This operation requires the current QQ group"
  },
  "channelRequired": {
    "zh-CN": "此操作仅支持当前 QQ 频道子频道",
    "en": "This operation requires the current QQ guild channel"
  },
  "messageOutsideConversation": {
    "zh-CN": "该消息 ID 不属于当前会话，请勿猜测消息 ID",
    "en": "The message ID does not belong to this conversation; do not guess message IDs"
  },
  "ownMessageRequired": {
    "zh-CN": "该工具只能撤回机器人自己发送的消息（发送回执里的消息 ID）",
    "en": "This tool can only recall messages the bot sent (the ID from its send receipt)"
  },
  "botNotManager": {
    "zh-CN": "机器人当前不是本群群主或管理员，平台不允许此操作",
    "en": "The bot is not an owner or admin of this group, so the platform does not allow this"
  },
  "targetNotMember": {
    "zh-CN": "目标必须是本群的普通成员（官方不允许处置群主、管理员或机器人）",
    "en": "The target must be an ordinary member of this group (owners, admins and bots cannot be targeted)"
  },
  "messageRecalled": {
    "zh-CN": "平台已确认撤回消息",
    "en": "The platform confirmed the message was recalled"
  },
  "recallUnconfirmed": {
    "zh-CN": "平台未确认撤回成功（官方只允许撤回 2 分钟内的消息），请勿自动重试",
    "en": "Recall was not confirmed (QQ only allows recalling messages younger than 2 minutes); do not retry automatically"
  },
  "memberKicked": {
    "zh-CN": "已将成员 {p0} 移出本群",
    "en": "Removed member {p0} from this group"
  },
  "blacklistFailed": {
    "zh-CN": "成员已移出，但加入黑名单失败",
    "en": "The member was removed, but adding them to the blacklist failed"
  },
  "muted": {
    "zh-CN": "已禁言 {user} {seconds} 秒",
    "en": "Muted {user} for {seconds} seconds"
  },
  "unmuted": {
    "zh-CN": "已解除 {user} 的禁言",
    "en": "Unmuted {user}"
  },
  "joinApproved": {
    "zh-CN": "已通过 {user} 的入群申请",
    "en": "Approved the join request from {user}"
  },
  "joinDeclined": {
    "zh-CN": "已拒绝 {user} 的入群申请",
    "en": "Declined the join request from {user}"
  }
});
