import { readOperationSession, type VenueProjector, type VenueRegistry } from '@zhin.js/core';
import { ingressMessages as t } from './ingress-messages.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ConversationRef } from '@zhin.js/im-contract';
import type { ApprovalPort } from '../../session/approval-port.js';
import { normalizeMailboxConfig, type TurnAdmission } from '../../turn/index.js';
import { HostMailbox } from '../../collaboration/host-mailbox.js';
import type { CapabilityIngress } from '../capability-ingress.js';
import type { AgentRuntime } from '../agent-runtime.js';
import type { TurnIntentResolver } from '../turn-intent-resolver.js';
import type { InferenceOperationScope } from '@zhin.js/ai/provider';
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
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { PluginId, SnapshotLease } from '@zhin.js/plugin-runtime';
import { isClearCommand } from './content.js';
import { isMergeableGroupTurn } from './trigger.js';
import {
  adapterLiveEndpointId,
  capabilityLocalName,
  createRuntimeTurnAccess,
  isPlainTextRuntimeMessage,
  resolveOwnerForRuntimeMessage,
  resolveRuntimeSenderRoles,
  resolveSnapshotTurnIntentResolver,
  resolveTrustedForRuntimeMessage,
  runtimeSceneTaskSessionKey,
} from './request.js';
import { AmbientEngagement } from './ambient-engagement.js';
import { SceneEventIngress } from './scene-event-ingress.js';
import { MemberLifecycle } from './member-lifecycle.js';
import { SceneFactRefresher } from './scene-fact-refresher.js';
import { AnnouncementDispatcher } from './announcement-dispatch.js';
import { GroupRuleImChannel } from './group-rule-im.js';
import { GroupRuleEnforcer } from './group-rule-enforcer.js';
import { GroupFloodDetector } from './group-flood-detector.js';
import { ReactionPacer } from './reaction-pacer.js';
import { GroupRuleDefaults } from './group-rule-defaults.js';
import { ColdFieldMonitor } from './cold-field.js';
import { SessionEventDispatcher } from './session-event-dispatch.js';
import { createDecisionAudit, decisionScopeOf, NO_DECISION_AUDIT } from './decision-audit.js';
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
  observeAgentTurnTrace,
  type AgentAssistantStatusPort,
  type AgentIngressFoundationPort,
  type ImApprovalChannelPort,
} from './ports.js';
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
import {
  executeAdmittedMailTurn,
  type ExecuteAdmittedMailTurnInput,
  type IngressTurnExecutionHooks,
} from './ingress-turn-runner.js';

const logger = getLogger('agent');

export {
  admitIngressMailTurn,
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
  resolvePreRoutedEntryActorName,
  selectDecisionAgentRoute,
  tryStopActiveMailTurn,
  type CreateIngressReplyPortInput,
  type ExecuteAdmittedMailTurnInput,
  type IngressGateEvaluation,
  type IngressOutboundHooks,
  type IngressTurnExecutionHooks,
  type IngressVenueRoutingContext,
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
    this.#hostMailbox?.dispose();
    this.#hostMailbox = undefined;
  }

  #mailbox(): HostMailbox {
    if (!this.#hostMailbox) {
      const config = normalizeMailboxConfig(this.options.agent.service.getAgentConfig()?.mailbox);
      this.#mergeWindowEnabled = config.merge.enabled;
      this.#hostMailbox = new HostMailbox({ config });
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
