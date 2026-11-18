/**
 * ADR 0061 §1: every inbound message ends with exactly one outcome. This module holds the closed
 * code table (append-only: deprecated codes stay), the priority order used when one message
 * collects several candidates, the default visibility / reply per code and the zh-CN / en
 * templates shown to the sender and to administrators.
 */
import type { ConversationRef } from '@zhin.js/im-contract';
import type { Locale, PluginId } from '@zhin.js/plugin-runtime';

/** Outcome codes (ADR 0061 §1.1–§1.6). Snake case, append-only. @public */
export const MESSAGE_OUTCOMES = Object.freeze([
  // §1.1 replied
  'replied', 'command_replied', 'handler_replied', 'interaction_answered', 'suggested', 'refused',
  // §1.2 not executed, explained in chat
  'invalid_input', 'permission_denied', 'rate_limited', 'approval_denied', 'approval_timeout', 'approval_unavailable',
  'tool_failed_reported', 'model_timeout', 'model_error', 'budget_exhausted',
  // §1.2 (#1250): a prompt the sender left or did not answer ended the command normally
  'interaction_timeout', 'interaction_cancelled',
  // §1.3 no reply by design
  'not_addressed', 'feature_disabled', 'ambient_silent', 'model_silent', 'merged', 'superseded', 'cleared',
  'interaction_consumed',
  // §1.4 filtered by policy
  'filtered_by_policy', 'media_rejected',
  // §1.5 replay only
  'ignored_self', 'ignored_bot', 'dropped_duplicate', 'dropped_unready', 'dropped_dedup_error', 'dropped_retired',
  // §1.6 failures
  'delivery_failed', 'internal_error', 'unrecorded',
] as const);

/** @public */
export type MessageOutcome = typeof MESSAGE_OUTCOMES[number];

/** Where an outcome was decided (ADR 0061 §2 `stage`). @public */
export const MESSAGE_OUTCOME_STAGES = Object.freeze([
  'ingress', 'interaction', 'middleware', 'handlers', 'command', 'suggestion', 'agent_gate', 'ambient',
  'admission', 'model', 'tool', 'delivery',
] as const);

/** @public */
export type MessageOutcomeStage = typeof MESSAGE_OUTCOME_STAGES[number];

/** Who may read the human-readable reason: the sender, administrators only, or the replay only. @public */
export type MessageOutcomeVisibility = 'sender' | 'admin' | 'replay';

/** Whether the bot said something in chat: `yes`, `no` (by design) or `throttled` (at most once per minute). @public */
export type MessageOutcomeReply = 'yes' | 'no' | 'throttled';

/** One candidate reported while the message is processed; the ledger keeps the highest. @public */
export interface MessageOutcomeCandidate {
  readonly outcome: MessageOutcome;
  /** Closed sub-reason; existing codes (command status, decision reason codes, `ProviderErrorKind`) are reused. */
  readonly reason?: string;
  readonly stage: MessageOutcomeStage;
  readonly visibility?: MessageOutcomeVisibility;
  readonly reply?: MessageOutcomeReply;
  readonly command?: string;
  readonly owner?: PluginId | string;
  readonly turnId?: string;
  readonly mergedInto?: string;
  readonly errorId?: string;
  /** Administrator-only detail; redacted and cut to 200 characters before it is kept. */
  readonly detail?: string;
  /** Extra codes kept beside the winning outcome (for example `media_rejected:too_large`). */
  readonly facets?: readonly string[];
}

/** The settled outcome of one inbound message. No message body is kept (ADR 0061 §2). @public */
export interface MessageOutcomeRecord {
  readonly id: string;
  readonly receivedAt: number;
  readonly settledAt: number;
  readonly generation?: number;
  readonly conversation: ConversationRef;
  /** Platform (client adapter) and `<scope>:<sceneId>`, the same as `ai_decision_events`. */
  readonly platform: string;
  readonly sceneId: string;
  readonly senderId?: string;
  readonly messageId?: string;
  /** Private chat, mention, command prefix, or a reply to the bot (ADR 0061 §1). */
  readonly addressed: boolean;
  readonly outcome: MessageOutcome;
  readonly reason?: string;
  readonly facets: readonly string[];
  readonly stage: MessageOutcomeStage;
  readonly visibility: MessageOutcomeVisibility;
  readonly reply: MessageOutcomeReply;
  readonly command?: string;
  readonly owner?: string;
  readonly turnId?: string;
  readonly diagnosticId?: string;
  readonly errorId?: string;
  readonly mergedInto?: string;
  readonly detail?: string;
  /** Last stage the message reached; set on `unrecorded`. */
  readonly lastStage?: MessageOutcomeStage;
}

const TIER: Readonly<Record<MessageOutcome, number>> = Object.freeze({
  internal_error: 9,
  delivery_failed: 8,
  model_timeout: 7, model_error: 7, budget_exhausted: 7,
  approval_denied: 6, approval_timeout: 6, approval_unavailable: 6,
  tool_failed_reported: 5,
  refused: 4, permission_denied: 4, rate_limited: 4, invalid_input: 4, filtered_by_policy: 4,
  interaction_timeout: 4, interaction_cancelled: 4,
  replied: 3, command_replied: 3, handler_replied: 3, interaction_answered: 3, suggested: 3,
  not_addressed: 2, feature_disabled: 2, ambient_silent: 2, model_silent: 2, merged: 2, superseded: 2, cleared: 2,
  interaction_consumed: 2, media_rejected: 2, ignored_self: 2, ignored_bot: 2, dropped_duplicate: 2,
  dropped_unready: 2, dropped_dedup_error: 2, dropped_retired: 2,
  unrecorded: 0,
});

/** Priority rank (higher wins). `internal_error` > `delivery_failed` > model > approval > tool > refusals > replies > silent > `unrecorded`. @public */
export function messageOutcomePriority(outcome: MessageOutcome): number {
  return TIER[outcome] ?? 0;
}

/** Outcomes with no chat reply that are sampled per conversation (ADR 0061 §2). @public */
export const QUIET_MESSAGE_OUTCOMES: ReadonlySet<MessageOutcome> = new Set<MessageOutcome>([
  'not_addressed', 'ignored_bot', 'ignored_self', 'dropped_duplicate',
]);

const REPLY: Readonly<Record<number, MessageOutcomeReply>> = Object.freeze({ 9: 'throttled', 8: 'throttled' });
const NO_REPLY: ReadonlySet<MessageOutcome> = new Set<MessageOutcome>([
  'not_addressed', 'feature_disabled', 'ambient_silent', 'model_silent', 'merged', 'superseded', 'interaction_consumed',
  'filtered_by_policy', 'media_rejected', 'ignored_self', 'ignored_bot', 'dropped_duplicate', 'dropped_unready',
  'dropped_dedup_error', 'dropped_retired',
]);
const REPLAY_ONLY: ReadonlySet<MessageOutcome> = new Set<MessageOutcome>([
  'ignored_self', 'ignored_bot', 'dropped_duplicate', 'dropped_unready', 'dropped_dedup_error', 'dropped_retired',
]);
const ADMIN_ONLY: ReadonlySet<MessageOutcome> = new Set<MessageOutcome>(['feature_disabled', 'unrecorded']);

/** Default visibility of a code (ADR 0061 §1 tables); callers may narrow it per reason. @public */
export function defaultOutcomeVisibility(outcome: MessageOutcome, addressed = false): MessageOutcomeVisibility {
  if (REPLAY_ONLY.has(outcome)) {
    // §1.5: a sender who addressed the bot during a restart / outage is told to send again.
    return addressed && (outcome === 'dropped_unready' || outcome === 'dropped_dedup_error' || outcome === 'dropped_retired')
      ? 'sender' : 'replay';
  }
  return ADMIN_ONLY.has(outcome) ? 'admin' : 'sender';
}

/** Default `reply` of a code (ADR 0061 §1 tables). @public */
export function defaultOutcomeReply(outcome: MessageOutcome): MessageOutcomeReply {
  if (outcome === 'unrecorded') return 'no';
  return REPLY[TIER[outcome]] ?? (NO_REPLY.has(outcome) ? 'no' : 'yes');
}

type Bilingual = Readonly<Record<Locale, string>>;

/** Human-readable templates per code (ADR 0061 §1): `sender` for the person who sent it, `admin` for administrators. @public */
export interface MessageOutcomeTemplate {
  readonly sender: Bilingual;
  readonly admin: Bilingual;
}

const tpl = (senderZh: string, senderEn: string, adminZh: string, adminEn: string): MessageOutcomeTemplate =>
  Object.freeze({ sender: Object.freeze({ 'zh-CN': senderZh, en: senderEn }), admin: Object.freeze({ 'zh-CN': adminZh, en: adminEn }) });

/** Placeholders a template may use; each maps to a record field. @public */
export const MESSAGE_OUTCOME_PLACEHOLDERS = Object.freeze(['command', 'owner', 'reason', 'stage', 'turnId', 'errorId', 'mergedInto', 'detail'] as const);

/** @public */
export const MESSAGE_OUTCOME_TEMPLATES: Readonly<Record<MessageOutcome, MessageOutcomeTemplate>> = Object.freeze({
  replied: tpl('已回复。', 'Replied.', '由 Agent 回复，回合 {turnId}。', 'Replied by the agent, turn {turnId}.'),
  command_replied: tpl('已执行指令 {command}。', 'Ran command {command}.', '指令 {command}（插件 {owner}）。', 'Command {command} (plugin {owner}).'),
  handler_replied: tpl('已由插件处理。', 'Handled by a plugin.', '由插件 {owner} 的 {stage} 回复。', 'Replied by {owner} ({stage}).'),
  interaction_answered: tpl('已作为对等待中提问的回答。', 'Taken as your answer to a pending question.', '提问方 {owner}。', 'Prompt by {owner}.'),
  suggested: tpl('没有这条指令，已提示相近的指令。', 'No such command; suggested a close one.', '近似匹配提示，来自 {owner}。', 'Near-match suggestion from {owner}.'),
  refused: tpl('插件拒绝了这次请求。', 'The plugin declined.', 'UserFacingError 来自 {owner}（{stage}）。', 'UserFacingError from {owner} ({stage}).'),
  invalid_input: tpl('指令参数不对，已回复用法。', 'Wrong arguments; usage was sent.', '指令 {command} 参数校验失败。', 'Command {command} failed validation.'),
  permission_denied: tpl('你没有权限执行这条指令。', 'You are not allowed to run this command.', '指令 {command} 缺少权限（{reason}）。', 'Command {command} denied ({reason}).'),
  rate_limited: tpl('太频繁或正忙，这次没有处理，请稍后再试。', 'Too frequent or busy; not processed this time.', '限流：{reason}。', 'Limited: {reason}.'),
  approval_denied: tpl('需要确认的操作被拒绝了，没有执行。', 'The action needing approval was declined and did not run.', '审批被拒绝：{detail}。', 'Approval declined: {detail}.'),
  approval_timeout: tpl('等确认超时了，操作没有执行。', 'Approval timed out; the action did not run.', '审批超时：{detail}。', 'Approval timed out: {detail}.'),
  approval_unavailable: tpl('这个操作需要有人确认，但现在没有可确认的渠道，没有执行。', 'This action needs approval but no one can approve it here; it did not run.', '无审批通道（{reason}）。', 'No approval channel ({reason}).'),
  tool_failed_reported: tpl('有一步操作失败了，回复里已说明。', 'A step failed; the reply says so.', '工具失败：{detail}。', 'Tool failed: {detail}.'),
  model_timeout: tpl('模型服务没有响应，这次没回上，请稍后再试。', 'The model did not respond; please try again later.', '模型超时（{reason}）。', 'Model timed out ({reason}).'),
  model_error: tpl('模型服务出错了，这次没回上，请稍后再试。', 'The model service failed; please try again later.', '模型失败（{reason}）。', 'Model failed ({reason}).'),
  budget_exhausted: tpl('这件事步骤太多，做到一半停下了。', 'Too many steps; stopped partway.', '超出预算 {reason}。', 'Budget {reason} exceeded.'),
  interaction_timeout: tpl('等你回答超时了，这次没有继续。', 'The question timed out; nothing more was done.', '提问超时，提问方 {owner}（{stage}）。', 'Prompt timed out, asked by {owner} ({stage}).'),
  interaction_cancelled: tpl('你退出了这次提问，没有继续。', 'You left the question; nothing more was done.', '提问结束（{reason}），提问方 {owner}（{stage}）。', 'Prompt ended ({reason}), asked by {owner} ({stage}).'),
  not_addressed: tpl('这条消息没有 @ 我，也不是指令，本群我只在被 @ 时回复。', 'You did not mention me and it is not a command; here I only answer when mentioned.', '未点名、未匹配指令，本群不插话（{reason}）。', 'Not addressed, no command, no interjection here ({reason}).'),
  feature_disabled: tpl('这里没有开启相关功能。', 'That feature is not enabled here.', '功能在此处关闭（{reason}）。', 'Feature disabled here ({reason}).'),
  ambient_silent: tpl('我判断这句不需要我插话。', 'I decided not to chime in.', '旁听判定不插话（{reason}）。', 'Ambient judge declined ({reason}).'),
  model_silent: tpl('我看了，但这次决定不回复。', 'I read it but chose not to reply.', '回合 {turnId} 完成但没有输出。', 'Turn {turnId} completed with no output.'),
  merged: tpl('和你前后几句合在一起回复了。', 'Answered together with your other messages.', '合入回合 {mergedInto}。', 'Merged into turn {mergedInto}.'),
  superseded: tpl('你很快又发了新消息，按新消息处理了。', 'You sent a newer message; that one was handled instead.', '被新消息顶替（{reason}）。', 'Superseded ({reason}).'),
  cleared: tpl('已清空上下文。', 'Context cleared.', '已清空上下文。', 'Context cleared.'),
  interaction_consumed: tpl('刚才在等一个提问的回答，这句被当成了回答。', 'I was waiting for an answer to a question and took this as it.', '被等待中的提问吃掉，提问方 {owner}（{reason}）。', 'Captured by a pending prompt of {owner} ({reason}).'),
  filtered_by_policy: tpl('机器人在这里暂停回复或无法发言。', 'The bot is paused or cannot speak here.', '被策略过滤（{reason}）。', 'Filtered by policy ({reason}).'),
  media_rejected: tpl('你发的媒体我读不了，只看了文字部分。', 'I could not read your media; only the text was used.', '媒体被拒（{reason}）。', 'Media rejected ({reason}).'),
  ignored_self: tpl('机器人自己发出的消息回显。', 'Echo of the bot\'s own message.', '机器人自己发出的消息回显。', 'Echo of the bot\'s own message.'),
  ignored_bot: tpl('来自其他机器人，只记录。', 'From another bot; recorded only.', '来自其他机器人（{reason}），只记录。', 'From another bot ({reason}); recorded only.'),
  dropped_duplicate: tpl('同一条消息已由另一个端点处理。', 'Already handled by another endpoint.', '同一条消息已由另一个端点处理。', 'Already handled by another endpoint.'),
  dropped_unready: tpl('机器人刚才在重启或暂时不可用，请再发一次。', 'The bot was restarting or unavailable; please send it again.', '场地成员尚未上报自身 ID，消息未处理：{detail}。', 'Venue members not ready: {detail}.'),
  dropped_dedup_error: tpl('机器人刚才暂时不可用，请再发一次。', 'The bot was briefly unavailable; please send it again.', '去重存储出错，按失败关闭丢弃：{detail}。', 'Dedup store failed closed: {detail}.'),
  dropped_retired: tpl('机器人刚才在重启，请再发一次。', 'The bot was restarting; please send it again.', '实例正在重载 / 关闭，消息未被接纳。', 'Instance reloading or stopping.'),
  delivery_failed: tpl('回复已经生成，但发到平台时失败了。', 'The reply was ready but the platform rejected it.', '发送失败（{reason}）。', 'Delivery failed ({reason}).'),
  internal_error: tpl('处理时出错了，已记录（错误号 {errorId}）。', 'Something went wrong; logged as {errorId}.', '{stage} 抛出异常（{reason}），插件 {owner}：{detail}', '{stage} threw ({reason}), plugin {owner}: {detail}'),
  unrecorded: tpl('这条消息的处理结果没有记录下来。', 'No outcome was recorded.', '没有结局记录，最后阶段 {stage}；这是框架缺陷，请报告。', 'No outcome recorded, last stage {stage}; a framework bug.'),
});

/**
 * Reasons whose wording the outcome's template would misstate (#1250): a prompt replaced by a newer
 * prompt in the same conversation was not left by the sender.
 */
const REASON_TEMPLATES: Readonly<Partial<Record<MessageOutcome, Readonly<Record<string, MessageOutcomeTemplate>>>>> = Object.freeze({
  interaction_cancelled: Object.freeze({
    superseded: tpl('这个提问被之后的新提问替代了，没有继续。', 'A newer question replaced this one; nothing more was done.',
      '提问被同一会话中更新的提问替代，提问方 {owner}（{stage}）。', 'Prompt replaced by a newer prompt in the conversation, asked by {owner} ({stage}).'),
  }),
});

/**
 * Renders the human-readable reason of a record for one audience. Missing placeholders read as
 * `—`; `detail` and `errorId` are only filled for the `admin` audience with `includeDetail`.
 * @public
 */
export function formatMessageOutcome(
  record: Pick<MessageOutcomeRecord, 'outcome'> & Partial<MessageOutcomeRecord>,
  options: Readonly<{ audience: 'sender' | 'admin'; locale?: Locale; includeDetail?: boolean }>,
): string {
  const template = (record.reason ? REASON_TEMPLATES[record.outcome]?.[record.reason] : undefined)
    ?? MESSAGE_OUTCOME_TEMPLATES[record.outcome] ?? MESSAGE_OUTCOME_TEMPLATES.unrecorded;
  const locale: Locale = options.locale === 'en' ? 'en' : 'zh-CN';
  const text = template[options.audience][locale];
  return text.replace(/\{(\w+)\}/gu, (_match, name: string) => {
    if ((name === 'detail' || name === 'errorId') && options.audience === 'admin' && !options.includeDetail) return '—';
    const value = name === 'stage' ? record.lastStage ?? record.stage : (record as Record<string, unknown>)[name];
    return typeof value === 'string' && value ? value : '—';
  });
}
