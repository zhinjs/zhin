import { createMessages, type Locale } from 'zhin.js/i18n';
import { PluginTaskError } from 'zhin.js/plugin-runtime';

const catalog = {
  "invalidTarget": {
    "zh-CN": "请提供完整有效的目标账号、会话、父容器和线程",
    "en": "Provide a complete valid account, conversation, parent container and thread."
  },
  "requestReused": {
    "zh-CN": "同一请求 ID 已用于其他内容",
    "en": "This request ID was already used for different content."
  },
  "invalidAction": {
    "zh-CN": "任务 ID 或操作无效",
    "en": "Invalid task ID or action."
  },
  "updateParameters": {
    "zh-CN": "仅编辑操作接受参数",
    "en": "Only the update action accepts parameters."
  },
  "finished": {
    "zh-CN": "任务已结束，不能再次取消",
    "en": "This task has ended and cannot be cancelled again."
  },
  "invalidMutation": {
    "zh-CN": "操作须包含 UUID requestId 和读取到的 expectedRevision",
    "en": "The operation requires a UUID requestId and the expectedRevision read from the task list."
  },
  "replayConflict": {
    "zh-CN": "同一操作请求 ID 已用于其他内容，禁止重放",
    "en": "This operation request ID was used for different content and cannot be replayed."
  },
  "delivering": {
    "zh-CN": "投递中或未确认；不会自动重试",
    "en": "Delivery is in progress or unconfirmed; no automatic retry."
  },
  "quota": {
    "zh-CN": "管理员提醒池已达上限，请先取消任务；聊天个人提醒使用独立配额",
    "en": "The administrator reminder quota is full. Cancel a task first; chat reminders have a separate quota."
  },
  "notFound": {
    "zh-CN": "未找到当前实例的管理员任务；聊天任务不在此入口管理",
    "en": "No administrator task was found in this instance. Chat tasks are managed separately."
  },
  "pauseState": {
    "zh-CN": "仅待执行任务可以暂停；未确认投递不能暂停或恢复",
    "en": "Only scheduled tasks can be paused. Unconfirmed deliveries cannot be paused or resumed."
  },
  "resumeState": {
    "zh-CN": "仅已暂停任务可以恢复；未确认投递不能恢复或重试",
    "en": "Only paused tasks can be resumed. Unconfirmed deliveries cannot be resumed or retried."
  },
  "expired": {
    "zh-CN": "一次性任务时间已过，请先编辑为未来时间再恢复",
    "en": "This one-time reminder is past due. Set a future time before resuming."
  },
  "updateState": {
    "zh-CN": "编辑前请先暂停任务；未确认投递不能编辑",
    "en": "Pause the task before editing. Unconfirmed deliveries cannot be edited."
  },
  "stopped": {
    "zh-CN": "管理员提醒服务属于已停止的插件实例",
    "en": "This administrator reminder service belongs to a stopped plugin instance."
  },
  "retired": {
    "zh-CN": "管理员提醒服务属于未发布或已退役的 generation",
    "en": "This administrator reminder service belongs to an unpublished or retired generation."
  },
  "invalidParameters": {
    "zh-CN": "参数须包含 1–500 字提醒内容、带 offset 的 ISO 时间及可选的 60 秒至一年整数周期",
    "en": "Provide 1–500 characters of reminder text, an ISO time with an explicit offset, and optionally an integer interval from 60 seconds to one year."
  },
  "invalidInstant": {
    "zh-CN": "提醒时间须为有效且带 Z 或 ±hh:mm 的 ISO 时间",
    "en": "Use a valid ISO reminder time with Z or an explicit ±hh:mm offset."
  },
  "future": {
    "zh-CN": "提醒时间须在未来一年内",
    "en": "The reminder must be scheduled within the next year."
  },
  "revision": {
    "zh-CN": "任务列表已变化，请刷新后重新确认操作",
    "en": "The task list changed. Refresh it and confirm the operation again."
  },
  "capacity": {
    "zh-CN": "管理员提醒池状态达到 32 条或 60 KiB 上限，请先取消并整理任务",
    "en": "Administrator reminders reached the 32-task or 60 KiB limit. Cancel and clean up tasks first."
  },
  "corrupt": {
    "zh-CN": "管理员提醒持久状态格式无效，已停止投递",
    "en": "Administrator reminder storage is invalid. Delivery has stopped."
  },
  "waiting": {
    "zh-CN": "等待执行",
    "en": "Waiting to run"
  },
  "paused": {
    "zh-CN": "管理员暂停",
    "en": "Paused by an administrator"
  },
  "resumedSkipping": {
    "zh-CN": "已恢复，并跳过错过的周期轮次",
    "en": "Resumed; missed intervals were skipped"
  },
  "resumed": {
    "zh-CN": "管理员恢复",
    "en": "Resumed by an administrator"
  },
  "edited": {
    "zh-CN": "已编辑，保持暂停；请确认后恢复",
    "en": "Updated and still paused. Confirm before resuming."
  },
  "cancelled": {
    "zh-CN": "管理员取消；已经开始的投递无法撤回",
    "en": "Cancelled by an administrator. A delivery already in progress cannot be recalled."
  },
  "skipped": {
    "zh-CN": "已跳过错过的周期轮次",
    "en": "Missed intervals were skipped"
  },
  "unknown": {
    "zh-CN": "平台未确认投递，请核实目标会话后取消并另建任务；不会自动重试",
    "en": "The platform did not confirm delivery. Check the target conversation, then cancel and create another task; no automatic retry."
  },
  "delivered": {
    "zh-CN": "已确认投递",
    "en": "Delivery confirmed"
  },
  "rejected": {
    "zh-CN": "平台明确未投递或拒绝；任务已停止",
    "en": "The platform confirmed no delivery or rejected it. The task has stopped."
  },
  "stateNote": {
    "zh-CN": "{detail}；状态仅表示调度事实，不代表平台连接或投递健康",
    "en": "{detail}; state records scheduling facts, not platform connection or delivery health."
  }
} as const;
export const adminText = createMessages(catalog);
export type AdminTextKey = keyof typeof catalog;
export function isAdminTextKey(value: unknown): value is AdminTextKey { return typeof value === 'string' && Object.hasOwn(catalog, value); }

/** Persist a stable presentation key; preserve legacy text for older readers. */
export function taskDetail(detailKey: AdminTextKey) { return { detailKey, detail: adminText('zh-CN', detailKey) }; }
export function formatTaskDetail(task: { detail: string; detailKey?: AdminTextKey }, locale?: Locale): string {
  return task.detailKey ? adminText(locale, task.detailKey) : task.detail;
}

export class LocalizedTaskError extends PluginTaskError {
  readonly messageKey: AdminTextKey;
  constructor(code: ConstructorParameters<typeof PluginTaskError>[0], messageKey: AdminTextKey) {
    super(code, adminText('zh-CN', messageKey)); this.messageKey = messageKey;
  }
  localize(locale?: Locale): PluginTaskError { return new PluginTaskError(this.code, adminText(locale, this.messageKey)); }
}
