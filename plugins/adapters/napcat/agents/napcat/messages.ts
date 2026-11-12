import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  "messageOutsideGroup": {
    "zh-CN": "该消息不在当前群中",
    "en": "The message is not in the current group"
  },
  "conversationRequired": {
    "zh-CN": "此操作仅支持当前 QQ 群或私聊",
    "en": "This operation requires the current QQ group or private chat"
  },
  "privateRequired": {
    "zh-CN": "此操作仅支持当前私聊",
    "en": "This operation requires the current private chat"
  },
  "messageOutsideConversation": {
    "zh-CN": "该消息不在当前会话中",
    "en": "The message is not in the current conversation"
  },
  "hostMediaRefused": {
    "zh-CN": "{p0} 只能是 http(s) 链接、base64:// 数据或平台文件标识，不能是本机路径",
    "en": "{p0} must be an http(s) URL, base64:// data or a platform file token, not a local path"
  },
  "forwardTooDeep": {
    "zh-CN": "合并转发嵌套过深",
    "en": "The merged forward is nested too deeply"
  },
  "groupRequired": {
    "zh-CN": "此操作仅支持当前 QQ 群",
    "en": "This operation requires the current QQ group"
  },
  "likesSent": {
    "zh-CN": "已给 {p0} 点赞 {p1} 次",
    "en": "Sent {p1} likes to {p0}"
  },
  "memberTitleSet": {
    "zh-CN": "已设置 {p0} 头衔为 \"{p1}\"",
    "en": "Title for {p0} set to \"{p1}\""
  },
  "pokeTargetRequired": {
    "zh-CN": "群聊中请指定要戳的成员",
    "en": "Name the group member to poke"
  },
  "userPoked": {
    "zh-CN": "已戳 {p0}",
    "en": "Poked {p0}"
  }
});
