import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  "reactionAdded": {
    "zh-CN": "已添加反应 {p0}",
    "en": "Reaction added: {p0}"
  },
  "notTextChannel": {
    "zh-CN": "Channel {p0} 不是文本频道",
    "en": "Channel {p0} is not a text channel"
  },
  "embedSent": {
    "zh-CN": "Embed 已发送",
    "en": "Embed sent"
  },
  "invalidFields": {
    "zh-CN": "fields 格式错误，应为 JSON 数组",
    "en": "fields must be a JSON array"
  },
  "operationFailed": {
    "zh-CN": "操作失败",
    "en": "Operation failed"
  },
  "memberRoleAdded": {
    "zh-CN": "已给用户 {p0} 添加角色",
    "en": "Role added to user {p0}"
  },
  "threadCreated": {
    "zh-CN": "帖子 \"{p0}\" 已创建",
    "en": "Thread \"{p0}\" created"
  },
  "threadsUnsupported": {
    "zh-CN": "Channel {p0} 不支持创建帖子",
    "en": "Channel {p0} does not support creating threads"
  },
  "forumCreated": {
    "zh-CN": "论坛帖 \"{p0}\" 已创建",
    "en": "Forum post \"{p0}\" created"
  },
  "notForumChannel": {
    "zh-CN": "Channel {p0} 不是论坛频道",
    "en": "Channel {p0} is not a forum channel"
  },
  "memberRoleRemoved": {
    "zh-CN": "已移除用户 {p0} 的角色",
    "en": "Role removed from user {p0}"
  }
});
