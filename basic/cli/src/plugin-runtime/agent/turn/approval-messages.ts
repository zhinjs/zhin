import { createMessages } from '@zhin.js/plugin-runtime';

export const approvalMessages = createMessages({
  title: { 'zh-CN': '操作确认', en: 'Confirm operation' },
  humanTip: { 'zh-CN': '此操作必须逐次人工确认。回复“同意”允许一次，“拒绝”拒绝。', en: 'Each operation requires human confirmation. Reply yes to allow once, or no to reject.' },
  tip: { 'zh-CN': '回复“同意”允许一次，“拒绝”拒绝；长期决定仅在当前 Host、当前会话和当前发起者范围内复用。', en: 'Reply yes to allow once, or no to reject. Remembered decisions apply only within this Host, conversation and requester scope.' },
  reject: { 'zh-CN': '拒绝', en: 'Reject' },
  rejectOnce: { 'zh-CN': '拒绝当前操作。', en: 'Reject this operation.' },
  rejectAlways: { 'zh-CN': '阻止当前及后续同类操作。', en: 'Block this and subsequent operations of the same kind.' },
  once: { 'zh-CN': '允许一次', en: 'Allow once' },
  onceDescription: { 'zh-CN': '仅执行当前操作。', en: 'Run only this operation.' },
  session: { 'zh-CN': '允许此会话', en: 'Allow for this conversation' },
  sessionDescription: { 'zh-CN': '当前会话中，所有发送者的同类操作持续放行。', en: 'Allow operations of this kind from every sender in this conversation.' },
  always: { 'zh-CN': '始终允许', en: 'Always allow' },
  alwaysDescription: { 'zh-CN': '当前会话中，此发送者的同类操作持续放行。', en: 'Allow operations of this kind from this sender in this conversation.' },
});
