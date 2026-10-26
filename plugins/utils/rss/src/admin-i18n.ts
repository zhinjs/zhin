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
  "exactTarget": {
    "zh-CN": "管理员 RSS 需要支持精确目标的 Outbound Host",
    "en": "Administrator RSS requires an Outbound Host with exact-target delivery."
  },
  "quota": {
    "zh-CN": "管理员 RSS 订阅已达 8 条上限，请先取消任务",
    "en": "The administrator RSS limit of 8 subscriptions has been reached. Cancel a task first."
  },
  "duplicate": {
    "zh-CN": "此完整目标已有该源的管理员订阅，请先核实原任务",
    "en": "This exact target already has an administrator subscription for this feed. Check the existing task."
  },
  "duplicateUpdate": {
    "zh-CN": "此完整目标已有该源的管理员订阅",
    "en": "This exact target already has an administrator subscription for this feed."
  },
  "notFound": {
    "zh-CN": "未找到当前实例的管理员 RSS 订阅；聊天订阅不在此入口管理",
    "en": "No administrator RSS subscription was found in this instance. Chat subscriptions are managed separately."
  },
  "pauseState": {
    "zh-CN": "仅待轮询订阅可以暂停",
    "en": "Only scheduled subscriptions can be paused."
  },
  "resumeState": {
    "zh-CN": "仅暂停订阅可以恢复；未确认投递不能恢复或重试",
    "en": "Only paused subscriptions can be resumed. Unconfirmed deliveries cannot be resumed or retried."
  },
  "updateState": {
    "zh-CN": "编辑前请先暂停订阅；未确认投递不能编辑",
    "en": "Pause the subscription before editing. Unconfirmed deliveries cannot be edited."
  },
  "stopped": {
    "zh-CN": "管理员 RSS 服务属于已停止的插件实例",
    "en": "This administrator RSS service belongs to a stopped plugin instance."
  },
  "retired": {
    "zh-CN": "管理员 RSS 服务属于未发布或已退役的 generation",
    "en": "This administrator RSS service belongs to an unpublished or retired generation."
  },
  "invalidParameters": {
    "zh-CN": "参数须包含有效 HTTP(S) RSS 地址及可选的三项静默设置",
    "en": "Provide a valid HTTP(S) feed URL and optionally all three quiet-hours settings."
  },
  "invalidQuiet": {
    "zh-CN": "静默设置无效",
    "en": "Invalid quiet-hours settings."
  },
  "invalidUrl": {
    "zh-CN": "请提供有效 HTTP(S) RSS 地址，不接受 URL 用户名或密码",
    "en": "Provide a valid HTTP(S) feed URL without a username or password."
  },
  "revision": {
    "zh-CN": "订阅状态已变化，请刷新后重新确认",
    "en": "Subscription state changed. Refresh it and confirm again."
  },
  "capacity": {
    "zh-CN": "管理员 RSS 状态达到 8 条或 60 KiB 上限，请先取消并整理订阅",
    "en": "Administrator RSS reached the 8-task or 60 KiB limit. Cancel and clean up subscriptions first."
  },
  "capacityReserved": {
    "zh-CN": "管理员 RSS 状态空间不足以保留静默摘要及去重游标；请先取消并整理订阅，现有数据未改动",
    "en": "There is not enough RSS storage for quiet-hour summaries and deduplication cursors. Cancel and clean up subscriptions first; existing data has not changed."
  },
  "corrupt": {
    "zh-CN": "管理员 RSS 持久状态格式无效，已停止管理员轮询与投递；请保留原数据核查",
    "en": "Administrator RSS storage is invalid. Polling and delivery have stopped; preserve the original data for investigation."
  },
  "waiting": {
    "zh-CN": "等待首次抓取建立基线，不发送历史文章",
    "en": "Waiting for the first fetch to establish a baseline; historical articles will not be sent."
  },
  "paused": {
    "zh-CN": "管理员暂停并清空待发摘要；恢复时重新建立基线，不补发历史文章",
    "en": "Paused by an administrator and pending summaries cleared. Resuming establishes a new baseline without backfilling articles."
  },
  "resumed": {
    "zh-CN": "已恢复，等待重新建立基线，不补发历史文章",
    "en": "Resumed; waiting for a new baseline without backfilling articles."
  },
  "edited": {
    "zh-CN": "已编辑并清空待发摘要，保持暂停，恢复后首次抓取只建立基线",
    "en": "Updated and pending summaries cleared; still paused. The first fetch after resuming only establishes a baseline."
  },
  "cancelled": {
    "zh-CN": "管理员取消并清空待发摘要；已经开始的投递无法撤回",
    "en": "Cancelled by an administrator and pending summaries cleared. A delivery already in progress cannot be recalled."
  },
  "fetchFailed": {
    "zh-CN": "源站抓取失败；尚未尝试投递，下轮重查",
    "en": "Feed fetch failed. No delivery was attempted; it will be checked on the next poll."
  },
  "baseline": {
    "zh-CN": "已建立基线；从后续新文章开始推送",
    "en": "Baseline established; only future articles will be delivered."
  },
  "noNew": {
    "zh-CN": "抓取完成，暂无新文章",
    "en": "Fetch completed; no new articles."
  },
  "quietPending": {
    "zh-CN": "静默中，已积累更新；退出静默后的首轮轮询汇总",
    "en": "Quiet hours are active; updates are queued for the first poll after quiet hours."
  },
  "summaryDelivering": {
    "zh-CN": "摘要投递中或未确认；不会自动重试",
    "en": "Summary delivery is in progress or unconfirmed; no automatic retry."
  },
  "unknown": {
    "zh-CN": "平台未确认投递，请核实目标会话后取消并另建订阅；不会自动重试",
    "en": "The platform did not confirm delivery. Check the target conversation, then cancel and create another subscription; no automatic retry."
  },
  "delivered": {
    "zh-CN": "已确认投递；等待后续新文章",
    "en": "Delivery confirmed; waiting for future articles."
  },
  "rejected": {
    "zh-CN": "平台明确未投递或拒绝；订阅已停止",
    "en": "The platform confirmed no delivery or rejected it. The subscription has stopped."
  },
  "quietDescription": {
    "zh-CN": "静默 {timezone} {start}–{end}",
    "en": "Quiet hours: {timezone} {start}–{end}"
  },
  "pendingDescription": {
    "zh-CN": "待汇总{count} 条更新",
    "en": "Queued summary: {count} updates"
  },
  "summaryDescription": {
    "zh-CN": "本次摘要{count} 条更新",
    "en": "Current summary: {count} updates"
  },
  "countCapped": {
    "zh-CN": "至少{count}",
    "en": "at least {count}"
  },
  "pollDescription": {
    "zh-CN": "实例轮询 {cron}",
    "en": "Instance polling: {cron}"
  },
  "checkedDescription": {
    "zh-CN": "最近抓取 {at}",
    "en": "Last fetched: {at}"
  },
  "stateNote": {
    "zh-CN": "状态不代表平台连接健康",
    "en": "State does not represent platform connection health."
  },
  "quietFields": {
    "zh-CN": "静默时区、开始和结束时间须全部填写；三项全部留空关闭静默",
    "en": "Provide the quiet timezone, start and end together. Leave all three empty to disable quiet hours."
  },
  "quietZoneOffset": {
    "zh-CN": "请填写有效 IANA 时区，如 Asia/Shanghai；不能使用 +08:00 等偏移",
    "en": "Use an IANA timezone such as Asia/Shanghai, not a fixed offset such as +08:00."
  },
  "quietZone": {
    "zh-CN": "请填写有效 IANA 时区，如 Asia/Shanghai",
    "en": "Use a valid IANA timezone such as Asia/Shanghai."
  },
  "quietClock": {
    "zh-CN": "静默时间须为 HH:mm（24 小时制），开始和结束不能相同",
    "en": "Use HH:mm in 24-hour format; quiet start and end must be different."
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
