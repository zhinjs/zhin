/**
 * 决策审计写路径（ADR 0036 切片 B）：把入站唤醒、发言门禁、旁听、模型调用、出站写进 `ai_decision_events`。
 *
 * 审计不是门禁：这里的函数都同步返回，写入在后台进行，任何失败只记日志，绝不影响回合。
 * 现有日志 `op` 全部保留，审计是额外的一行结构化记录。
 */
import {
  sceneKeyOf,
  speakBlockReasonCode,
  type DecisionActor,
  type DecisionEventKind,
  type DecisionEventLog,
  type DecisionOutcome,
  type DecisionPayload,
  type DecisionReasonCode,
  type DeliveryOutcome,
  type SessionScope,
  type SpeakBlockReason,
  type TurnOutcome,
} from '@zhin.js/agent';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('agent');

/** 同一回合内所有审计行共享的定位信息。 */
export interface DecisionScope {
  readonly turnId: string;
  /** Bot 实例：IM 入站用 endpoint（Bot 账号），缺省回落平台名。 */
  readonly instanceId: string;
  readonly platform: string;
  /** 与会话画像同口径：`<scope>:<sceneId>`。 */
  readonly sceneId: string;
  readonly userId?: string | null;
}

export interface DecisionAuditEvent {
  readonly kind: DecisionEventKind;
  readonly outcome: DecisionOutcome;
  readonly reasonCode: DecisionReasonCode;
  readonly reasonDetail?: string | null;
  readonly payload?: DecisionPayload;
  readonly actor?: DecisionActor;
}

/** 审计一行：一个回合内反复调用；writer 缺省时什么都不做。 */
export type DecisionAudit = (event: DecisionAuditEvent) => void;

export const NO_DECISION_AUDIT: DecisionAudit = () => {};

export function decisionScopeOf(input: Readonly<{
  turnId: string;
  platform: string;
  scope: SessionScope;
  sceneId: string;
  endpoint?: string;
  userId?: string | null;
}>): DecisionScope {
  return {
    turnId: input.turnId,
    instanceId: input.endpoint || input.platform,
    platform: input.platform,
    sceneId: sceneKeyOf(input.scope, input.sceneId),
    userId: input.userId ?? null,
  };
}

/** 绑定 writer 与回合定位，得到一个永不抛错、不阻塞的审计函数。 */
export function createDecisionAudit(writer: DecisionEventLog | undefined, scope: DecisionScope): DecisionAudit {
  if (!writer || !scope.platform || !scope.sceneId) return NO_DECISION_AUDIT;
  return (event) => {
    try {
      void writer.record({ ...scope, actor: 'system', ...event }).catch(() => undefined);
    } catch (error) {
      logger.warn(formatCompact({ op: 'decision_event_record_failed', kind: event.kind, error: error instanceof Error ? error.message : String(error) }));
    }
  };
}

/**
 * #995 / #997：会话画像判定 Bot 不能发言 → `speak_gate`（deny）+ `model_skip`（skip），码同源于
 * {@link speakBlockReasonCode}；`restricted:` 后缀进 `reason_detail`。
 */
export function auditCannotSpeak(audit: DecisionAudit, reason: SpeakBlockReason, payload: DecisionPayload = {}): void {
  const { code, detail } = speakBlockReasonCode(reason);
  audit({ kind: 'speak_gate', outcome: 'deny', reasonCode: code, reasonDetail: detail, payload: { ...payload, blocked: reason }, actor: 'policy' });
  audit({ kind: 'model_skip', outcome: 'skip', reasonCode: code, reasonDetail: detail, payload });
}

/** 模型回合结束的一行摘要（不记提示词、不记输出正文）。 */
export function auditModelRun(audit: DecisionAudit, outcome: TurnOutcome, payload: DecisionPayload = {}): void {
  const usage = outcome.usage as Partial<Record<'prompt_tokens' | 'completion_tokens', unknown>> | undefined;
  const summary = {
    ...payload,
    status: outcome.status,
    ...(typeof usage?.prompt_tokens === 'number' ? { inputTokens: usage.prompt_tokens } : {}),
    ...(typeof usage?.completion_tokens === 'number' ? { outputTokens: usage.completion_tokens } : {}),
  };
  if (outcome.status === 'completed') {
    audit({ kind: 'model_run', outcome: 'allow', reasonCode: 'model_completed', payload: summary, actor: 'model' });
  } else if (outcome.status === 'cancelled') {
    audit({ kind: 'model_run', outcome: 'skip', reasonCode: 'model_cancelled', reasonDetail: outcome.reason, payload: summary, actor: 'model' });
  } else {
    const detail = outcome.status === 'failed' ? outcome.error.code : `budget_exceeded:${outcome.budget}`;
    audit({ kind: 'model_run', outcome: 'error', reasonCode: 'model_failed', reasonDetail: detail, payload: summary, actor: 'model' });
  }
}

/** 模型回合抛错（超时、运行时异常）。 */
export function auditModelError(audit: DecisionAudit, error: unknown, payload: DecisionPayload = {}): void {
  const detail = error instanceof Error ? error.message : String(error);
  audit({ kind: 'model_run', outcome: 'error', reasonCode: 'model_failed', reasonDetail: detail, payload, actor: 'model' });
}

/** 实际出站（含失败与被抑制）。 */
export function auditOutbound(audit: DecisionAudit, delivered: DeliveryOutcome, payload: DecisionPayload = {}): void {
  if (delivered.status === 'sent') {
    audit({ kind: 'outbound', outcome: 'allow', reasonCode: 'outbound_sent', payload: { ...payload, ...(delivered.messageId ? { messageId: delivered.messageId } : {}) } });
  } else if (delivered.status === 'suppressed') {
    audit({ kind: 'outbound', outcome: 'skip', reasonCode: 'outbound_suppressed', payload });
  } else {
    audit({ kind: 'outbound', outcome: 'error', reasonCode: 'outbound_failed', reasonDetail: `${delivered.status}:${delivered.code}`, payload });
  }
}
