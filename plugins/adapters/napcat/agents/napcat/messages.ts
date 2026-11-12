import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  "messageOutsideGroup": {
    "zh-CN": "该消息不在当前群中",
    "en": "The message is not in the current group"
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
  "userPoked": {
    "zh-CN": "已戳 {p0}",
    "en": "Poked {p0}"
  }
});
