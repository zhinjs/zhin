import { Schema } from 'zhin.js';

export const reminderConfig = Schema.object({
  timezone: Schema.string().default('UTC').description('显示提醒时间的 IANA 时区；绝对时间仍必须提供 ISO offset').effect('reload'),
  maxTasks: Schema.number().min(1).max(32).step(1).default(20).description('每个插件实例最多保留的任务记录数').effect('reload'),
  maxTasksPerSender: Schema.number().min(1).max(10).step(1).default(10).description('同一发送者在同一会话的任务上限').effect('reload'),
  batchSize: Schema.number().min(1).max(5).step(1).default(5).description('每次扫描最多投递的任务数').effect('reload'),
  missedGraceSeconds: Schema.number().min(5).max(60).step(1).default(15).description('周期轮次超过此延迟后跳过；停机期间不补历史轮次').effect('reload'),
});

export type ReminderConfig = Schema.Output<typeof reminderConfig>;

export function assertReminderTimezone(timezone: string): void {
  try { new Intl.DateTimeFormat('zh-CN', { timeZone: timezone }).format(0); }
  catch { throw new TypeError(`提醒 timezone 必须是有效的 IANA 时区：${timezone}`); }
}
