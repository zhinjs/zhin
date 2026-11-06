import { readOperationSession } from '@zhin.js/core';
import type { InferenceOperationScope } from '@zhin.js/ai/provider';
import type { ImRuntime, Message } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { SnapshotLease } from '@zhin.js/plugin-runtime';
import { createInvocationCompletion, invocationModel } from '../../model-runtime/index.js';
import {
  resolveAgentDecisionRuntime,
  type DecisionObservation,
} from '../index.js';
import {
  AmbientEngagement,
  createAmbientDecisionJudge,
  LlmEngagementJudge,
  type AmbientDecision,
  type EngagementJudge,
} from './ambient-engagement.js';
import type { ColdFieldMonitor } from './cold-field.js';
import {
  NO_DECISION_AUDIT,
  type DecisionAudit,
} from './decision-audit.js';
import type {
  AgentAssistantStatusPort,
  AgentIngressFoundationPort,
} from './ports.js';
import { hasIgnoredTriggerPrefix } from './unified-mailbox-spine.js';

const logger = getLogger('agent');

/** Read-only consumer: the ambient judge never moves the Agent session's context cursor. */
export const AMBIENT_CONTEXT_CONSUMER = 'zhin.ambient-engagement';
export const AMBIENT_CONTEXT_MESSAGES = 20;

export function logAmbientDecisionObservation(observation: DecisionObservation): void {
  logger.debug(formatCompact({
    op: 'agent_decision_evaluation',
    task: observation.task,
    mode: observation.mode,
    outcome: observation.outcome,
    durationMs: observation.durationMs,
    model: observation.model,
    reason: observation.reason,
    inputTokens: observation.usage?.inputTokens,
    outputTokens: observation.usage?.outputTokens,
  }));
}

/** Every judgment uses one graph and its exact retained generation. */
export function createAmbientEngagementJudge(input: Readonly<{
  lease: SnapshotLease;
  key: string;
  assistantStatus?: AgentAssistantStatusPort;
  withInference: <T>(
    input: Readonly<{ lease: SnapshotLease; sessionKey: string; operationId?: string; signal: AbortSignal }>,
    run: (scope: InferenceOperationScope) => Promise<T>,
  ) => Promise<T>;
}>): EngagementJudge {
  const { lease, key, assistantStatus, withInference } = input;
  return {
    judge: judgeInput => withInference(
      { lease, sessionKey: key, signal: AbortSignal.any([judgeInput.signal, lease.stopSignal]) },
      async scope => {
        const runtime = resolveAgentDecisionRuntime({ graph: scope.graph, inference: scope.client, resolve: scope.resolve });
        const policy = runtime?.config.ambient;
        const provider = runtime?.forTask('ambient');
        const base = policy?.mode === 'active' ? undefined : await (async () => {
          const selected = await scope.resolve({ kind: 'language', purpose: 'ambient' });
          return new LlmEngagementJudge(
            createInvocationCompletion({ binding: selected, client: scope.client, purpose: 'ambient' }),
            invocationModel(selected),
          );
        })();
        if (!provider || !policy || policy.mode === 'off') {
          if (!base) throw new Error('No engagement judgment is available');
          return base.judge(judgeInput);
        }
        const judge = createAmbientDecisionJudge({
          ...(base ? { base } : {}),
          provider,
          policy,
          observe: observation => {
            logAmbientDecisionObservation(observation);
            assistantStatus?.recordDecision(observation);
          },
          reportShadow: (decision, primary) => {
            assistantStatus?.recordAmbientShadow(decision?.engage, primary?.engage);
            logger.info(formatCompact({
              op: 'ambient_decision_shadow',
              conv: key,
              decision: decision ? (decision.engage ? 'engage' : 'declined') : 'failed',
              confidence: decision?.confidence,
              judge: primary ? (primary.engage ? 'engage' : 'declined') : 'failed',
              judgeConfidence: primary?.confidence,
            }));
          },
        });
        if (!judge) throw new Error('No engagement judgment is available');
        return judge.judge(judgeInput);
      },
    ),
  };
}

/** For a group message nobody addressed: wait for the burst, throttle, then let the judge decide. */
export async function considerAmbientEngagement(input: Readonly<{
  im: ImRuntime;
  agent: AgentIngressFoundationPort;
  ambientEngagement: AmbientEngagement | null;
  coldField: ColdFieldMonitor;
  assistantStatus?: AgentAssistantStatusPort;
  withInference: <T>(
    input: Readonly<{ lease: SnapshotLease; sessionKey: string; operationId?: string; signal: AbortSignal }>,
    run: (scope: InferenceOperationScope) => Promise<T>,
  ) => Promise<T>;
  lease: SnapshotLease;
  message: Message;
  conversationSequence: number | undefined;
  platform: string;
  botName: string;
  audit?: DecisionAudit;
}>): Promise<{ content: string } | null> {
  const {
    im,
    agent,
    ambientEngagement,
    coldField,
    assistantStatus,
    withInference,
    lease,
    message,
    conversationSequence,
    platform,
    audit = NO_DECISION_AUDIT,
  } = input;
  let { botName } = input;
  if (message.conversation.kind !== 'group' || conversationSequence === undefined) return null;
  const text = message.content.trim();
  const trigger = agent.service.getTriggerConfig();
  if (!text || trigger?.enabled === false || hasIgnoredTriggerPrefix(text, trigger)) return null;
  if (!ambientEngagement?.enabledFor(platform, message.conversation.id)) return null;
  const source = readOperationSession(message);
  if (source) {
    const operation = im.endpoints.captureOperation({
      target: message.conversation,
      client: source.endpoint,
      signal: source.signal,
    });
    try { botName = operation.profile?.peek().values.nickname?.trim() || botName; }
    finally { operation.release(); }
  }
  const key = `${platform}:${message.conversation.id}`;
  const judge = createAmbientEngagementJudge({
    lease,
    key,
    assistantStatus,
    withInference,
  });
  const decision = await ambientEngagement.consider({
    key,
    botName,
    ...(judge ? { judge } : {}),
    readRecent: async () => (await im.readConversationContext(
      message.conversation,
      AMBIENT_CONTEXT_CONSUMER,
      conversationSequence,
      AMBIENT_CONTEXT_MESSAGES,
    )).blocks.map(block => block.text),
  });
  assistantStatus?.recordAmbient(key, decision);
  auditAmbientDecision(audit, decision);
  // 冷场（ADR 0037 §1.3）：旁听参与清零；判定为不参与（declined / shadow / skipped）计 1。
  if (decision.kind === 'engage') coldField.reset(key);
  else coldField.noteNotEngaged({ platform, conversationId: message.conversation.id });
  if (decision.kind !== 'skipped' || decision.reason !== 'superseded') {
    logger.info(formatCompact({
      op: 'ambient_engagement',
      conv: key,
      decision: decision.kind,
      ...(decision.kind === 'skipped' ? { reason: decision.reason } : {
        confidence: decision.judgment.confidence,
        reason: decision.judgment.reason,
        ...(decision.judgment.source ? { judge: decision.judgment.source } : {}),
      }),
    }));
  }
  return decision.kind === 'engage' ? { content: text } : null;
}

/**
 * 旁听判定 → `ambient_decision`；没插话时再写一行 `model_skip`。被同场景更新消息顶替（superseded）的
 * 判定与现有日志一致，不记。
 */
export function auditAmbientDecision(audit: DecisionAudit, decision: AmbientDecision): void {
  if (decision.kind === 'skipped' && decision.reason === 'superseded') return;
  if (decision.kind === 'engage') {
    audit({
      kind: 'ambient_decision',
      outcome: 'allow',
      reasonCode: 'ambient_engaged',
      payload: { confidence: decision.judgment.confidence, ...(decision.judgment.source ? { judge: decision.judgment.source } : {}) },
    });
    return;
  }
  // 判定理由可能转述群聊内容，不进审计；只记判定种类与置信度。
  const detail = decision.kind === 'skipped' ? decision.reason : decision.kind;
  const payload = decision.kind === 'skipped'
    ? { decision: decision.kind, reason: decision.reason }
    : { decision: decision.kind, confidence: decision.judgment.confidence, ...(decision.judgment.source ? { judge: decision.judgment.source } : {}) };
  audit({ kind: 'ambient_decision', outcome: 'skip', reasonCode: 'ambient_not_engaged', reasonDetail: detail, payload });
  audit({ kind: 'model_skip', outcome: 'skip', reasonCode: 'ambient_not_engaged', reasonDetail: detail, payload: { source: 'ambient' } });
}
