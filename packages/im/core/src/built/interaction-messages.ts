import { createMessages } from '@zhin.js/plugin-runtime';

export const interactionMessages = createMessages({
  fallback: { 'zh-CN': '也可以直接回复对应内容。', en: 'You can also reply with the corresponding answer.' },
  minLength: { 'zh-CN': '请至少输入 {count} 个字符', en: 'Enter at least {count} characters' },
  maxLength: { 'zh-CN': '请不要超过 {count} 个字符', en: 'Enter no more than {count} characters' },
  pattern: { 'zh-CN': '输入格式不正确', en: 'The input format is invalid' },
  number: { 'zh-CN': '请输入有效数字', en: 'Enter a valid number' },
  integer: { 'zh-CN': '请输入整数', en: 'Enter an integer' },
  min: { 'zh-CN': '请输入不小于 {count} 的数字', en: 'Enter a number greater than or equal to {count}' },
  max: { 'zh-CN': '请输入不大于 {count} 的数字', en: 'Enter a number less than or equal to {count}' },
  confirmOrCancel: { 'zh-CN': '请选择确认或取消', en: 'Choose confirm or cancel' },
  select: { 'zh-CN': '请选择一个有效选项', en: 'Choose a valid option' },
  invalidSelection: { 'zh-CN': '多选中包含无效选项', en: 'The selection contains an invalid option' },
  minSelections: { 'zh-CN': '请至少选择 {count} 项', en: 'Select at least {count} items' },
  maxSelections: { 'zh-CN': '请最多选择 {count} 项', en: 'Select no more than {count} items' },
  minItems: { 'zh-CN': '请至少输入 {count} 项', en: 'Enter at least {count} items' },
  maxItems: { 'zh-CN': '请最多输入 {count} 项', en: 'Enter no more than {count} items' },
  invalidNumbers: { 'zh-CN': '列表中包含无效数字', en: 'The list contains an invalid number' },
  invalidBooleans: { 'zh-CN': '布尔列表只接受 true/false 或 是/否', en: 'Boolean lists accept only true/false or yes/no' },
  confirm: { 'zh-CN': '确认', en: 'Confirm' },
  cancel: { 'zh-CN': '取消', en: 'Cancel' },
  confirmation: { 'zh-CN': '请选择确认或取消。', en: 'Choose confirm or cancel.' },
  // Shown whether or not the endpoint renders buttons: replying always works, buttons speak for themselves (#1250).
  // #1250 `interaction-prompt-swallows-messages`: every choice-like prompt says how to leave it.
  selection: { 'zh-CN': '回复序号或选项名称，或回复「取消」退出。', en: 'Reply with an option number or name, or reply "cancel" to exit.' },
  multiple: { 'zh-CN': '回复序号或选项名称，多项用“{separator}”分隔，或回复「取消」退出。', en: 'Reply with option numbers or names, separated by "{separator}", or reply "cancel" to exit.' },
  list: { 'zh-CN': '多项用“{separator}”分隔，或回复「取消」退出。', en: 'Separate items with "{separator}", or reply "cancel" to exit.' },
  numberInstruction: { 'zh-CN': '回复一个数字，或回复「取消」退出。', en: 'Reply with a number, or reply "cancel" to exit.' },
  // ADR 0061 decision 11 (revised): throttled reminders replace waiting silently.
  waitingSelect: { 'zh-CN': '正在等你选择，回复序号，或回复「取消」退出。', en: 'Still waiting for your choice: reply with an option number, or reply "cancel" to exit.' },
  waitingAnswer: { 'zh-CN': '正在等你回答，按提示回复，或回复「取消」退出。', en: 'Still waiting for your answer: reply as asked, or reply "cancel" to exit.' },
  // Shown only to a text prompt with rules (an unrestricted one takes any text): a command that
  // meets the rules would be taken as the answer, so only the exits that always work are named.
  waitingText: { 'zh-CN': '正在等你回答，按提示回复；回复「取消」或发送图片、文件即可退出。', en: 'Still waiting for your answer: reply as asked, or reply "cancel" or send an image or file to exit.' },
  exited: { 'zh-CN': '已退出上一个选择。', en: 'Left the previous question.' },
  cancelled: { 'zh-CN': '已取消。', en: 'Cancelled.' },
  ended: { 'zh-CN': '交互已结束', en: 'Interaction ended' },
  denied: { 'zh-CN': '你不能使用这个按钮：{reason}', en: 'You cannot use this button: {reason}' },
  expired: { 'zh-CN': '交互已过期或不可用，请重新发起。', en: 'This interaction has expired or is unavailable. Start a new one.' },
  timeout: { 'zh-CN': '输入超时', en: 'Input timed out' },
});
