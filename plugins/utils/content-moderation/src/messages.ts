import { createMessages } from 'zhin.js/i18n';

export const moderationMessages = createMessages({
  blocked: { 'zh-CN': '消息含不当内容，已拦截。', en: 'This message contains inappropriate content and was blocked.' },
  advertising: { 'zh-CN': '请勿发布未经请求的广告或引流信息', en: 'Do not post unsolicited advertising or promotional invitations' },
  abuse: { 'zh-CN': '请勿针对他人进行人身攻击', en: 'Do not direct personal attacks at others' },
  kicked: { 'zh-CN': '入群 10 分钟内发布明确广告，已移出群聊', en: 'Removed from the group for posting clear advertising within 10 minutes of joining' },
  muted: { 'zh-CN': '已禁言 10 分钟', en: 'Muted for 10 minutes' },
  warning: { 'zh-CN': '警告', en: 'Warning' },
  reminder: { 'zh-CN': '提醒', en: 'Reminder' },
  notice: { 'zh-CN': '{action}。{rule}。', en: '{action}. {rule}.' },
});
