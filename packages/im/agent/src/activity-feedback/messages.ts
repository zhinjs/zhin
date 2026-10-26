import { createMessages } from '@zhin.js/plugin-runtime';

export const activityMessages = createMessages({
  queued: { 'zh-CN': '⏳', en: '⏳' },
  active: { 'zh-CN': '正在处理中...', en: 'Working...' },
  thinking: { 'zh-CN': '思考中...', en: 'Thinking...' },
  schedule_start: { 'zh-CN': '⏰ 定时任务执行中...', en: '⏰ Scheduled task running...' },
  schedule_finish: { 'zh-CN': '✅ 定时任务完成', en: '✅ Scheduled task completed' },
  schedule_error: { 'zh-CN': '❌ 定时任务失败', en: '❌ Scheduled task failed' },
});
