import { Schema } from 'zhin.js';

export const reminderConfig = Schema.object({
  timezone: Schema.string().default('UTC').description('解释 create 自然时间并显示提醒的 IANA 时区；ISO 绝对时间仍须显式 offset').i18n({"en": {"description": "IANA timezone for natural reminder times and display. Absolute ISO times still require an explicit offset."}}).effect('reload'),
  maxTasks: Schema.number().min(1).max(32).step(1).default(20).description('每实例聊天个人提醒池的活跃任务上限；与管理员池独立，降低上限不删除既有任务').i18n({"en": {"description": "Maximum active personal chat reminders per instance, separate from administrator tasks. Lowering the limit does not delete existing tasks."}}).effect('reload'),
  adminMaxTasks: Schema.number().min(1).max(32).step(1).default(20).description('每实例管理员提醒池的活跃任务上限（待执行、暂停或未确认）；与聊天池独立，两池总量可达上限之和').i18n({"en": {"description": "Maximum active administrator reminders (scheduled, paused or unconfirmed) per instance. Separate from chat tasks; the two quotas are additive."}}).effect('reload'),
  maxTasksPerSender: Schema.number().min(1).max(10).step(1).default(10).description('同一发送者在同一会话的任务上限').i18n({"en": {"description": "Maximum tasks per sender in the same conversation."}}).effect('reload'),
  batchSize: Schema.number().min(1).max(5).step(1).default(5).description('每次扫描最多投递的任务数').i18n({"en": {"description": "Maximum tasks delivered in each scan."}}).effect('reload'),
  missedGraceSeconds: Schema.number().min(5).max(60).step(1).default(15).description('周期轮次超过此延迟后跳过；停机期间不补历史轮次').i18n({"en": {"description": "Skip recurring runs delayed beyond this many seconds. Missed runs during downtime are not backfilled."}}).effect('reload'),
});

export type ReminderConfig = Schema.Output<typeof reminderConfig>;

export function assertReminderTimezone(timezone: string): void {
  try {
    if (!timezone || timezone.length > 100 || timezone !== timezone.trim() || /^[+-]/u.test(timezone)) throw new RangeError('Invalid IANA timezone');
    new Intl.DateTimeFormat('zh-CN', { timeZone: timezone }).format(0);
  }
  catch { throw new TypeError(`提醒 timezone 必须是有效的 IANA 时区：${timezone}`); }
}
