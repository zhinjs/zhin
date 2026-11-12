import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { InferenceOperationScope } from '@zhin.js/ai/provider';
import { readOperationSession, type AITriggerConfig, type VenueProjector, type VenueRegistry } from '@zhin.js/core';
import type {
  GroupRuleDefaultOutcome,
  GroupRuleViolationOutcome,
  GroupRuleViolationReport,
  GroupRuleViolationTrigger,
  ImRuntime,
  IngressRoute,
  Message,
  RuntimeSceneEventSignal,
  SendContent,
} from '@zhin.js/core/runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { createMessages, type Locale, type PluginId, type SnapshotLease } from '@zhin.js/plugin-runtime';
import { HostMailbox } from '../../collaboration/host-mailbox.js';
import { chatFailureLine, splitOutputMessages, type AgentOutputElement, type DeliveryOutcome } from '../../index.js';
import type { ApprovalPort } from '../../session/approval-port.js';
import { isCancelIntent, normalizeMailboxConfig, type TurnAdmission } from '../../turn/index.js';
import type { AgentRuntime } from '../agent-runtime.js';
import type { CapabilityIngress } from '../capability-ingress.js';
import type { AgentCapabilities } from '../index.js';
import type { TurnIntentResolver } from '../turn-intent-resolver.js';
import { AmbientEngagement } from './ambient-engagement.js';
import { AnnouncementDispatcher } from './announcement-dispatch.js';
import { ColdFieldMonitor } from './cold-field.js';
import { isClearCommand } from './content.js';
import { createDecisionAudit, decisionScopeOf, NO_DECISION_AUDIT } from './decision-audit.js';
import { GroupFloodDetector } from './group-flood-detector.js';
import { GroupRuleDefaults, GroupRuleEnforcer, GroupRuleImChannel } from './group-rule-enforcer.js';
import { auditAmbientDecision } from './ingress-ambient-stage.js';
import { auditStaleReply, reactionOf } from './ingress-delivery-helpers.js';
import { tryHandleIngressCommands } from './ingress-management-stage.js';
import {
  createAnnouncementDispatcher,
  createGroupRuleChannel,
  createGroupRuleEnforcer,
  createMemberLifecycle,
  createSceneEventIngress,
  createSessionEventDispatcher,
  executeGroupRule,
  observeFloodMessage,
} from './ingress-moderation-stage.js';
import {
  admitIngressMailTurn,
  createIngressReplyPort,
  finalizeIngressTurnSuccess,
  handleIngressTurnFailure,
  type CreateIngressReplyPortInput,
  type IngressOutboundHooks,
} from './ingress-outbound.js';
import {
  mergedMemberAccess,
  mergedTurnSenders,
  selectDecisionAgentRoute,
} from './ingress-turn-execution-stage.js';
import {
  executeAdmittedMailTurn,
  type ExecuteAdmittedMailTurnInput,
  type IngressTurnExecutionHooks,
} from './ingress-turn-runner.js';
import {
  buildAdmittedVenueDescriptor,
  collectIngressSceneEventLines,
  evaluateIngressGatesAndTrigger,
  resolveIngressVenueContext,
  resolvePreRoutedEntryActorName,
  tryStopActiveMailTurn,
  type IngressGateEvaluation,
  type IngressVenueRoutingContext,
} from './ingress-venue-helpers.js';
import { MemberLifecycle } from './member-lifecycle.js';
import {
  observeAgentTurnTrace,
  type AgentAssistantStatusPort,
  type AgentIngressFoundationPort,
  type ImApprovalChannelPort,
} from './ports.js';
import { ReactionPacer } from './reaction-pacer.js';
import {
  adapterLiveEndpointId,
  approvalMessages,
  capabilityLocalName,
  createRuntimeTurnAccess,
  isPlainTextRuntimeMessage,
  resolveMasterShellApprovalMode,
  resolveOwnerForRuntimeMessage,
  resolveRuntimeSenderRoles,
  resolveSandboxTurnPolicy,
  resolveSnapshotTurnIntentResolver,
  resolveTrustedForRuntimeMessage,
  runtimeSceneTaskSessionKey,
  type ResolvedSandboxTurnPolicy,
  type SandboxTurnPolicyInput,
} from './request.js';
import { SceneEventIngress } from './scene-event-ingress.js';
import { SceneFactRefresher } from './scene-fact-refresher.js';
import { SessionEventDispatcher } from './session-event-dispatch.js';

const logger = getLogger('agent');

export const ingressMessages = createMessages({
  cleared: { 'zh-CN': '已清空本会话的 AI 多轮上下文。', en: 'Cleared the AI conversation context for this session.' },
  stopped: { 'zh-CN': '好的，已停止当前回复。', en: 'OK, stopped the current reply.' },
  queue_full: { 'zh-CN': '前面还有几条消息在处理，请稍后再发。', en: 'Other messages are still being processed. Please try again shortly.' },
  expired: { 'zh-CN': '这条消息排队太久，已跳过，需要的话请重新发送。', en: 'This message waited too long and was skipped. Please send it again if needed.' },
});
const t = ingressMessages;

const DEFAULT_TRIGGER_TIMEOUT_MS = 60_000;
const DEFAULT_TRIGGER_ERROR_TEMPLATE = '❌ AI 处理失败: {error}';
const DEFAULT_AI_TRIGGER_PREFIXES = ['#', 'AI:', 'ai:'];
const DEFAULT_AI_TRIGGER_IGNORE_PREFIXES = ['/', '!', '！'];

export function resolveTriggerTimeoutMs(trigger?: AITriggerConfig): number {
  const raw = trigger?.timeout;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_TRIGGER_TIMEOUT_MS;
}

export function renderTriggerError(trigger: AITriggerConfig | undefined, detail: string): string {
  const template = trigger?.errorTemplate?.trim()
    ? trigger.errorTemplate
    : DEFAULT_TRIGGER_ERROR_TEMPLATE;
  return template.replace('{error}', detail);
}

/**
 * Chat reply for a failed turn: the configured `errorTemplate` when there is one, otherwise a line a
 * member would say, with the cause appended only for the owner.
 */
export function renderChatTurnError(trigger: AITriggerConfig | undefined, error: unknown, master: boolean, locale?: Locale): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (trigger?.errorTemplate?.trim()) return renderTriggerError(trigger, detail);
  return chatFailureLine(error instanceof TriggerTimeoutError ? 'turn_timeout' : 'turn_error', { master, detail, locale });
}

export class TriggerTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`AI 处理超时（${timeoutMs}ms）`);
    this.name = 'TriggerTimeoutError';
  }
}

/** Runs one ingress-owned turn with cancellation propagated through the entire turn. */
export function withTriggerTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TriggerTimeoutError(timeoutMs)), timeoutMs);
  return run(controller.signal).finally(() => clearTimeout(timer));
}

export function routeSpecialistAgent(
  userText: string,
  capabilities: Pick<AgentCapabilities, 'agents'>,
  preferredAgentDefinitionId?: string,
  defaultAgentDefinitionId?: string,
  platform?: string,
): { readonly userText: string; readonly agent?: AgentCapabilities['agents'][number] } {
  if (preferredAgentDefinitionId) {
    if (preferredAgentDefinitionId === defaultAgentDefinitionId) return { userText };
    const preferred = capabilities.agents.find((item) =>
      item.name === preferredAgentDefinitionId
      || item.qualifiedName === preferredAgentDefinitionId);
    if (!preferred) {
      throw new Error(`Preferred specialist Agent is unavailable: ${preferredAgentDefinitionId}`);
    }
    return { userText, agent: preferred };
  }
  const match = userText.match(/^@([^\s:：]+)[:：]?\s*/u);
  if (match) {
    const name = match[1]!.toLowerCase();
    const agent = capabilities.agents.find((item) => item.name.toLowerCase() === name);
    if (agent) return { userText: userText.slice(match[0].length).trim() || userText, agent };
  }
  if (!platform) return { userText };
  const platformAgents = capabilities.agents.filter(
    (agent) => agent.platforms?.includes(platform),
  );
  if (platformAgents.length > 1) {
    throw new Error(
      `Multiple specialist Agents target platform ${platform}: ${platformAgents.map((agent) => agent.qualifiedName).join(', ')}`,
    );
  }
  return platformAgents[0] ? { userText, agent: platformAgents[0] } : { userText };
}

/** Messages starting with a command prefix are never AI turns, addressed or not. */
export function hasIgnoredTriggerPrefix(text: string, trigger: AITriggerConfig | undefined): boolean {
  const ignorePrefixes = trigger?.ignorePrefixes?.length
    ? trigger.ignorePrefixes
    : DEFAULT_AI_TRIGGER_IGNORE_PREFIXES;
  return ignorePrefixes.some(prefix => prefix && text.startsWith(prefix));
}

/**
 * ADR 0038 §1: may this addressed message join a group merge window? Only
 * plain-text group / channel messages from non-master senders that are not a
 * trigger-prefix command or a stop word. Everything else keeps its own turn.
 */
export function isMergeableGroupTurn(input: Readonly<{
  message: Message;
  trigger: AITriggerConfig | undefined;
  plainText: boolean;
  isMaster: boolean;
  /** Addressed content after trigger stripping. */
  content: string;
}>): boolean {
  const kind = input.message.conversation.kind;
  if (kind !== 'group' && kind !== 'channel') return false;
  if (!input.plainText || input.isMaster) return false;
  if (isCancelIntent(input.content)) return false;
  const text = input.message.content.trim();
  const prefixes = input.trigger?.prefixes?.length ? input.trigger.prefixes : DEFAULT_AI_TRIGGER_PREFIXES;
  if (prefixes.some((prefix) => prefix && text.startsWith(prefix))) return false;
  if (input.message.commandPrefix && text.startsWith(input.message.commandPrefix)) return false;
  return !/^[/#]/u.test(input.content.trim());
}

export function matchAiTrigger(
  message: Message,
  trigger: AITriggerConfig | undefined,
): { content: string } | null {
  if (trigger?.enabled === false) return null;
  const text = message.content.trim();
  if (!text) return null;

  if (hasIgnoredTriggerPrefix(text, trigger)) return null;

  const isPrivate = message.conversation.kind === 'private';
  const prefixes = trigger?.prefixes?.length ? trigger.prefixes : DEFAULT_AI_TRIGGER_PREFIXES;
  for (const prefix of prefixes) {
    if (!prefix) continue;
    if (text.startsWith(prefix)) {
      const content = text.slice(prefix.length).trim();
      return content ? { content } : null;
    }
  }

  if (trigger?.respondToAt !== false
    && !isPrivate
    && (message.mentioned === true || message.metadata?.mentioned === true)) {
    return { content: stripMentionMarkup(text) };
  }
  if (trigger?.respondToPrivate !== false && isPrivate) return { content: text };

  const keywords = trigger?.keywords ?? [];
  if (isPrivate && keywords.length > 0) {
    const lowerText = text.toLowerCase();
    for (const keyword of keywords) {
      if (keyword && lowerText.includes(keyword.toLowerCase())) return { content: text };
    }
  }
  return null;
}

export function resolveRuntimeAgentTrigger(
  message: Message,
  trigger: AITriggerConfig | undefined,
  forceTriggered = false,
): { content: string } | null {
  if (!forceTriggered) return matchAiTrigger(message, trigger);
  if (trigger?.enabled === false) return null;
  const text = message.content.trim();
  if (!text) return null;
  return { content: stripMentionMarkup(text) || text };
}

function stripMentionMarkup(text: string): string {
  return text
    .replace(/\[CQ:(?:at|mention),[^\[\]]*\]/giu, '')
    .replace(/<@!?[^<>\s]+>/gu, '')
    .replace(/\[(?:at|mention):[^\[\]]*\]/giu, '')
    .trim();
}

/** A short, human-feeling pause before each follow-up message, longer for longer text. */
export function followUpPauseMs(text: string): number {
  return Math.min(1_500, 400 + text.length * 30);
}

/**
 * Sends the Agent output as the chat messages the model split it into, in order.
 * The first sent message is the reply's receipt; a failure after a delivered
 * message is reported as non-retryable so earlier messages are never resent.
 */
export async function sendOutputMessages(
  output: readonly AgentOutputElement[],
  port: Readonly<{
    send(message: readonly AgentOutputElement[]): Promise<DeliveryOutcome>;
    render(message: readonly AgentOutputElement[]): string;
    pause?(ms: number): Promise<void>;
  }>,
): Promise<DeliveryOutcome> {
  const pause = port.pause ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let first: DeliveryOutcome | undefined;
  const messages: NonNullable<Extract<DeliveryOutcome, { status: 'sent' }>['messages']>[number][] = [];
  const messageContexts: NonNullable<Extract<DeliveryOutcome, { status: 'sent' }>['messageContexts']>[number][] = [];
  for (const message of splitOutputMessages(output)) {
    if (first?.status === 'sent') await pause(followUpPauseMs(port.render(message)));
    let outcome: DeliveryOutcome;
    try {
      outcome = await port.send(message);
    } catch (error) {
      if (first?.status !== 'sent') throw error;
      return { status: 'failed', code: 'partial_delivery', retryable: false, deliveryPartial: true, deliveryUnknown: true, ...(messages.length ? { messages } : {}) };
    }
    if ('messages' in outcome) messages.push(...outcome.messages ?? []);
    if (outcome.status === 'suppressed') continue;
    if (outcome.status !== 'sent' && first?.status === 'sent') {
      return { status: 'failed', code: 'partial_delivery', retryable: false, deliveryPartial: true,
        ...(outcome.status === 'failed' && outcome.deliveryUnknown ? { deliveryUnknown: true as const } : {}),
        ...(messages.length ? { messages } : {}) };
    }
    if (outcome.status !== 'sent') return outcome;
    first ??= outcome;
    messageContexts.push(...outcome.messageContexts ?? []);
  }
  return first?.status === 'sent' && (messageContexts.length || messages.length)
    ? { ...first, ...(messages.length ? { messages } : {}), ...(messageContexts.length ? { messageContexts } : {}) }
    : first ?? { status: 'suppressed' };
}

export {
  admitIngressMailTurn,
  approvalMessages,
  auditAmbientDecision,
  auditStaleReply,
  buildAdmittedVenueDescriptor,
  collectIngressSceneEventLines,
  createIngressReplyPort,
  evaluateIngressGatesAndTrigger,
  executeAdmittedMailTurn,
  finalizeIngressTurnSuccess,
  handleIngressTurnFailure,
  mergedMemberAccess,
  mergedTurnSenders,
  observeAgentTurnTrace,
  reactionOf,
  resolveIngressVenueContext,
  resolveMasterShellApprovalMode,
  resolvePreRoutedEntryActorName,
  resolveSandboxTurnPolicy,
  selectDecisionAgentRoute,
  tryStopActiveMailTurn,
  type CreateIngressReplyPortInput,
  type ExecuteAdmittedMailTurnInput,
  type IngressGateEvaluation,
  type IngressOutboundHooks,
  type IngressTurnExecutionHooks,
  type IngressVenueRoutingContext,
  type ResolvedSandboxTurnPolicy,
  type SandboxTurnPolicyInput,
};

export interface AgentTurnIngressRouteOptions {
  readonly projectRoot: string;
  readonly withInferenceScope?: <T>(input: Readonly<{ lease: SnapshotLease; sessionKey: string; operationId?: string; signal: AbortSignal }>,
    operation: (scope: InferenceOperationScope) => Promise<T>) => Promise<T>;
  readonly withModelScope?: <T>(input: Readonly<{ lease: SnapshotLease; sessionKey: string; signal: AbortSignal }>,
    operation: () => Promise<T>) => Promise<T>;
  readonly runtime: AgentRuntime;
  readonly im: ImRuntime;
  readonly transcribeUrl?: (audioUrl: string) => Promise<string | null>;
  readonly approvalPort?: ApprovalPort;
  readonly resolveTurnIntent?: TurnIntentResolver;
  readonly resolveEndpointOwner?: (adapterLocalName: string, endpointKey: string) => string | undefined;
  readonly resolveEndpointTrusted?: (adapterLocalName: string, endpointKey: string) => readonly string[];
  readonly ingress: CapabilityIngress;
  readonly agent: AgentIngressFoundationPort;
  /** Optional VenueRegistry for multi-bot Venue routing (ADR 0048 H4). */
  readonly venueRegistry?: VenueRegistry;
  /** Optional VenueProjector for multi-bot Venue collaboration projection (ADR 0048 H4). */
  readonly venueProjector?: VenueProjector;
  /** Process-owned Console status for 群聊插话 / 技能助手 (#970); metadata only. */
  readonly assistantStatus?: AgentAssistantStatusPort;
  /** Hard-gate IM approval channel (G6, #1013): settles `approve <id>` / `deny <id>` for approval cards. */
  readonly toolApprovalIm?: ImApprovalChannelPort;
}

/** Generation-owned IM ingress adapter for management, approval, and Agent turns. */
export class AgentTurnIngressRoute implements IngressRoute {
  #hostMailbox: HostMailbox | undefined;
  #ownsMailbox = false;
  /** Whether this generation's mailbox has the ADR 0038 group merge window. */
  #mergeWindowEnabled = false;
  #ambient: AmbientEngagement | null | undefined;
  /** 状态感知（#996）：高优先社交事件独立唤醒；所有回合的 `[Scene events]` 摘要。 */
  readonly #sceneEvents: SceneEventIngress;
  /** ADR 0041 §6: background refresh of stale scene facts; cancelled with this generation. */
  readonly #sceneFactRefresher = new SceneFactRefresher();
  /** ADR 0037 切片 A：入群欢迎 / 退群记录（模板直发，过控制面与 session-gate）。 */
  readonly #memberLifecycle: MemberLifecycle;
  /** ADR 0037 切片 B：批准后的公告发送（过控制面、session-gate，以审批记录作硬闸批准）。 */
  readonly #announcements: AnnouncementDispatcher;
  readonly #stopAnnouncementSweep: () => void;
  /** ADR 0037 切片 C：冷场计数 → 会话临时 mention_only（控制面临时覆盖，到期撤销）。 */
  readonly #coldField: ColdFieldMonitor;
  /** ADR 0037 切片 D：会话日程到点唤醒（控制面 → session-gate → 模板直发，宽限 / 合并）。 */
  readonly #sessionEvents: SessionEventDispatcher;
  readonly #stopSessionEvents: () => void;
  /** ADR 0039 切片 B：群规预览卡与群内审批命令。 */
  readonly #groupRules: GroupRuleImChannel;
  readonly #stopGroupRules: () => void;
  /** ADR 0039 切片 C：群规执行器（命中 → 阶梯档：提醒 / 警告 / 自动禁言 / 建议踢人出卡）。 */
  readonly #groupRuleEnforcer: GroupRuleEnforcer;
  /** ADR 0039 切片 D：复读刷屏检测（进程内、有界，不落盘）。 */
  readonly #floodDetector = new GroupFloodDetector();
  /** Per-session reaction pacing (memory only, bounded); lives and dies with this route generation. */
  readonly #reactionPacer = new ReactionPacer({ config: () => this.options.agent.service.getAgentConfig()?.reactions });
  readonly #groupRuleDefaults: GroupRuleDefaults;

  constructor(private readonly options: AgentTurnIngressRouteOptions) {
    options.assistantStatus?.bindAmbientConfig(() => options.agent.service.getTriggerConfig()?.ambient);
    options.assistantStatus?.bindDecisionEvents(() => options.agent.agent.getDecisionEvents?.());
    options.assistantStatus?.bindControlPlane(
      () => options.agent.agent.getControlPlane?.(),
      () => options.agent.agent.getDecisionEvents?.(),
    );
    this.#coldField = new ColdFieldMonitor({
      sessionOps: () => options.agent.agent.getSessionOps?.(),
      controlPlane: () => options.agent.agent.getControlPlane?.(),
      decisionEvents: () => options.agent.agent.getDecisionEvents?.(),
    });
    const onSpoke = (key: string) => this.#noteSpoke(key);
    this.#memberLifecycle = createMemberLifecycle({ im: options.im, agent: options.agent, onSpoke });
    this.#announcements = createAnnouncementDispatcher({ im: options.im, agent: options.agent, onSpoke });
    this.#stopAnnouncementSweep = this.#announcements.start();
    this.#sceneEvents = createSceneEventIngress({
      projectRoot: options.projectRoot,
      im: options.im,
      runtime: options.runtime,
      agent: options.agent,
      memberLifecycle: this.#memberLifecycle,
      onSpoke,
      mailbox: () => this.#mailbox(),
    });
    this.#sessionEvents = createSessionEventDispatcher({ im: options.im, agent: options.agent, onSpoke });
    this.#stopSessionEvents = this.#sessionEvents.start();
    this.#groupRules = createGroupRuleChannel({ im: options.im, agent: options.agent });
    this.#stopGroupRules = this.#groupRules.start();
    this.#groupRuleEnforcer = createGroupRuleEnforcer({ agent: options.agent, onSpoke });
    this.#groupRuleDefaults = new GroupRuleDefaults(() => options.agent?.agent?.getGroupRules?.());
    options.assistantStatus?.bindSessionOps(
      () => options.agent.agent.getSessionOps?.(),
      () => this.#memberLifecycle,
      () => options.agent.agent.getDecisionEvents?.(),
    );
    options.assistantStatus?.bindAnnouncements(
      () => options.agent.agent.getAnnouncements?.(),
      () => this.#announcements,
    );
    options.assistantStatus?.bindSessionEvents(() => options.agent.agent.getSessionEvents?.());
    options.assistantStatus?.bindGroupRules(() => options.agent.agent.getGroupRules?.());
    options.assistantStatus?.bindUsageTraces(() => join(options.projectRoot, 'data', 'agent-traces'));
  }

  /**
   * 插件违规上报（ADR 0039 §5，经 `groupRuleViolationToken`）：content-moderation 判定后交给规则执行器。
   */
  async reportGroupRuleViolation(report: GroupRuleViolationReport): Promise<GroupRuleViolationOutcome> {
    const { conversation } = report;
    if (conversation.kind !== 'group' || !report.memberId) return 'no_rule';
    const result = await executeGroupRule({
      im: this.options.im,
      enforcer: this.#groupRuleEnforcer,
      conversation,
      source: report.source,
      violation: {
        platform: conversation.endpoint.adapter,
        endpoint: conversation.endpoint.id,
        groupId: conversation.id,
        memberId: report.memberId,
        ...(report.memberName ? { memberName: report.memberName } : {}),
        ...(report.memberStanding ? { memberStanding: report.memberStanding } : {}),
        trigger: report.trigger,
        sentAt: report.sentAt,
        ...(report.messageId ? { messageId: report.messageId } : {}),
        ...(report.evidence?.length ? { evidence: report.evidence } : {}),
        ...(report.newcomer ? { newcomer: true } : {}),
        ...(report.recall ? { recall: report.recall } : {}),
      },
    });
    if (result.kind !== 'no_rule') {
      logger.info(formatCompact({ op: 'group_rule_moderation', conv: `${conversation.endpoint.adapter}:${conversation.id}`, trigger: report.trigger, result: result.kind }));
    }
    return result.kind === 'no_rule' ? 'no_rule' : 'handled';
  }

  /** content-moderation 迁移：原 `groupModeration` 群按默认模板生成一条待确认规则（ADR 0039 §5）。 */
  ensureDefaultGroupRule(input: Readonly<{ conversation: ConversationRef; trigger: GroupRuleViolationTrigger }>): Promise<GroupRuleDefaultOutcome> {
    const { conversation } = input;
    if (conversation.kind !== 'group') return Promise.resolve('unavailable');
    return this.#groupRuleDefaults.ensure({
      platform: conversation.endpoint.adapter,
      endpoint: conversation.endpoint.id,
      groupId: conversation.id,
      trigger: input.trigger,
    });
  }

  handleSceneEvent(signal: RuntimeSceneEventSignal): void {
    try {
      this.#memberLifecycle.handle(signal);
    } catch (error) {
      logger.warn(formatCompact({ op: 'member_lifecycle_failed', error: error instanceof Error ? error.message : String(error) }));
    }
    this.#sceneEvents.handle(signal);
  }

  ownsMemberWelcome(conversation: ConversationRef): boolean {
    return this.#memberLifecycle.ownsWelcome(conversation);
  }

  #noteSpoke(key: string): void {
    this.#ambientEngagement()?.noteSpoke(key);
    this.#coldField.reset(key);
  }

  dispose(): void {
    this.options.assistantStatus?.bindUsageTraces(() => undefined);
    this.#coldField.dispose();
    this.#memberLifecycle.dispose();
    this.#stopAnnouncementSweep();
    this.#stopSessionEvents();
    this.#stopGroupRules();
    this.#groupRuleEnforcer.dispose();
    this.#floodDetector.clear();
    this.#reactionPacer.clear();
    this.#sceneEvents.dispose();
    this.#sceneFactRefresher.dispose();
    if (this.#ownsMailbox) this.#hostMailbox?.dispose();
    this.#hostMailbox = undefined;
  }

  /** Unified HostMailbox shared with the generation's ZhinAgent. */
  get hostMailbox(): HostMailbox {
    return this.#mailbox();
  }

  #mailbox(): HostMailbox {
    if (!this.#hostMailbox) {
      const config = normalizeMailboxConfig(this.options.agent.service.getAgentConfig()?.mailbox);
      this.#mergeWindowEnabled = config.merge.enabled;
      const shared = (this.options.agent.agent as { readonly hostMailbox?: HostMailbox } | undefined)?.hostMailbox;
      if (shared instanceof HostMailbox) {
        this.#hostMailbox = shared;
        this.#ownsMailbox = false;
      } else {
        this.#hostMailbox = new HostMailbox({ config });
        this.#ownsMailbox = true;
      }
    }
    return this.#hostMailbox;
  }

  #ambientEngagement(): AmbientEngagement | null {
    if (this.#ambient !== undefined) return this.#ambient;
    const config = this.options.agent.service.getTriggerConfig()?.ambient;
    if (!config?.conversations?.length) return this.#ambient = null;
    return this.#ambient = new AmbientEngagement({ config });
  }

  async #withInference<T>(input: Readonly<{ lease: SnapshotLease; sessionKey: string; operationId?: string; signal: AbortSignal }>,
    run: (scope: InferenceOperationScope) => Promise<T>): Promise<T> {
    if (!this.options.withInferenceScope) throw new Error('The Host inference operation is unavailable');
    return this.options.withInferenceScope(input, run);
  }

  async preRoute(
    _message: Message,
    _lease: SnapshotLease,
    _requester: PluginId,
    _conversationSequence: number | undefined,
  ): Promise<boolean> {
    return false;
  }

  shouldRouteBeforeDispatch(_message: Message): boolean {
    return false;
  }

  async route(
    message: Message,
    lease: SnapshotLease,
    requester: PluginId,
    conversationSequence: number | undefined,
  ): Promise<boolean> {
    const messageOrigin = (message as { readonly origin?: unknown }).origin ?? message.metadata?.origin;
    if (typeof messageOrigin === 'string' && messageOrigin !== 'human') {
      return false;
    }
    const operationSession = readOperationSession(message);
    const operationSignal = operationSession?.signal;
    const options = this.options;
    const service = options.agent.service;
    const zhinAgent = options.agent.agent;
    const binding = service.getBindingRegistry().requireZhinBinding();
    const snapshot = lease.value;
    const trigger = service.getTriggerConfig();

    const ownerId = resolveOwnerForRuntimeMessage(message, options.resolveEndpointOwner, snapshot);
    const endpointTrusted = resolveTrustedForRuntimeMessage(message, options.resolveEndpointTrusted, snapshot);
    const senderRoles = resolveRuntimeSenderRoles(message, { endpointMaster: ownerId, endpointTrusted, trigger });
    const turnAccess = createRuntimeTurnAccess(message, senderRoles, undefined, undefined, conversationSequence);
    const effectiveAdapter = capabilityLocalName(String(message.conversation.endpoint.id));
    const effectiveEndpoint = adapterLiveEndpointId(message);

    const { venueProjector, matchedVenue, venueRoute, liveRoom, initialMatched, initialSessionKey } =
      resolveIngressVenueContext({
        message, snapshot, turnAccess, effectiveEndpoint, trigger,
        projectRoot: options.projectRoot,
        venueRegistry: options.venueRegistry,
        venueProjector: options.venueProjector,
      });

    const reply = async (content: SendContent): Promise<Awaited<ReturnType<Message['$reply']>>> => {
      const receipt = await message.$reply(content);
      logger.debug(formatCompact({
        op: 'replychain_message_reply',
        status: receipt.status,
        code: receipt.failure?.code,
        messageId: receipt.message?.id,
      }));
      return receipt;
    };

    if (turnAccess.origin.kind === 'im') {
      observeFloodMessage({
        im: options.im, enforcer: this.#groupRuleEnforcer, floodDetector: this.#floodDetector,
        message, platform: turnAccess.origin.platform, endpoint: effectiveEndpoint,
      });
    }

    if (await tryHandleIngressCommands({
      message, lease, operationSignal, sessionKey: initialSessionKey, senderRoles, turnAccess,
      ownerId, effectiveEndpoint, agent: options.agent, groupRules: this.#groupRules,
      toolApprovalIm: options.toolApprovalIm,
      withInference: (inferInput, run) => this.#withInference(inferInput, run),
      withModelScope: options.withModelScope, reply,
    })) {
      return true;
    }

    const platform = turnAccess.origin.kind === 'im' ? turnAccess.origin.platform : '';
    const turnId = randomUUID();
    const audit = turnAccess.origin.kind === 'im'
      ? createDecisionAudit(zhinAgent.getDecisionEvents?.(), decisionScopeOf({
          turnId, platform, scope: turnAccess.origin.scope, sceneId: turnAccess.origin.sceneId,
          endpoint: effectiveEndpoint, userId: turnAccess.principal.subjectId,
        }))
      : NO_DECISION_AUDIT;

    const gateEvaluation = await evaluateIngressGatesAndTrigger({
      message, lease, turnAccess, effectiveEndpoint, conversationSequence, trigger,
      bindingNickname: binding.nickname, projectRoot: options.projectRoot, liveRoom,
      initialMatched, initialSessionKey, im: options.im, agent: options.agent,
      assistantStatus: options.assistantStatus, ambientEngagement: this.#ambientEngagement(),
      coldField: this.#coldField, audit,
      withInference: (inferInput, run) => this.#withInference(inferInput, run),
    });
    if (gateEvaluation.kind === 'halt') {
      return gateEvaluation.handled;
    }

    const { matched, ambient, outboundBlocked } = gateEvaluation;
    let sessionKey = gateEvaluation.sessionKey;

    const intentResolver = resolveSnapshotTurnIntentResolver(snapshot, requester) ?? options.resolveTurnIntent;
    const mailbox = this.#mailbox();
    if (venueProjector) mailbox.setVenueProjector(venueProjector);
    const gate = intentResolver || message.metadata?.turnIntent !== undefined ? undefined : mailbox;
    const plainText = isPlainTextRuntimeMessage(message);
    const mergeable = gate !== undefined && !liveRoom && isMergeableGroupTurn({
      message, trigger, plainText, isMaster: senderRoles.isMaster, content: matched.content,
    });
    const sceneMerge = mergeable && !ambient && this.#mergeWindowEnabled && !isClearCommand(matched.content);
    if (sceneMerge) sessionKey = runtimeSceneTaskSessionKey(turnAccess, options.projectRoot);
    audit({
      kind: 'inbound_wake',
      outcome: 'allow',
      reasonCode: ambient ? 'ambient_engaged' : 'inbound_addressed',
      payload: { source: 'message', scope: turnAccess.origin.kind === 'im' ? turnAccess.origin.scope : undefined },
    });

    const sceneEvents = await collectIngressSceneEventLines({
      sceneEvents: this.#sceneEvents, turnAccess, sessionKey, message, platform, effectiveEndpoint, conversationSequence,
    });

    if (isClearCommand(matched.content)) {
      await zhinAgent.archiveSession(sessionKey);
      await reply(t(message.locale, 'cleared'));
      return true;
    }

    const entryActorName = resolvePreRoutedEntryActorName({
      snapshot, matchedContent: matched.content, venueAgentName: venueRoute?.member.agent,
      bindingName: binding.name, platform: turnAccess.origin.kind === 'im' ? turnAccess.origin.platform : undefined,
    });
    const senderId = turnAccess.principal.subjectId;
    if (await tryStopActiveMailTurn({
      gate, matchedContent: matched.content, sessionKey, senderId, senderRoles, entryActorName,
      mergeWindowEnabled: this.#mergeWindowEnabled, liveRoom, ambient, turnAccess,
      projectRoot: options.projectRoot, message, reply,
    })) {
      return true;
    }

    let capabilityActive = true;
    let modelStartedAt: number | undefined;
    let spoke = false;
    const modelPayload = (): Record<string, unknown> => ({
      ambient,
      spoke,
      ...(modelStartedAt !== undefined ? { durationMs: Date.now() - modelStartedAt } : {}),
    });
    let admission: Extract<TurnAdmission, { kind: 'run' }> | undefined;
    let profileOperation: ReturnType<ImRuntime['endpoints']['captureOperation']> | undefined;
    let staleAudited = false;
    const staleReplyBlocked = (): boolean => {
      if (admission?.signal.aborted) return true;
      const verdict = admission?.staleCheck();
      if (!verdict || verdict.kind === 'fresh') return false;
      if (!staleAudited) {
        staleAudited = true;
        auditStaleReply(audit, verdict);
      }
      return verdict.kind === 'discard';
    };
    try {
      const admittedResult = await admitIngressMailTurn({
        message, matchedContent: matched.content, transcribeUrl: options.transcribeUrl,
        matchedVenue, venueRoute, mailbox, gate, sessionKey, turnId, senderId, entryActorName,
        senderRoles, plainText, liveRoom, mergeable, turnAccess, audit, reply,
      });
      if (admittedResult.kind === 'completed') {
        return true;
      }
      admission = admittedResult.admission;
      const inbound = admittedResult.inbound;

      const { outcome, capabilities, routed } = await executeAdmittedMailTurn({
        message, lease, snapshot, requester, operationSession, operationSignal, turnId, sessionKey,
        senderId, senderRoles, ownerId, effectiveAdapter, turnAccess, conversationSequence,
        sceneEvents, inbound, liveRoom, ambient, sceneMerge, gate, mailbox, admission, venueRoute,
        trigger, projectRoot: options.projectRoot, im: options.im, runtime: options.runtime,
        ingress: options.ingress, agent: options.agent, approvalPort: options.approvalPort,
        assistantStatus: options.assistantStatus, intentResolver,
        sceneFactRefresher: this.#sceneFactRefresher, reactionPacer: this.#reactionPacer,
        audit, reply,
        withInference: (inferInput, run) => this.#withInference(inferInput, run),
        hooks: {
          setProfileOperation: (op) => { profileOperation = op; },
          setModelStartedAt: (ts) => { modelStartedAt = ts; },
          markSpoke: () => { spoke = true; },
          isCapabilityActive: () => capabilityActive,
          staleReplyBlocked,
          outboundBlocked,
        },
      });
      finalizeIngressTurnSuccess({
        audit, outcome, capabilities, routedAgentName: routed.agent?.name,
        modelPayload, sttApplied: inbound.sttApplied,
      });
      return true;
    } catch (error) {
      return handleIngressTurnFailure({
        error, admission, modelStartedAt, modelPayload, audit, sessionKey, trigger,
        isMaster: senderRoles.isMaster, locale: message.locale, outboundBlocked, reply,
      });
    } finally {
      capabilityActive = false;
      profileOperation?.release();
      admission?.release();
    }
  }
}
