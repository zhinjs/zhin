import { Schema } from 'zhin.js';

export const reminderConfig = Schema.object({
  timezone: Schema.string().default('UTC').description('显示提醒时间的 IANA 时区；绝对时间仍必须提供 ISO offset').effect('reload'),
  maxTasks: Schema.number().min(1).max(32).step(1).default(20).description('每实例聊天个人提醒池的活跃任务上限；与管理员池独立，降低上限不删除既有任务').effect('reload'),
  adminMaxTasks: Schema.number().min(1).max(32).step(1).default(20).description('每实例管理员提醒池的活跃任务上限（待执行、暂停或未确认）；与聊天池独立，两池总量可达上限之和').effect('reload'),
  maxTasksPerSender: Schema.number().min(1).max(10).step(1).default(10).description('同一发送者在同一会话的任务上限').effect('reload'),
  batchSize: Schema.number().min(1).max(5).step(1).default(5).description('每次扫描最多投递的任务数').effect('reload'),
  missedGraceSeconds: Schema.number().min(5).max(60).step(1).default(15).description('周期轮次超过此延迟后跳过；停机期间不补历史轮次').effect('reload'),
});

export type ReminderConfig = Schema.Output<typeof reminderConfig>;

export function assertReminderTimezone(timezone: string): void {
  try { new Intl.DateTimeFormat('zh-CN', { timeZone: timezone }).format(0); }
  catch { throw new TypeError(`提醒 timezone 必须是有效的 IANA 时区：${timezone}`); }
}
