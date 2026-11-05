import { createMessages } from '@zhin.js/plugin-runtime';

export const approvalMessages = createMessages({
  title: { 'zh-CN': '操作确认', en: 'Confirm operation' },
  humanTip: { 'zh-CN': '仅确认本次操作。', en: 'Confirmation applies to this operation only.' },
  tip: { 'zh-CN': '长期授权仅限当前 Host 和会话。', en: 'Remembered decisions apply only to this Host and conversation.' },
  reject: { 'zh-CN': '拒绝', en: 'Reject' },
  rejectAlways: { 'zh-CN': '拒绝本次及后续同类操作', en: 'Reject this and future matching operations' },
  once: { 'zh-CN': '允许一次', en: 'Allow once' },
  session: { 'zh-CN': '允许此会话', en: 'Allow for this conversation' },
  sessionLabel: { 'zh-CN': '允许此会话（所有人）', en: 'Allow in this conversation (everyone)' },
  always: { 'zh-CN': '始终允许', en: 'Always allow' },
  alwaysLabel: { 'zh-CN': '始终允许（本会话、仅此人）', en: 'Always allow (this conversation and sender)' },
});
