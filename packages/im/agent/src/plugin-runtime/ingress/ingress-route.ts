import { readOperationSession } from '@zhin.js/core';
import { ingressMessages as t } from './ingress-messages.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { EndpointDeliveryError, type ConversationRef, type TextSegment } from '@zhin.js/im-contract';
import {
  createAutoApprovalPort,
  publishOutboundElements,
  resolveOutboundCapabilities,
  type ApprovalPort,
} from '../../index.js';
import { DecisionApprovalJudgment } from '../../session/index.js';
import {
  isCancelIntent,
  liveReplyAuditPayload,
  mergedReplyAuditPayload,
  narrowMergedAccess,
  normalizeInboundQueueConfig,
  readOnlyCapabilities,
  withMergeMembers,
  TurnAdmissionGate,
  type TurnAdmission,
  type TurnLiveDanmaku,
} from '../../turn/index.js';
import {
  CapabilityIngress,
  AgentRuntime,
  type TurnIntentResolver,
  runWithAgentDecisionTurn,
} from '../index.js';
import type { InferenceOperationScope } from '@zhin.js/ai/provider';
import {
  adapterDeclaresLiveDanmaku,
  resolveAiOutboundSegments,
  type GroupRuleDefaultOutcome,
  type GroupRuleViolationOutcome,
  type GroupRuleViolationReport,
  type GroupRuleViolationTrigger,
  type ImRuntime,
  type CapturedEndpointOperation,
  type CoreReplyStream,
  type IngressRoute,
  type Message,
  type RuntimeSceneEventSignal,
  type SendContent,
} from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { sendOutputMessages } from './reply-messages.js';
import {
  rootPluginId,
  type CapabilityId,
  type PluginId,
  type SnapshotLease,
} from '@zhin.js/plugin-runtime';
import {
  completedOutput,
  flattenOutputElements,
  isClearCommand,
  preprocessInboundTurn,
} from './content.js';
import {
  hasIgnoredTriggerPrefix,
  isMergeableGroupTurn,
  renderChatTurnError,
  resolveRuntimeAgentTrigger,
  resolveTriggerTimeoutMs,
  routeSpecialistAgent,
  withTriggerTimeout,
  workroomOrchestratorSessionKey,
} from './trigger.js';
import {
  adapterLiveEndpointId,
  capabilityLocalName,
  createRuntimeApprovalPort,
  createRuntimeQuestionPort,
  createRuntimeTurnAccess,
  createRuntimeTurnRequest,
  deliveryOutcomeFromReceipt,
  interactiveNetworkPolicy,
  isPlainTextRuntimeMessage,
  resolveOwnerForRuntimeMessage,
  resolveProductTurnIntent,
  resolveRuntimeSenderRoles,
  resolveRuntimeTurnCapabilities,
  resolveRuntimeTurnContextState,
  resolveSnapshotTurnIntentResolver,
  resolveTrustedForRuntimeMessage,
  runtimeImSessionKey,
  runtimePersonalSessionAddress,
  runtimeSceneTaskSessionKey,
} from './request.js';
import { NO_WORKROOM_PORT, type AgentWorkroomPort } from './turn-continuation-port.js';
import { AMBIENT_ENGAGEMENT_METADATA_KEY } from '../../context/index.js';
import { AmbientEngagement } from './ambient-engagement.js';
import { resolveSandboxTurnPolicy } from './sandbox-policy.js';
import { observeSessionAndCheckSpeak } from './session-gate.js';
import {
  auditControlGate,
  auditControlOutbound,
  checkControlAtIngress,
  checkControlAtOutbound,
  logControlBlocked,
  type ControlGateTarget,
} from './control-gate.js';
import { SceneEventIngress } from './scene-event-ingress.js';
import { MemberLifecycle } from './member-lifecycle.js';
import { SceneFactRefresher } from './scene-fact-refresher.js';
import { AnnouncementDispatcher } from './announcement-dispatch.js';
import { GroupRuleImChannel } from './group-rule-im.js';
import { GroupRuleEnforcer } from './group-rule-enforcer.js';
import { GroupFloodDetector } from './group-flood-detector.js';
import { deliverReaction, ReactionPacer } from './reaction-pacer.js';
import { GroupRuleDefaults } from './group-rule-defaults.js';
import { ColdFieldMonitor } from './cold-field.js';
import { SessionEventDispatcher } from './session-event-dispatch.js';
import {
  auditCannotSpeak,
  auditModelError,
  auditModelRun,
  auditOutbound,
  createDecisionAudit,
  decisionScopeOf,
  NO_DECISION_AUDIT,
} from './decision-audit.js';
import {
  auditAmbientDecision,
  considerAmbientEngagement,
} from './ingress-ambient-stage.js';
import {
  admissionRejectionNotice,
  auditStaleReply,
  NO_APPROVAL_PORT,
  observeWithAdmission,
  reactionOf,
  resolveApprovalPort,
} from './ingress-delivery-helpers.js';
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
  anonymousMemberAccess,
  mergedMemberAccess,
  mergedTurnSenders,
  readTurnCapabilities,
  selectDecisionAgentRoute,
} from './ingress-turn-execution-stage.js';
import {
  observeAgentTurnTrace,
  type AgentAssistantStatusPort,
  type AgentIngressFoundationPort,
  type ImApprovalChannelPort,
} from './ports.js';

const logger = getLogger('agent');

export {
  auditAmbientDecision,
  auditStaleReply,
  mergedMemberAccess,
  mergedTurnSenders,
  observeAgentTurnTrace,
  reactionOf,
  selectDecisionAgentRoute,
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
  /** Absent when the optional Workroom package is not installed. */
  readonly workroom?: AgentWorkroomPort;
  /** Process-owned Console status for 群聊插话 / 技能助手 (#970); metadata only. */
  readonly assistantStatus?: AgentAssistantStatusPort;
  /** Hard-gate IM approval channel (G6, #1013): settles `approve <id>` / `deny <id>` for approval cards. */
  readonly toolApprovalIm?: ImApprovalChannelPort;
}

/** Generation-owned IM ingress adapter for management, approval, and Agent turns. */
export class AgentTurnIngressRoute implements IngressRoute {

  #admissionGate: TurnAdmissionGate | undefined;
  /** Whether this generation's gate has the ADR 0038 group merge window. */
  #mergeWindowEnabled = false;
  #ambient: AmbientEngagement | null | undefined;
  private readonly workroomPort: AgentWorkroomPort;
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
    this.workroomPort = options.workroom ?? NO_WORKROOM_PORT;
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
    this.#memberLifecycle = createMemberLifecycle({
      im: options.im,
      agent: options.agent,
      onSpoke,
    });
    this.#announcements = createAnnouncementDispatcher({
      im: options.im,
      agent: options.agent,
      onSpoke,
    });
    this.#stopAnnouncementSweep = this.#announcements.start();
    this.#sceneEvents = createSceneEventIngress({
      projectRoot: options.projectRoot,
      im: options.im,
      runtime: options.runtime,
      agent: options.agent,
      memberLifecycle: this.#memberLifecycle,
      onSpoke,
    });
    this.#sessionEvents = createSessionEventDispatcher({
      im: options.im,
      agent: options.agent,
      onSpoke,
    });
    this.#stopSessionEvents = this.#sessionEvents.start();
    this.#groupRules = createGroupRuleChannel({
      im: options.im,
      agent: options.agent,
    });
    this.#stopGroupRules = this.#groupRules.start();
    this.#groupRuleEnforcer = createGroupRuleEnforcer({
      agent: options.agent,
      onSpoke,
    });
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
   * 执行器找到规则（含被控制面 / 豁免 / 冷却跳过）→ `handled`，插件不得再自行提醒或处罚；没有可用规则 → `no_rule`。
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
        ...(report.memberRoles ? { memberRoles: report.memberRoles } : {}),
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

  /**
   * ImRuntime.sceneEvents 订阅入口：先交给入群欢迎 / 退群记录（ADR 0037 切片 A），
   * 再按 #996 把高优先事件 coalesce + 限频后唤醒一次（已由模板欢迎接管的入群事件不再唤醒）。
   */
  handleSceneEvent(signal: RuntimeSceneEventSignal): void {
    try {
      this.#memberLifecycle.handle(signal);
    } catch (error) {
      logger.warn(formatCompact({ op: 'member_lifecycle_failed', error: error instanceof Error ? error.message : String(error) }));
    }
    this.#sceneEvents.handle(signal);
  }

  /** #1012 A9 方案②：插件旧欢迎发送前询问；会话开启 `welcome.enabled` 时由模板欢迎接管。 */
  ownsMemberWelcome(conversation: ConversationRef): boolean {
    return this.#memberLifecycle.ownsWelcome(conversation);
  }

  /** Bot 在场景里主动说过话：旁听「对话进行中」窗口 + 冷场计数清零。`key` 为 `<platform>:<群号>`。 */
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
  }

  /**
   * Same-session admission (#725). Created on first use so it reads the
   * configuration of this generation; one gate per route generation.
   */
  #gate(): TurnAdmissionGate {
    if (!this.#admissionGate) {
      const queue = normalizeInboundQueueConfig(this.options.agent.service.getAgentConfig()?.inboundQueue);
      this.#mergeWindowEnabled = queue.merge.enabled;
      this.#admissionGate = new TurnAdmissionGate({
        maxQueuedTurns: queue.maxQueuedTurns,
        queueTtlMs: queue.ttlMs,
        supersedeSameSender: queue.groupMode === 'supersede',
        // ADR 0038 §1: group merge window (opt-in in slice A).
        ...(queue.merge.enabled ? { merge: queue.merge } : {}),
        // ADR 0038 §5: only conversations of a `liveDanmaku` adapter ask for it.
        live: { windowMs: queue.live.windowMs, minIntervalMs: queue.live.minIntervalMs },
      });
    }
    return this.#admissionGate;
  }

  /** Pacing belongs to this route; model execution belongs to each held operation. */
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
    message: Message,
    _lease: SnapshotLease,
    _requester: PluginId,
    conversationSequence: number | undefined,
  ): Promise<boolean> {
    return await this.workroomPort.preRoute(message, conversationSequence);
  }

  shouldRouteBeforeDispatch(message: Message): boolean {
    return this.workroomPort.hasAgentTurn(message)
      && resolveRuntimeAgentTrigger(
        message,
        this.options.agent.service.getTriggerConfig(),
        true,
      ) != null;
  }

  async route(
    message: Message,
    lease: SnapshotLease,
    requester: PluginId,
    conversationSequence: number | undefined,
  ): Promise<boolean> {
    // Capture the actual inbound incarnation once, before async preprocessing can retire it.
    const operationSession = readOperationSession(message);
    const operationSignal = operationSession?.signal;
    const options = this.options;
    const service = options.agent.service;
    const zhinAgent = options.agent.agent;
    const traceRuntime = options.agent.traceRuntime;
    const binding = service.getBindingRegistry().requireZhinBinding();
    const ingress = options.ingress;
    const workroom = this.workroomPort;
    const snapshot = lease.value;
    const trigger = service.getTriggerConfig();
    const workroomAgentTurn = workroom.takeAgentTurn(message);
    let matched = resolveRuntimeAgentTrigger(message, trigger, workroomAgentTurn != null);

    const ownerId = resolveOwnerForRuntimeMessage(message, options.resolveEndpointOwner, snapshot);
    const endpointTrusted = resolveTrustedForRuntimeMessage(message, options.resolveEndpointTrusted, snapshot);
    const senderRoles = resolveRuntimeSenderRoles(message, { endpointMaster: ownerId, endpointTrusted, trigger });
    const turnAccess = createRuntimeTurnAccess(message, senderRoles, undefined, undefined, conversationSequence);
    // Unattended live reactions belong to the scene, independently of whichever
    // participant supplied the first candidate in the window.
    const liveRoom = !workroomAgentTurn
      && turnAccess.origin.kind === 'im'
      && turnAccess.origin.scope !== 'private'
      && adapterDeclaresLiveDanmaku(message.conversation.endpoint.id as CapabilityId, snapshot);
    let sessionKey = workroomAgentTurn
      ? workroomOrchestratorSessionKey(workroomAgentTurn)
      : liveRoom ? runtimeSceneTaskSessionKey(turnAccess, options.projectRoot)
        : runtimeImSessionKey(turnAccess, options.projectRoot);
    const workroomReplyConversation = workroomAgentTurn
      ? await workroom.resolveOrchestratorConversation(workroomAgentTurn)
      : undefined;
    if (workroomAgentTurn && !workroomReplyConversation) {
      throw new Error(`Workroom ${workroomAgentTurn.projectId} has no current Orchestrator projection binding`);
    }

    // Runtime message.adapter is a CapabilityId (\0-separated); strip it and
    // use Endpoint liveName so the OutboundHost resolve() succeeds.
    const effectiveAdapter = capabilityLocalName(String(message.conversation.endpoint.id));
    const effectiveEndpoint = adapterLiveEndpointId(message);
    const reply = async (
      content: SendContent,
    ): Promise<Awaited<ReturnType<Message['$reply']>>> => {
      const receipt = workroomReplyConversation
        ? await options.im.sendWithSnapshotLease(lease, {
            conversation: workroomReplyConversation,
            requester: rootPluginId(),
            content,
          })
        : await message.$reply(content);
      logger.debug(formatCompact({
        op: 'replychain_message_reply',
        status: receipt.status,
        code: receipt.failure?.code,
        messageId: receipt.message?.id,
      }));
      return receipt;
    };

    if (!workroomAgentTurn && turnAccess.origin.kind === 'im') {
      observeFloodMessage({
        im: options.im,
        enforcer: this.#groupRuleEnforcer,
        floodDetector: this.#floodDetector,
        message,
        platform: turnAccess.origin.platform,
        endpoint: effectiveEndpoint,
      });
    }

    if (await tryHandleIngressCommands({
      message,
      lease,
      operationSignal,
      sessionKey,
      senderRoles,
      turnAccess,
      ownerId,
      effectiveEndpoint,
      workroomAgentTurn,
      agent: options.agent,
      groupRules: this.#groupRules,
      toolApprovalIm: options.toolApprovalIm,
      withInference: (inferInput, run) => this.#withInference(inferInput, run),
      withModelScope: options.withModelScope,
      reply,
    })) {
      return true;
    }

    const platform = turnAccess.origin.kind === 'im' ? turnAccess.origin.platform : '';
    const ambientKey = message.conversation.kind === 'group' ? `${platform}:${message.conversation.id}` : undefined;
    let ambient = false;
    // 决策审计（ADR 0036 切片 B）：本条入站的所有判定共享一个 turn_id；写失败不影响回合。
    const turnId = randomUUID();
    const audit = !workroomAgentTurn && turnAccess.origin.kind === 'im'
      ? createDecisionAudit(zhinAgent.getDecisionEvents?.(), decisionScopeOf({
          turnId,
          platform,
          scope: turnAccess.origin.scope,
          sceneId: turnAccess.origin.sceneId,
          endpoint: effectiveEndpoint,
          userId: turnAccess.principal.subjectId,
        }))
      : NO_DECISION_AUDIT;
    // 控制面（ADR 0036 切片 D）：位于会话画像发言判定之前。emergency_stop → 实例 muted → 会话 muted →
    // read_only → mention_only；拦下时不跑 session-gate / 旁听判定，不调模型。
    const control = zhinAgent.getControlPlane?.();
    const controlTarget: ControlGateTarget | undefined = turnAccess.origin.kind === 'im'
      ? { platform, scope: turnAccess.origin.scope, sceneId: turnAccess.origin.sceneId }
      : undefined;
    // 冷场（ADR 0037 §1.3）：群里任意一条点名消息清零计数（不论之后是否被别的开关拦下）。
    if (ambientKey && matched != null) this.#coldField.reset(ambientKey);
    if (controlTarget) {
      const verdict = checkControlAtIngress(control, controlTarget, matched != null || controlTarget.scope === 'private');
      if (verdict.blocked) {
        logControlBlocked('agent_turn_skipped_control', `${platform}:${message.conversation.id}`, verdict);
        auditControlGate(audit, verdict, { source: 'message', addressed: matched != null });
        return matched != null;
      }
    }
    /** 出站兜底：回合进行中开关变化（例如一键 emergency_stop）时，发送前再判一次。 */
    const outboundBlocked = (stage: string): boolean => {
      if (!controlTarget) return false;
      const verdict = checkControlAtOutbound(control, controlTarget);
      if (!verdict.blocked) return false;
      logControlBlocked('agent_outbound_blocked_control', `${platform}:${message.conversation.id}`, verdict);
      auditControlOutbound(audit, verdict, { source: stage });
      return true;
    };
    // 会话画像（#996）：先折叠会话事件与发送者；Bot 在此会话不能发言（禁言 / 全员禁言 / 宿主限制）时
    // 直接不进 AI 回合，也不跑旁听判定，不调用模型。
    if (!workroomAgentTurn && turnAccess.origin.kind === 'im') {
      const blocked = await observeSessionAndCheckSpeak({
        sessions: zhinAgent.getUserProfiles?.()?.sessions,
        events: options.im.conversationEventReader,
        message,
        platform,
        scope: turnAccess.origin.scope,
        sceneId: turnAccess.origin.sceneId,
        senderId: turnAccess.principal.subjectId,
        endpointId: effectiveEndpoint,
        conversationSequence,
      });
      if (blocked) {
        logger.info(formatCompact({ op: 'agent_turn_skipped_cannot_speak', conv: `${platform}:${message.conversation.id}`, reason: blocked }));
        auditCannotSpeak(audit, blocked, { source: 'message', addressed: matched != null });
        return matched != null;
      }
    }
    // ADR 0038 §5: in a live room every danmaku is a candidate; viewers do not @ the Bot.
    if (!matched && liveRoom) {
      const text = message.content.trim();
      if (text && trigger?.enabled !== false && !hasIgnoredTriggerPrefix(text, trigger)) matched = { content: text };
    }
    if (!matched) {
      matched = workroomAgentTurn ? null : await considerAmbientEngagement({
        im: options.im,
        agent: options.agent,
        ambientEngagement: this.#ambientEngagement(),
        coldField: this.#coldField,
        assistantStatus: options.assistantStatus,
        withInference: (inferInput, run) => this.#withInference(inferInput, run),
        lease,
        message,
        conversationSequence,
        platform,
        botName: binding.nickname?.trim() || 'Zhin',
        audit,
      });
      if (!matched) return false;
      ambient = true;
      sessionKey = runtimeSceneTaskSessionKey(turnAccess, options.projectRoot);
    } else if (ambientKey) {
      this.#ambientEngagement()?.noteSpoke(ambientKey);
    }
    // #725: ordinary IM turns go through the admission gate. Workroom turns
    // and products that resolve their own turn intent keep their semantics.
    const intentResolver = resolveSnapshotTurnIntentResolver(snapshot, requester) ?? options.resolveTurnIntent;
    const gate = workroomAgentTurn || intentResolver || message.metadata?.turnIntent !== undefined
      ? undefined
      : this.#gate();
    const plainText = isPlainTextRuntimeMessage(message);
    const mergeable = gate !== undefined && !liveRoom && isMergeableGroupTurn({
      message,
      trigger,
      plainText,
      isMaster: senderRoles.isMaster,
      content: matched.content,
    });
    // ADR 0038 R0-fix (#1049, relative to #1104): the merge window is keyed by
    // Session, so a mergeable group wake waits in the shared scene Session (as
    // danmaku does) and different senders can land in one window. Masters,
    // commands, stop words, media / quote / forward, DMs and `merge.enabled: false`
    // stay in the sender's personal Session; so does `clear`, which only ever
    // archives the caller's own Session.
    const sceneMerge = mergeable && !ambient && this.#mergeWindowEnabled && !isClearCommand(matched.content);
    if (sceneMerge) sessionKey = runtimeSceneTaskSessionKey(turnAccess, options.projectRoot);
    audit({
      kind: 'inbound_wake',
      outcome: 'allow',
      reasonCode: ambient ? 'ambient_engaged' : 'inbound_addressed',
      payload: { source: 'message', scope: turnAccess.origin.kind === 'im' ? turnAccess.origin.scope : undefined },
    });
    // 状态感知（#996）：上次以来的社交事件（含低优先）作为本轮 ephemeral `[Scene events]`。
    const sceneEvents = !workroomAgentTurn && turnAccess.origin.kind === 'im' && turnAccess.origin.scope !== 'private'
      ? await this.#sceneEvents.linesFor({
        sessionKey,
        conversation: message.conversation,
        platform,
        endpointId: turnAccess.origin.endpoint,
        throughSequence: conversationSequence,
        selfIds: [effectiveEndpoint, message.metadata?.selfId, message.metadata?.self_id]
          .filter((value): value is string | number => (typeof value === 'string' && value !== '') || typeof value === 'number')
          .map(String),
      })
      : [];

    if (!workroomAgentTurn && isClearCommand(matched.content)) {
      await zhinAgent.archiveSession(sessionKey);
      await reply(t(message.locale, 'cleared'));
      return true;
    }

    const senderId = turnAccess.principal.subjectId;
    if (gate && isCancelIntent(matched.content)) {
      let stoppedKey = sessionKey;
      let stopped = gate.stop(sessionKey, senderId, senderRoles.isMaster);
      // A stop word is never mergeable, so it routes to the personal Session; a
      // merged group turn of the same scene runs in the scene Session (R0-fix).
      if (stopped !== 'stopped' && this.#mergeWindowEnabled && !liveRoom && !ambient
        && turnAccess.origin.kind === 'im' && turnAccess.origin.scope !== 'private') {
        const sceneKey = runtimeSceneTaskSessionKey(turnAccess, options.projectRoot);
        if (sceneKey !== sessionKey && gate.stop(sceneKey, senderId, senderRoles.isMaster) === 'stopped') {
          stopped = 'stopped';
          stoppedKey = sceneKey;
        }
      }
      if (stopped === 'stopped') {
        await reply(t(message.locale, 'stopped'));
        logger.info(formatCompact({ op: 'agent_host_turn_stopped', sessionKey: stoppedKey }));
        return true;
      }
      // Nothing of the sender's to stop: handle it as an ordinary message.
    }

    let capabilityActive = true;
    /** 进入模型回合的时刻；未进入时为 undefined（审计只为真正跑过的模型写 `model_run`）。 */
    let modelStartedAt: number | undefined;
    let spoke = false;
    const modelPayload = (): Record<string, unknown> => ({
      ambient,
      spoke,
      ...(modelStartedAt !== undefined ? { durationMs: Date.now() - modelStartedAt } : {}),
    });
    let admission: Extract<TurnAdmission, { kind: 'run' }> | undefined;
    let profileOperation: ReturnType<ImRuntime['endpoints']['captureOperation']> | undefined;
    /** ADR 0038 §4: the stale verdict is audited once per turn. */
    let staleAudited = false;
    const staleReplyBlocked = (): boolean => {
      const verdict = admission?.staleCheck();
      if (!verdict || verdict.kind === 'fresh') return false;
      if (!staleAudited) {
        staleAudited = true;
        auditStaleReply(audit, verdict);
      }
      return verdict.kind === 'discard';
    };
    try {
      const preprocessed = await preprocessInboundTurn(
        message,
        matched.content,
        options.transcribeUrl,
      );
      let inbound = preprocessed;
      if (gate) {
        const admitted = await gate.admit({
          sessionKey,
          senderId,
          text: preprocessed.text,
          plainText,
          // Masters keep their own turn (ADR 0038 §0.3), in a live room too.
          live: liveRoom && !senderRoles.isMaster,
          mergeable,
          ...(message.sender?.name ? { senderName: message.sender.name } : {}),
          ...(message.message?.id ? { messageId: message.message.id } : {}),
          access: turnAccess,
          onWindowJoined: (window) => audit({
            kind: 'inbound_wake',
            outcome: 'defer',
            reasonCode: 'merge_window_joined',
            payload: { source: 'message', senders: window.senders.length, messages: window.messages },
          }),
        });
        if (admitted.kind === 'merged') {
          logger.debug(formatCompact({ op: 'agent_host_turn_merged', sessionKey }));
          return true;
        }
        if (admitted.kind === 'rejected') {
          logger.info(formatCompact({ op: 'agent_host_turn_rejected', sessionKey, reason: admitted.reason }));
          const notice = admissionRejectionNotice(admitted.reason, message.locale);
          if (notice) await reply(notice);
          return true;
        }
        admission = admitted;
        inbound = { ...preprocessed, text: admitted.text };
        const window = admitted.facts.mergeWindow;
        if (window) {
          audit({
            kind: 'inbound_wake',
            outcome: 'allow',
            reasonCode: 'merge_window_flushed',
            payload: {
              source: 'message',
              senders: window.senders,
              messages: window.messages,
              waitedMs: window.waitedMs,
            },
          });
        }
      }
      const { outcome, capabilities, routed } = await withTriggerTimeout(async (timeoutSignal) => {
        const signal = AbortSignal.any([
          timeoutSignal,
          ...(operationSignal ? [operationSignal] : []),
          ...(admission ? [admission.signal] : []),
          ...(lease.stopSignal ? [lease.stopSignal] : []),
        ]);
        const source = readOperationSession(message);
        if (source) profileOperation = options.im.endpoints.captureOperation({
          target: message.conversation, client: source.endpoint, signal, requester,
        });
        const contextState = await resolveRuntimeTurnContextState({
          snapshot,
          conversation: message.conversation,
          signal,
          senderId: message.sender?.id,
          selfProfile: profileOperation?.profile,
          factServices: { store: options.agent.agent.getUserProfiles?.()?.scenes, refresher: this.#sceneFactRefresher },
        });
        signal.throwIfAborted();
        // ADR 0044: platform capabilities, resolved once from the facts just read.
        const platformCapabilities = resolveRuntimeTurnCapabilities(snapshot, message.conversation, contextState);
        // Capabilities are read with the resolved conversation facts (bot role, mute) on the access.
        const contextAccess = createRuntimeTurnAccess(message, senderRoles, contextState, platformCapabilities, conversationSequence);
        // ADR 0038 §5: a danmaku turn answers its window as an anonymous viewer, read-only.
        const liveWindow = admission?.facts.liveWindow;
        const liveDanmaku: TurnLiveDanmaku | undefined = liveWindow && admission
          ? Object.freeze({
              mode: normalizeInboundQueueConfig(service.getAgentConfig()?.inboundQueue).live.mode,
              candidates: liveWindow.candidates,
              senders: mergedTurnSenders(admission.participants),
            })
          : undefined;
        const liveAccess = liveDanmaku ? anonymousMemberAccess(contextAccess, senderId) : undefined;
        if (liveWindow) {
          logger.debug(formatCompact({ op: 'agent_host_danmaku_window', sessionKey, candidates: liveWindow.candidates, kept: liveWindow.kept }));
        }
        // ADR 0038 §2: a merged turn may only do what every member may do; if the
        // carrier stopped its own messages leaving another participant, use that participant's access.
        const hasMergedOrShiftedParticipants = !liveDanmaku && admission !== undefined && (
          admission.participants.length > 1
          || (admission.participants.length === 1 && admission.participants[0]!.senderId !== senderId)
        );
        const members = hasMergedOrShiftedParticipants && admission
          ? mergedMemberAccess(admission.participants, contextAccess)
          : undefined;
        const effectiveCarrier = members ? members[0]! : (liveAccess ?? contextAccess);
        const read = await readTurnCapabilities(
          ingress,
          snapshot,
          requester,
          effectiveCarrier,
          members && members.length > 1 ? members : undefined,
          () => capabilityActive,
        );
        signal.throwIfAborted();
        const turnAccessForTurn = members
          ? (members.length > 1
            ? withMergeMembers(narrowMergedAccess(effectiveCarrier, members), read.members, read.memberTools)
            : effectiveCarrier)
          : effectiveCarrier;
        // ADR 0038 §3: the model sees who it is answering; outbound audits "merged N, answered M".
        const mergedSenders = members && members.length > 1 && admission ? mergedTurnSenders(admission.participants) : undefined;
        const capabilities = liveDanmaku ? readOnlyCapabilities(read.capabilities) : read.capabilities;
        /** `danmaku_window_picked` is written once, for the first delivered reply. */
        let danmakuAudited = false;
        let routed = routeSpecialistAgent(
          inbound.text,
          capabilities,
          workroomAgentTurn?.agentDefinitionId,
          binding.name,
          turnAccess.origin.kind === 'im' ? turnAccess.origin.platform : undefined,
        );
        // thinkingMessage：进入 AI 处理前先回占位（对齐 legacy inbound-turn-pipeline）。
        // 占位消息不 await 回包——平台 ack 慢不应拖住 turn 启动；
        // 失败仅记日志（正式回复仍走 replyAndRecord 的完整确认）。
        if (trigger.thinkingMessage && !ambient && !liveDanmaku && !outboundBlocked('thinking')) {
          message.$reply(trigger.thinkingMessage).catch((error: unknown) => {
            logger.debug(formatCompact({
              op: 'agent_host_thinking_reply_failed',
              error: error instanceof Error ? error.message : String(error),
            }));
          });
        }

        const traceId = randomUUID();
        modelStartedAt = Date.now();
        const outcome = await this.#withInference({ lease, sessionKey, operationId: turnId, signal }, scope => runWithAgentDecisionTurn({
          snapshot, turnId, inferenceSnapshot: scope.snapshot, models: { graph: scope.graph, inference: scope.client, resolve: scope.resolve },
          disabled: workroomAgentTurn != null, observe: observation => {
            options.assistantStatus?.recordDecision(observation);
            logger.debug(formatCompact({
              op: 'agent_decision_evaluation',
              task: observation.task,
              mode: observation.mode,
              outcome: observation.outcome,
              candidates: observation.candidates,
              selected: observation.selected,
              durationMs: observation.durationMs,
              model: observation.model,
              reason: observation.reason,
              inputTokens: observation.usage?.inputTokens,
              outputTokens: observation.usage?.outputTokens,
            }));
          },
        }, async decisionRuntime => {
          routed = await selectDecisionAgentRoute({
            routed,
            capabilities,
            decisionRuntime,
            workroomTurn: workroomAgentTurn != null,
            signal,
          });
          const approvalPolicy = decisionRuntime?.config.approval;
          const approvalJudgment = decisionRuntime && approvalPolicy && approvalPolicy.mode !== 'off'
            ? new DecisionApprovalJudgment({
                provider: decisionRuntime.forTask('approval')!,
                policy: approvalPolicy,
                baseline: options.agent.approvalJudgment,
                observe: decisionRuntime.observe,
                intent: routed.userText,
                principal: turnAccessForTurn.principal,
              })
            : undefined;
          const turnPolicy = resolveSandboxTurnPolicy({
            runtimeSandbox: turnAccess.origin.kind === 'im' && platformCapabilities?.has('runtime.sandbox') === true,
            isMaster: senderRoles.isMaster,
            scope: turnAccess.origin.kind === 'im' ? turnAccess.origin.scope : undefined,
            masterShell: service.getAgentConfig()?.masterShell,
            masterShellApprovalMode: service.getAgentConfig()?.masterShellApprovalMode,
            execApprovalMode: service.getAgentConfig()?.execApprovalMode,
            metadata: message.metadata,
            projectRoot: options.projectRoot,
            defaultNetwork: interactiveNetworkPolicy(service.getAgentConfig()),
          });
          const approverId = senderRoles.isMaster ? message.sender?.id : (ownerId ?? trigger?.masters?.[0]);
          const approvalInteraction = approverId
            ? options.im.createInteraction(message, { subjectId: approverId })
            : undefined;
          const askApprovalPort = createRuntimeApprovalPort({
            locale: message.locale,
            // Sandbox `ask` must be a real interaction, even though the
            // authenticated Console user maps to the endpoint owner.
            isMaster: senderRoles.isMaster && turnPolicy.shell?.approvalMode !== 'ask',
            interaction: approvalInteraction,
            memory: options.agent.approvalReviewer,
          });
          const escalatedApprovalPort = createRuntimeApprovalPort({
            locale: message.locale,
            isMaster: false,
            interaction: approvalInteraction,
            memory: options.agent.approvalReviewer,
          });
          const replyConversation = workroomReplyConversation ?? message.conversation;
          const replySegments = resolveAiOutboundSegments(
            replyConversation.endpoint.id as CapabilityId,
            snapshot,
            replyConversation.kind,
          );
          let replyOperation: CapturedEndpointOperation | undefined;
          const request = createRuntimeTurnRequest({ message, text: routed.userText, roles: senderRoles }, {
            ...(members || liveAccess ? { access: turnAccessForTurn } : {}),
            traceId,
            turnId,
            signal,
            projectRoot: options.projectRoot,
            workspaceRoot: turnPolicy.filesystem.workspaceRoot,
            workingDirectory: turnPolicy.filesystem.workingDirectory,
            filesystemAccess: liveDanmaku ? 'read-only' : turnPolicy.filesystem.access,
            shell: liveDanmaku ? undefined : turnPolicy.shell,
            network: turnPolicy.network,
            sessionKey,
            ...(!workroomAgentTurn && !liveRoom && !ambient && !sceneMerge
              ? { personalSession: runtimePersonalSessionAddress(turnAccess, options.projectRoot) } : {}),
            contextState,
            ...(platformCapabilities ? { platformCapabilities } : {}),
            ...(conversationSequence !== undefined ? { conversationSequence } : {}),
            ...(sceneEvents.length ? { sceneEvents } : {}),
            ...(mergedSenders ? { mergedSenders } : {}),
            ...(liveDanmaku ? { liveDanmaku } : {}),
            ...(workroomAgentTurn ? {
              trustedMetadata: Object.freeze({
                workroom: Object.freeze({
                  projectId: workroomAgentTurn.projectId,
                  proposalId: workroomAgentTurn.proposalId,
                  space: workroomAgentTurn.space,
                  disposition: 'discussion',
                  orchestratorAgentDefinitionId: workroomAgentTurn.agentDefinitionId,
                }),
              }),
            } : ambient ? {
              trustedMetadata: Object.freeze({ [AMBIENT_ENGAGEMENT_METADATA_KEY]: 'ambient' }),
            } : {}),
            // The gate already serialized (and, if needed, superseded) this
            // session, so the coordinator only has to queue behind it.
            intent: admission ? Object.freeze({ kind: 'new' as const }) : await resolveProductTurnIntent(
              message,
              senderRoles,
              service.getAgentConfig()?.inboundQueue?.groupMode,
              intentResolver,
            ),
            resolveReference: (reference, limits, referenceSignal) =>
              options.im.resolveConversationReference(lease, reference, {
                signal: referenceSignal,
                maxDepth: limits.depth,
                maxEntries: limits.maxEntries,
                maxChars: limits.maxChars,
              }),
            ...(conversationSequence === undefined || workroomAgentTurn ? {} : {
              readConversationContext: async (consumer: string, contextSignal: AbortSignal) => {
                contextSignal.throwIfAborted();
                if (!lease.active) throw new Error('Conversation context generation lease expired');
                return options.im.readConversationContext(
                  message.conversation,
                  consumer,
                  conversationSequence,
                  50,
                  message.message?.id,
                );
              },
              commitConversationContext: async (consumer: string, cursor: number) => {
                if (!lease.active) throw new Error('Conversation context generation lease expired');
                await options.im.commitConversationContext(message.conversation, consumer, cursor);
              },
            }),
            ports: {
              ...(profileOperation?.profile ? { selfProfile: profileOperation.profile } : {}),
              // ADR 0038 §5: a danmaku turn never puts an approval card in front of anyone.
              approval: liveDanmaku ? NO_APPROVAL_PORT : options.approvalPort ?? resolveApprovalPort({
                mode: turnPolicy.shell?.approvalMode
                  ?? service.getAgentConfig()?.execApprovalMode
                  ?? 'auto',
                auto: createAutoApprovalPort(
                  options.agent.approvalReviewer,
                  escalatedApprovalPort,
                  approvalJudgment,
                  // Master's own DM: a reviewer rejection asks the master instead of refusing.
                  { escalateRejections: senderRoles.isMaster && turnAccess.origin.kind === 'im' && turnAccess.origin.scope === 'private' },
                ),
                ask: askApprovalPort,
              }),
              question: createRuntimeQuestionPort(options.im, message),
              reply: {
                // Message segments follow the target scene; reactions additionally need the original message.
                segments: workroomReplyConversation || !message.message
                  ? { ...replySegments, reaction: undefined }
                  : replySegments,
                openStream: () => {
                  // Redirected workroom and live-room replies keep their existing delivery authority.
                  if (workroomAgentTurn || workroomReplyConversation || liveDanmaku) return undefined;
                  replyOperation ??= options.im.endpoints.captureOperation({ target: replyConversation,
                    client: message.$client, signal, requester });
                  const stream = replyOperation.openReplyStream?.({ locale: message.locale,
                    source: { messageId: message.message?.id, senderId: message.sender?.id, event: operationSession?.event },
                    beforeSubmit: () => {
                      if (staleReplyBlocked() || outboundBlocked('reply')) {
                        throw new EndpointDeliveryError('reply_suppressed', 'Reply admission is no longer active', 'not_sent');
                      }
                    },
                    prepare: segments => publishOutboundElements([{ type: 'message', segments: [...segments] }],
                      effectiveAdapter || undefined, undefined, { filesystem: turnPolicy.filesystem,
                        imageAssets: options.agent.service.imageAssets,
                        ...(turnPolicy.network ? { network: turnPolicy.network } : {}) }),
                  });
                  if (!stream) return undefined;
                  let settlement: Promise<CoreReplyStream['receipt']> | undefined;
                  const settle = (receipt: CoreReplyStream['receipt']) => settlement ??= Promise.resolve().then(() => {
                    const outcome = deliveryOutcomeFromReceipt(receipt);
                    auditOutbound(audit, outcome, { progressive: true });
                    if (stream.confirmed.length) { spoke = true; admission?.markDelivered(); }
                    return receipt;
                  });
                  return Object.freeze({
                    get minIntervalMs() { return stream.minIntervalMs; },
                    get receipt() { return stream.receipt; }, get confirmed() { return stream.confirmed; },
                    update: snapshot => stream.update(snapshot),
                    finish: snapshot => stream.finish(snapshot).then(settle),
                    cancel: () => stream.cancel().then(settle),
                  } satisfies CoreReplyStream);
                },
                send: async (output) => {
                  logger.debug(formatCompact({
                    op: 'replychain_port_send',
                    outputElements: output.length,
                    outputPreview: flattenOutputElements(output).trim() || '(empty)',
                  }));
                  const mergeAudit = mergedSenders ? mergedReplyAuditPayload(mergedSenders, output) : {};
                  const outcome = await sendOutputMessages(output, {
                    render: messageOutput => flattenOutputElements([...messageOutput]),
                    send: async (messageOutput) => {
                      if (staleReplyBlocked()) {
                        logger.debug(formatCompact({ op: 'agent_host_reply_stale_discarded', sessionKey }));
                        return { status: 'suppressed' as const };
                      }
                      if (outboundBlocked('reply')) {
                        auditOutbound(audit, { status: 'suppressed' }, { control: true });
                        return { status: 'suppressed' as const };
                      }
                      const reaction = reactionOf(messageOutput);
                      if (reaction !== undefined) {
                        // A gesture, not a message: best effort, paced per session, and it counts as having answered.
                        const delivery = await deliverReaction({
                          pacer: this.#reactionPacer,
                          sessionKey,
                          add: message.message
                            ? () => options.im.endpoints.addReaction({
                                message: message.message!,
                                emoji: reaction,
                              }).catch((error: unknown) => {
                                logger.debug(formatCompact({ op: 'agent_reaction_failed', error: error instanceof Error ? error.message : String(error) }));
                                return null;
                              })
                            : undefined,
                        });
                        const applied = delivery.applied ? {} : null;
                        logger.debug(formatCompact({ op: 'agent_reaction', emoji: reaction, applied: applied !== null, ...(delivery.paced ? { paced: true } : {}) }));
                        admission?.markDelivered();
                        spoke = true;
                        auditOutbound(audit, { status: 'sent' }, { reaction: true, applied: delivery.applied, ...(delivery.paced ? { paced: true } : {}) });
                        return { status: 'sent' as const };
                      }
                      // Model output may name local files or URLs: hold them to this Turn's own authority.
                      const content = await publishOutboundElements([...messageOutput], effectiveAdapter || undefined, resolveOutboundCapabilities(effectiveAdapter, platformCapabilities), {
                        filesystem: turnPolicy.filesystem,
                        imageAssets: options.agent.service.imageAssets,
                        ...(turnPolicy.network ? { network: turnPolicy.network } : {}),
                      });
                      logger.debug(formatCompact({
                        op: 'replychain_publish_outbound',
                        segments: content.length,
                      }));
                      if (content.length === 0) {
                        auditOutbound(audit, { status: 'suppressed' });
                        return { status: 'suppressed' as const };
                      }
                      let sent: Awaited<ReturnType<typeof deliveryOutcomeFromReceipt>>;
                      try {
                        const plannedText = content.length && content.every((segment): segment is TextSegment => segment.type === 'text')
                          ? content.map(segment => String(segment.data.text)).join('') : undefined;
                        sent = deliveryOutcomeFromReceipt(await reply(content), plannedText);
                      } catch (error) {
                        auditOutbound(audit, { status: 'failed', code: error instanceof Error ? error.message : String(error), retryable: false });
                        throw error;
                      }
                      auditOutbound(audit, sent, { segments: content.length, ...mergeAudit });
                      if (liveDanmaku && sent.status === 'sent' && !danmakuAudited) {
                        danmakuAudited = true;
                        audit({
                          kind: 'outbound',
                          outcome: 'allow',
                          reasonCode: 'danmaku_window_picked',
                          payload: liveReplyAuditPayload(liveDanmaku, output),
                        });
                      }
                      if (sent.status === 'sent') {
                        spoke = true;
                        admission?.markDelivered();
                      }
                      return sent;
                    },
                  });
                  logger.debug(formatCompact({
                    op: 'replychain_delivery_outcome',
                    status: outcome.status,
                    code: 'code' in outcome ? outcome.code : undefined,
                    messageId: 'messageId' in outcome ? outcome.messageId : undefined,
                  }));
                  return outcome;
                },
              },
            },
          });
          try {
            return await options.runtime.executeLeased(
              lease,
              requester,
              request,
              {
                binding,
                mcpServers: liveDanmaku ? [] : binding.mcpServers,
                agent: routed.agent?.qualifiedName ?? routed.agent?.name,
              },
              observeWithAdmission(observeAgentTurnTrace(traceRuntime, request), turnId, admission),
            );
          } finally { replyOperation?.release(); }
        }));
        return { outcome, capabilities, routed };
      }, resolveTriggerTimeoutMs(trigger));
      auditModelRun(audit, outcome, { ...modelPayload(), agent: routed.agent?.name ?? null });
      const elements = completedOutput(outcome);
      const outputText = flattenOutputElements(elements).trim();
      if (!outputText) {
        // 委派回合 finalReply 为空：用户可见文案由协作结果回流后的续写回合送出；
        // 勿把 '(empty AI response)' 当成正文发给用户。
        logger.debug(formatCompact({
          op: 'agent_host_turn_no_outbound',
          reason: 'empty_elements_delegated',
        }));
      }
      logger.debug(formatCompact({
        op: 'agent_host_turn',
        turnMode: 'agent_runtime.execute',
        tools: outcome.status === 'completed' ? capabilities.tools.length : 0,
        ingressTools: capabilities.tools.length,
        elements: elements.length,
        stt: inbound.sttApplied,
        agent: routed.agent?.name ?? '-',
      }));
      return true;
    } catch (error) {
      if (admission?.signal.aborted) {
        // Superseded by the sender's newer message or stopped on request:
        // the replacement turn (or the stop notice) is the answer.
        if (modelStartedAt !== undefined) {
          audit({ kind: 'model_run', outcome: 'skip', reasonCode: 'model_superseded', payload: modelPayload(), actor: 'model' });
        }
        logger.debug(formatCompact({ op: 'agent_host_turn_replaced', sessionKey }));
        return true;
      }
      const detail = error instanceof Error ? error.message : String(error);
      logger.warn(formatCompact({ op: 'agent_host_turn_fail', error: detail }));
      if (modelStartedAt !== undefined) auditModelError(audit, error, modelPayload());
      try {
        const line = renderChatTurnError(trigger, error, senderRoles.isMaster, message.locale);
        if (line && !outboundBlocked('error_reply')) await reply(line);
      } catch {
        /* ignore reply failure */
      }
      return true;
    } finally {
      capabilityActive = false;
      profileOperation?.release();
      admission?.release();
    }
  }
}
