import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  "userInfo": {
    "zh-CN": "已获取 {p0} 的用户信息:{p1}",
    "en": "User information for {p0}:{p1}"
  },
  "announcementSent": {
    "zh-CN": "群公告已发送",
    "en": "Group announcement sent"
  },
  "essenceRemoved": {
    "zh-CN": "已移除精华",
    "en": "Featured status removed"
  },
  "essenceAdded": {
    "zh-CN": "已设为精华",
    "en": "Message marked as featured"
  },
  "inviteAttempted": {
    "zh-CN": "已尝试邀请 {p0} 加入群 {p1}",
    "en": "Attempted to invite {p0} to group {p1}"
  },
  "memberExists": {
    "zh-CN": "目标成员已加入群",
    "en": "The member has already joined the group"
  },
  "groupMissing": {
    "zh-CN": "目标群不存在",
    "en": "The target group does not exist"
  },
  "memberKicked": {
    "zh-CN": "已踢出 {p0} 成员",
    "en": "Member {p0} removed"
  },
  "kickUnconfirmed": {
    "zh-CN": "平台未确认踢出成功，请勿自动重试",
    "en": "The platform did not confirm removal; do not retry automatically"
  },
  "kickForbidden": {
    "zh-CN": "当前权限或成员状态不允许踢出",
    "en": "Current permissions or member status do not allow removal"
  },
  "anonymousDisabled": {
    "zh-CN": "已关闭匿名聊天",
    "en": "Anonymous chat disabled"
  },
  "anonymousEnabled": {
    "zh-CN": "已开启匿名聊天",
    "en": "Anonymous chat enabled"
  },
  "anonymousForbidden": {
    "zh-CN": "机器人不是群主或管理员，无法开启或关闭匿名聊天",
    "en": "The bot must be a group owner or administrator to change anonymous chat"
  },
  "muted": {
    "zh-CN": "已禁言 {user} 成员({seconds}秒)",
    "en": "Muted member {user} ({seconds} seconds)"
  },
  "unmuted": {
    "zh-CN": "已解除禁言 {user} 成员",
    "en": "Unmuted member {user}"
  },
  "memberMissing": {
    "zh-CN": "目标成员不存在",
    "en": "The target member does not exist"
  },
  "muteForbidden": {
    "zh-CN": "机器人不是群主或管理员，无法禁言/解除禁言成员",
    "en": "The bot must be a group owner or administrator to mute or unmute members"
  },
  "titleChanged": {
    "zh-CN": "已将 {p0} 的头衔设为 \"{p1}\"",
    "en": "Title for {p0} set to \"{p1}\""
  },
  "titleForbidden": {
    "zh-CN": "机器人不是群主或管理员，无法设置头衔",
    "en": "The bot must be a group owner or administrator to set member titles"
  },
  "checkedIn": {
    "zh-CN": "群签到成功",
    "en": "Checked in to the group"
  },
  "poked": {
    "zh-CN": "已戳了戳 {p0}",
    "en": "Poked {p0}"
  },
  "filesEmpty": {
    "zh-CN": "群文件为空",
    "en": "The group has no files"
  },
  "likesSent": {
    "zh-CN": "已给 {p0} 点赞 {p1} 次",
    "en": "Sent {p1} likes to {p0}"
  },
  "likeFailed": {
    "zh-CN": "点赞失败",
    "en": "Could not send a like"
  }
});
