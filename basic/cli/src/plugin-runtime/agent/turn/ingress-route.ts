import { ingressMessages as t } from './ingress-messages.js';
import { randomUUID } from 'node:crypto';
import type { ConversationRef } from '@zhin.js/im-contract';
import {
  createAutoApprovalPort,
  createBypassApprovalPort,
  detachedTaskRunnerToken,
  handleDetachedTaskCommand,
  handleRuntimeManagementCommand,
  managementCommandText,
  routeTaskInterjection,
  type DetachedTaskRunner,
  publishOutboundElements,
  REACTION_SEGMENT_TYPE,
  type AgentOutputElement,
  type ApprovalPort,
} from '@zhin.js/agent';
import { DecisionApprovalJudgment } from '@zhin.js/agent/session';
import { noteTurnTrace } from '@zhin.js/agent/trace';
import {
  intersectCapabilities,
  isCancelIntent,
  narrowMergedAccess,
  normalizeInboundQueueConfig,
  withMergeMembers,
  TurnAdmissionGate,
  type TurnAccessContext,
  type TurnAdmission,
} from '@zhin.js/agent/turn';
import {
  CapabilityIngress,
  AgentRuntime,
  type AgentCapabilities,
  type TurnIntentResolver,
  type AgentDecisionRuntime,
  rankDecisionCandidates,
  resolveAgentDecisionRuntime,
  runWithAgentDecisionTurn,
  type DecisionObservation,
} from '@zhin.js/agent/runtime';
import type { DecisionProvider, DecisionTaskConfig } from '@zhin.js/ai';
import {
  resolveAiOutboundSegments,
  type ImRuntime,
  type IngressRoute,
  type Message,
  type RuntimeSceneEventSignal,
  type SendContent,
} from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { sendOutputMessages } from './reply-messages.js';
import {
  rootPluginId,
  type Locale,
  type CapabilityId,
  type PluginId,
  type RuntimeSnapshot,
  type SnapshotLease,
} from '@zhin.js/plugin-runtime';
import { observeAgentTurnTrace } from '../runtime-factory.js';
import type { AgentRuntimeFoundation } from '../runtime-foundation.js';
import type { ImToolApprovalChannel } from '../tool-approval-im-channel.js';
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
  restrictWorkroomAgentCapabilities,
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
  resolveSnapshotTurnIntentResolver,
  resolveTrustedForRuntimeMessage,
  runtimeImSessionKey,
} from './request.js';
import { NO_WORKROOM_PORT, type AgentWorkroomPort } from '../workroom-port.js';
import { AMBIENT_ENGAGEMENT_METADATA_KEY } from '@zhin.js/agent/context';
import {
  AmbientEngagement,
  createAmbientDecisionJudge,
  type AmbientDecision,
  FallbackEngagementJudge,
  LlmEngagementJudge,
  type EngagementJudge,
} from './ambient-engagement.js';
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
import { AnnouncementDispatcher } from './announcement-dispatch.js';
import { GroupRuleImChannel } from './group-rule-im.js';
import { GroupRuleEnforcer, type GroupRuleEnforcementResult, type GroupRuleViolation } from './group-rule-enforcer.js';
import { resolveToolHardGateImApproval } from '@zhin.js/agent/security';
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
  type DecisionAudit,
} from './decision-audit.js';
import type { AssistantStatus } from '../../console/assistant-status.js';

const logger = getLogger('agent');
/** Read-only consumer: the ambient judge never moves the Agent session's context cursor. */
const AMBIENT_CONTEXT_CONSUMER = 'zhin.ambient-engagement';
const AMBIENT_CONTEXT_MESSAGES = 20;

function logAmbientDecisionObservation(observation: DecisionObservation): void {
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

export interface AgentTurnIngressRouteOptions {
  readonly projectRoot: string;
  readonly runtime: AgentRuntime;
  readonly im: ImRuntime;
  readonly transcribeUrl?: (audioUrl: string) => Promise<string | null>;
  readonly approvalPort?: ApprovalPort;
  readonly resolveTurnIntent?: TurnIntentResolver;
  readonly resolveEndpointOwner?: (adapterLocalName: string, endpointKey: string) => string | undefined;
  readonly resolveEndpointTrusted?: (adapterLocalName: string, endpointKey: string) => readonly string[];
  readonly ingress: CapabilityIngress;
  readonly agent: AgentRuntimeFoundation;
  /** Absent when the optional Workroom package is not installed. */
  readonly workroom?: AgentWorkroomPort;
  /** Process-owned Console status for 群聊插话 / 技能助手 (#970); metadata only. */
  readonly assistantStatus?: AssistantStatus;
  /** Detached task runner (#732); a snapshot-provided `detachedTaskRunnerToken` wins. */
  readonly detachedTasks?: DetachedTaskRunner;
  /** Hard-gate IM approval channel (G6, #1013): settles `approve <id>` / `deny <id>` for approval cards. */
  readonly toolApprovalIm?: ImToolApprovalChannel;
}

/** Generation-owned IM ingress adapter for management, approval, and Agent turns. */
export class AgentTurnIngressRoute implements IngressRoute {

  #admissionGate: TurnAdmissionGate | undefined;
  #ambient: AmbientEngagement | null | undefined;
  /** Chat-model judge(s) from `ai.trigger.ambient.judge`; the fallback of the decision route. */
  #ambientLlmJudge: EngagementJudge | undefined;
  /** Decision route for `ai.decisions.ambient` per group, kept while provider and policy are unchanged. */
  readonly #ambientDecisionJudges = new Map<string, { provider: DecisionProvider; policy: DecisionTaskConfig; judge: EngagementJudge }>();
  private readonly workroomPort: AgentWorkroomPort;
  /** 状态感知（#996）：高优先社交事件独立唤醒；所有回合的 `[Scene events]` 摘要。 */
  readonly #sceneEvents: SceneEventIngress;
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
    this.#memberLifecycle = this.#createMemberLifecycle();
    this.#announcements = this.#createAnnouncementDispatcher();
    this.#stopAnnouncementSweep = this.#announcements.start();
    this.#sceneEvents = this.#createSceneEventIngress();
    this.#sessionEvents = this.#createSessionEventDispatcher();
    this.#stopSessionEvents = this.#sessionEvents.start();
    this.#groupRules = this.#createGroupRuleChannel();
    this.#stopGroupRules = this.#groupRules.start();
    this.#groupRuleEnforcer = this.#createGroupRuleEnforcer();
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
  }

  #createGroupRuleChannel(): GroupRuleImChannel {
    const options = this.options;
    return new GroupRuleImChannel({
      // 构造时就订阅；测试桩可能不带 agent。
      rules: () => options.agent?.agent?.getGroupRules?.(),
      controlPlane: () => options.agent.agent.getControlPlane?.(),
      imApproval: () => resolveToolHardGateImApproval(options.agent.agent.config?.toolHardGate?.imApproval),
      send: async (target, text) => {
        const endpointKey = target.endpoint ?? this.#soleEndpoint(target.platform);
        if (!endpointKey) throw new Error('endpoint_unresolved');
        await options.im.endpoints.send({
          adapter: target.platform,
          endpointKey,
          conversation: { kind: 'group', id: target.groupId },
          content: text,
        });
      },
    });
  }

  #createGroupRuleEnforcer(): GroupRuleEnforcer {
    const options = this.options;
    const endpointOf = (target: { platform: string; endpoint: string | null }) => {
      const endpointKey = target.endpoint ?? this.#soleEndpoint(target.platform);
      if (!endpointKey) throw new Error('endpoint_unresolved');
      return endpointKey;
    };
    return new GroupRuleEnforcer({
      rules: () => options.agent?.agent?.getGroupRules?.(),
      controlPlane: () => options.agent.agent.getControlPlane?.(),
      sessions: () => options.agent.agent.getUserProfiles?.()?.sessions,
      decisionEvents: () => options.agent.agent.getDecisionEvents?.(),
      hardGate: () => options.agent.agent.config?.toolHardGate,
      approvals: () => options.agent.agent.toolApprovals,
      opsCooldown: () => options.agent.agent.opsCooldown,
      onSpoke: (key) => this.#noteSpoke(key),
      send: async (target, parts) => {
        const content = parts.map((part) => (part.type === 'text'
          ? { type: 'text', data: { text: part.text } }
          : { type: 'mention', data: { target: part.id, ...(part.name ? { name: part.name } : {}) } }));
        const result = await options.im.endpoints.send({
          adapter: target.platform,
          endpointKey: endpointOf(target),
          conversation: { kind: 'group', id: target.groupId },
          content,
        });
        return { status: 'sent' as const, ...(result.messageId ? { messageId: result.messageId } : {}) };
      },
      inspect: async (target, memberId, signal) => {
        const result = await options.im.endpoints.withManagement(target.platform, endpointOf(target), (management) =>
          management.inspectGroupMember ? management.inspectGroupMember(target.groupId, memberId, signal) : undefined);
        return result ?? undefined;
      },
      mute: async (target, memberId, durationSec, signal) => {
        const done = await options.im.endpoints.withManagement(target.platform, endpointOf(target), async (management) => {
          // 优先走「执行前复核权限」的接口。
          if (management.moderateGroupMember) {
            await management.moderateGroupMember(target.groupId, memberId, { type: 'mute', durationSeconds: durationSec }, signal);
          } else if (management.muteGroupMember) {
            await management.muteGroupMember(target.groupId, memberId, durationSec);
          } else {
            throw new Error('mute_unsupported');
          }
          return true;
        });
        if (!done) throw new Error('endpoint_unavailable');
      },
      kick: async (target, memberId) => {
        const done = await options.im.endpoints.withManagement(target.platform, endpointOf(target), async (management) => {
          if (!management.kickGroupMember) throw new Error('kick_unsupported');
          await management.kickGroupMember(target.groupId, memberId);
          return true;
        });
        if (!done) throw new Error('endpoint_unavailable');
      },
    });
  }

  /**
   * 群规执行入口（ADR 0039 §4）：违规判定方（`flood` 检测、content-moderation）报告一次命中，
   * 这里按该群生效规则的阶梯档执行。没有生效规则时什么都不做。
   */
  enforceGroupRule(violation: GroupRuleViolation): Promise<GroupRuleEnforcementResult> {
    return this.#groupRuleEnforcer.enforce(violation);
  }

  #createSessionEventDispatcher(): SessionEventDispatcher {
    const options = this.options;
    return new SessionEventDispatcher({
      events: () => options.agent.agent.getSessionEvents?.(),
      controlPlane: () => options.agent.agent.getControlPlane?.(),
      sessions: () => options.agent.agent.getUserProfiles?.()?.sessions,
      decisionEvents: () => options.agent.agent.getDecisionEvents?.(),
      onSpoke: (key) => this.#noteSpoke(key),
      send: async (target, text) => {
        const endpointKey = target.endpoint ?? this.#soleEndpoint(target.platform);
        if (!endpointKey) return { status: 'failed' as const, code: 'endpoint_unresolved', retryable: false };
        const result = await options.im.endpoints.send({
          adapter: target.platform,
          endpointKey,
          conversation: { kind: target.scope, id: target.id },
          content: text,
        });
        return { status: 'sent' as const, ...(result.messageId ? { messageId: result.messageId } : {}) };
      },
    });
  }

  #createAnnouncementDispatcher(): AnnouncementDispatcher {
    const options = this.options;
    return new AnnouncementDispatcher({
      announcements: () => options.agent.agent.getAnnouncements?.(),
      controlPlane: () => options.agent.agent.getControlPlane?.(),
      sessions: () => options.agent.agent.getUserProfiles?.()?.sessions,
      decisionEvents: () => options.agent.agent.getDecisionEvents?.(),
      hardGate: () => options.agent.agent.config?.toolHardGate,
      approvals: () => options.agent.agent.toolApprovals,
      onSpoke: (key) => this.#noteSpoke(key),
      sendNotice: async (target, content) => {
        if (target.scope !== 'group') return { status: 'unsupported' as const, code: 'group_notice_requires_group' };
        const endpointKey = target.endpoint ?? this.#soleEndpoint(target.platform);
        if (!endpointKey) return { status: 'failed' as const, code: 'endpoint_unresolved', retryable: false };
        const result = await options.im.endpoints.withManagement(target.platform, endpointKey, async (management) => {
          if (typeof management.sendGroupNotice !== 'function') return 'unsupported' as const;
          await management.sendGroupNotice(target.id, content);
          return 'sent' as const;
        });
        if (result === 'sent') return { status: 'sent' as const };
        if (result === 'unsupported') return { status: 'unsupported' as const, code: 'group_notice_unsupported' };
        return { status: 'failed' as const, code: 'endpoint_unavailable', retryable: false };
      },
    });
  }

  /** 起草时没记 Bot 账号：只在该平台恰好一个在线账号时使用它（多账号时不猜）。 */
  #soleEndpoint(platform: string): string | undefined {
    const online = this.options.im.endpoints.list()
      .filter((endpoint) => (endpoint.adapter === platform || endpoint.endpoint.adapter === platform) && endpoint.status === 'online');
    return online.length === 1 ? online[0]!.name : undefined;
  }

  #createSceneEventIngress(): SceneEventIngress {
    const options = this.options;
    const readOnlyFilesystem = Object.freeze({ workspaceRoot: options.projectRoot, access: 'read-only' as const });
    return new SceneEventIngress({
      projectRoot: options.projectRoot,
      triggerConfig: () => options.agent.service.getTriggerConfig(),
      reader: () => options.im.conversationEventReader,
      sessions: () => options.agent.agent.getUserProfiles?.()?.sessions,
      decisionEvents: () => options.agent.agent.getDecisionEvents?.(),
      controlPlane: () => options.agent.agent.getControlPlane?.(),
      ownsWake: (signal) => this.#memberLifecycle.ownsWake(signal),
      nickname: async (platform, userId) => {
        const record = await options.agent.agent.getUserProfiles?.()?.relations?.get(platform, userId);
        return record?.preferredAddress?.trim() || record?.displayName?.trim() || undefined;
      },
      readConversationContext: (conversation, consumer, through) =>
        options.im.readConversationContext(conversation, consumer, through, 50),
      commitConversationContext: (conversation, consumer, cursor) =>
        options.im.commitConversationContext(conversation, consumer, cursor),
      deliver: (conversation, output) => sendOutputMessages(output, {
        render: messageOutput => flattenOutputElements([...messageOutput]),
        send: async (messageOutput) => {
          // 没有原消息可回应：表情回应类输出直接视为不发。
          if (reactionOf(messageOutput) !== undefined) return { status: 'suppressed' as const };
          const adapter = capabilityLocalName(String(conversation.endpoint.id));
          const content = await publishOutboundElements([...messageOutput], adapter || undefined, undefined, {
            filesystem: readOnlyFilesystem,
            imageAssets: options.agent.service.imageAssets,
          });
          if (content.length === 0) return { status: 'suppressed' as const };
          return deliveryOutcomeFromReceipt(await options.im.send({ conversation, requester: rootPluginId(), content }));
        },
      }),
      executeTurn: (request) => {
        const binding = options.agent.service.getBindingRegistry().requireZhinBinding();
        return options.runtime.execute(
          rootPluginId(),
          request,
          { binding, mcpServers: binding.mcpServers },
          observeAgentTurnTrace(options.agent.traceRuntime, request),
        );
      },
      timeoutMs: () => resolveTriggerTimeoutMs(options.agent.service.getTriggerConfig()),
      onSpoke: (key) => this.#noteSpoke(key),
    });
  }

  #createMemberLifecycle(): MemberLifecycle {
    const options = this.options;
    return new MemberLifecycle({
      sessionOps: () => options.agent.agent.getSessionOps?.(),
      controlPlane: () => options.agent.agent.getControlPlane?.(),
      sessions: () => options.agent.agent.getUserProfiles?.()?.sessions,
      reader: () => options.im.conversationEventReader,
      decisionEvents: () => options.agent.agent.getDecisionEvents?.(),
      send: async (conversation, parts) => {
        const content = parts.map((part) => (part.type === 'text'
          ? { type: 'text', data: { text: part.text } }
          : { type: 'mention', data: { target: part.id, ...(part.name ? { name: part.name } : {}) } }));
        if (content.length === 0) return { status: 'suppressed' as const };
        return deliveryOutcomeFromReceipt(await options.im.send({ conversation, requester: rootPluginId(), content }));
      },
      onSpoke: (key) => this.#noteSpoke(key),
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
    this.#coldField.dispose();
    this.#memberLifecycle.dispose();
    this.#stopAnnouncementSweep();
    this.#stopSessionEvents();
    this.#stopGroupRules();
    this.#groupRuleEnforcer.dispose();
    this.#sceneEvents.dispose();
  }

  /**
   * Same-session admission (#725). Created on first use so it reads the
   * configuration of this generation; one gate per route generation.
   */
  #gate(): TurnAdmissionGate {
    if (!this.#admissionGate) {
      const queue = normalizeInboundQueueConfig(this.options.agent.service.getAgentConfig()?.inboundQueue);
      this.#admissionGate = new TurnAdmissionGate({
        maxQueuedTurns: queue.maxQueuedTurns,
        queueTtlMs: queue.ttlMs,
        supersedeSameSender: queue.groupMode === 'supersede',
        // ADR 0038 §1: group merge window (opt-in in slice A).
        ...(queue.merge.enabled ? { merge: queue.merge } : {}),
      });
    }
    return this.#admissionGate;
  }

  /** Ambient engagement of this generation; null when no group is configured for it. */
  #ambientEngagement(): AmbientEngagement | null {
    if (this.#ambient !== undefined) return this.#ambient;
    const service = this.options.agent.service;
    const config = service.getTriggerConfig()?.ambient;
    if (!config?.conversations?.length) return this.#ambient = null;
    const binding = service.getBindingRegistry().requireZhinBinding();
    const llm = service.getLlmRuntime();
    const configured = (typeof config.judge === 'string' ? [config.judge] : config.judge ?? [])
      .map(entry => entry.trim()).filter(Boolean);
    const judgeFor = (entry: string): LlmEngagementJudge | undefined => {
      const [alias, ...model] = entry.split('/');
      try {
        return new LlmEngagementJudge(llm, llm.model(alias!, model.join('/')));
      } catch (error) {
        // An unknown provider or model must not break every group message; skip that judge.
        logger.warn(formatCompact({ op: 'ambient_judge_unavailable', judge: entry, error: error instanceof Error ? error.message : String(error) }));
        return undefined;
      }
    };
    let judges = configured.map(judgeFor).filter(judge => judge !== undefined);
    if (judges.length === 0) {
      const fallback = judgeFor(`${binding.providerAlias}/${binding.model}`);
      if (!fallback) return this.#ambient = null;
      judges = [fallback];
    }
    this.#ambientLlmJudge = judges.length === 1 ? judges[0]! : new FallbackEngagementJudge(judges);
    return this.#ambient = new AmbientEngagement({ config, judge: this.#ambientLlmJudge });
  }

  /**
   * `ai.decisions.ambient` of the held generation. active: the DecisionProvider judges first and the
   * chat-model judges take over when it fails; shadow: the chat-model judges decide and the provider
   * is only logged. Undefined (configured chat-model judges only) when off, unset or unavailable.
   */
  #ambientDecisionRoute(snapshot: RuntimeSnapshot, key: string): EngagementJudge | undefined {
    const base = this.#ambientLlmJudge;
    if (!base) return undefined;
    let runtime: AgentDecisionRuntime | undefined;
    try {
      runtime = resolveAgentDecisionRuntime(snapshot);
    } catch (error) {
      // A missing provider must not silence ambient engagement; the chat-model judges still work.
      logger.debug(formatCompact({ op: 'ambient_decision_unavailable', error: error instanceof Error ? error.message : String(error) }));
      return undefined;
    }
    const policy = runtime?.config.ambient;
    if (!runtime || !policy || policy.mode === 'off') return undefined;
    const cached = this.#ambientDecisionJudges.get(key);
    if (cached?.provider === runtime.provider && cached.policy === policy) return cached.judge;
    let judge: EngagementJudge | undefined;
    try {
      judge = createAmbientDecisionJudge({
        base,
        provider: runtime.provider,
        policy,
        observe: (observation) => {
          logAmbientDecisionObservation(observation);
          this.options.assistantStatus?.recordDecision(observation);
        },
        reportShadow: (decision, primary) => {
          this.options.assistantStatus?.recordAmbientShadow(decision?.engage, primary?.engage);
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
    } catch (error) {
      logger.warn(formatCompact({ op: 'ambient_decision_unavailable', error: error instanceof Error ? error.message : String(error) }));
      return undefined;
    }
    if (!judge) return undefined;
    this.#ambientDecisionJudges.set(key, { provider: runtime.provider, policy, judge });
    return judge;
  }

  /** For a group message nobody addressed: wait for the burst, throttle, then let the judge decide. */
  async #considerAmbient(
    snapshot: RuntimeSnapshot,
    message: Message,
    conversationSequence: number | undefined,
    platform: string,
    botName: string,
    audit: DecisionAudit = NO_DECISION_AUDIT,
  ): Promise<{ content: string } | null> {
    if (message.conversation.kind !== 'group' || conversationSequence === undefined) return null;
    const text = message.content.trim();
    const trigger = this.options.agent.service.getTriggerConfig();
    if (!text || trigger?.enabled === false || hasIgnoredTriggerPrefix(text, trigger)) return null;
    const engagement = this.#ambientEngagement();
    if (!engagement?.enabledFor(platform, message.conversation.id)) return null;
    const key = `${platform}:${message.conversation.id}`;
    const judge = this.#ambientDecisionRoute(snapshot, key);
    const decision = await engagement.consider({
      key,
      botName,
      ...(judge ? { judge } : {}),
      readRecent: async () => (await this.options.im.readConversationContext(
        message.conversation,
        AMBIENT_CONTEXT_CONSUMER,
        conversationSequence,
        AMBIENT_CONTEXT_MESSAGES,
      )).blocks.map(block => block.text),
    });
    this.options.assistantStatus?.recordAmbient(key, decision);
    auditAmbientDecision(audit, decision);
    // 冷场（ADR 0037 §1.3）：旁听参与清零；判定为不参与（declined / shadow / skipped）计 1。
    if (decision.kind === 'engage') this.#coldField.reset(key);
    else this.#coldField.noteNotEngaged({ platform, conversationId: message.conversation.id });
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

      const ownerId = resolveOwnerForRuntimeMessage(message, options.resolveEndpointOwner);
      const endpointTrusted = resolveTrustedForRuntimeMessage(message, options.resolveEndpointTrusted);
      const senderRoles = resolveRuntimeSenderRoles(message, ownerId, endpointTrusted, trigger);
      const turnAccess = createRuntimeTurnAccess(message, senderRoles);
      const sessionKey = workroomAgentTurn
        ? workroomOrchestratorSessionKey(workroomAgentTurn)
        : runtimeImSessionKey(turnAccess);
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

      // Agent 管理命令（/models /tree /reset…）— 在 AI trigger 前拦截
      const managementReply = workroomAgentTurn
        ? null
        : await handleRuntimeManagementCommand({
            service,
            zhinAgent,
            sessionKey,
            content: message.content,
            commandPrefix: message.commandPrefix,
            locale: message.locale,
            senderRoles,
            semanticMemory: options.agent.semanticMemory,
            senderId: turnAccess.principal.subjectId,
          });
      if (managementReply != null) {
        await reply(managementReply);
        logger.info(formatCompact({ op: 'agent_host_management', handled: true }));
        return true;
      }

      // ADR 0039 slice B: `rule approve|reject|disable <code>` / `rules` in the rule's own group.
      const groupRuleReply = !workroomAgentTurn && turnAccess.origin.kind === 'im'
        ? await this.#groupRules.handleCommand({
            platform: turnAccess.origin.platform,
            scope: turnAccess.origin.scope,
            sceneId: turnAccess.origin.sceneId,
            senderId: turnAccess.principal.subjectId,
            senderRoles: message.sender?.roles,
            endpoint: effectiveEndpoint,
            commandText: managementCommandText(message.content, message.commandPrefix),
          })
        : null;
      if (groupRuleReply != null) {
        await reply(groupRuleReply);
        logger.info(formatCompact({ op: 'agent_host_group_rule', handled: true }));
        return true;
      }

      // G6 (#1013): hard-gate cards (`approve tap_…` / `deny tap_…`) before the owner `/approve` commands.
      const toolApprovalReply = !workroomAgentTurn && turnAccess.origin.kind === 'im'
        ? options.toolApprovalIm?.handleCommand({
            platform: turnAccess.origin.platform,
            scope: turnAccess.origin.scope,
            sceneId: turnAccess.origin.sceneId,
            senderId: turnAccess.principal.subjectId,
            commandText: managementCommandText(message.content, message.commandPrefix),
          }) ?? null
        : null;
      if (toolApprovalReply != null) {
        await reply(toolApprovalReply);
        logger.info(formatCompact({ op: 'agent_host_tool_approval_im', handled: true }));
        return true;
      }

      const approveReply = !workroomAgentTurn && /^approve(?:\s|$)/iu.test(managementCommandText(message.content, message.commandPrefix) ?? '')
        ? zhinAgent.ownerApprovals.handleCommand(
            {
              platform: turnAccess.origin.kind === 'im' ? turnAccess.origin.platform : '',
              endpoint: turnAccess.origin.kind === 'im' ? turnAccess.origin.endpoint : '',
              ownerId,
              subjectId: turnAccess.principal.subjectId,
              scope: turnAccess.origin.kind === 'im' ? turnAccess.origin.scope : 'private',
              locale: message.locale,
              commandPrefix: message.commandPrefix,
            },
            message.content,
          )
        : null;
      if (approveReply != null) {
        await reply(approveReply);
        logger.info(formatCompact({ op: 'agent_host_approve', handled: true }));
        return true;
      }

      // #732: /tasks, /task stop|redirect — only when a detached-task runner is provided.
      const detachedTasks = workroomAgentTurn ? undefined : resolveSnapshotDetachedTaskRunner(snapshot, requester) ?? options.detachedTasks;
      const taskActor = { sessionId: sessionKey, senderId: turnAccess.principal.subjectId, isMaster: senderRoles.isMaster };
      if (detachedTasks) {
        const taskReply = await handleDetachedTaskCommand(detachedTasks, taskActor, message.content, { locale: message.locale, commandPrefix: message.commandPrefix });
        if (taskReply != null) {
          await reply(taskReply);
          logger.info(formatCompact({ op: 'agent_host_task_command', handled: true }));
          return true;
        }
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
      if (!matched) {
        matched = workroomAgentTurn ? null : await this.#considerAmbient(
          snapshot,
          message,
          conversationSequence,
          platform,
          binding.nickname?.trim() || 'Zhin',
          audit,
        );
        if (!matched) return false;
        ambient = true;
      } else if (ambientKey) {
        this.#ambientEngagement()?.noteSpoke(ambientKey);
      }
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
          throughSequence: conversationSequence,
          selfIds: [effectiveEndpoint, message.metadata?.selfId, message.metadata?.self_id]
            .filter((value): value is string | number => (typeof value === 'string' && value !== '') || typeof value === 'number')
            .map(String),
        })
        : [];

      // #732: a message in a session with an active background task may stop
      // or redirect it; anything else continues as an ordinary new turn.
      if (detachedTasks) {
        // Reuse the product TurnIntentResolver (or trusted metadata) when present.
        const taskIntentResolver = resolveSnapshotTurnIntentResolver(snapshot, requester) ?? options.resolveTurnIntent;
        const productIntent = taskIntentResolver || message.metadata?.turnIntent !== undefined
          ? (await resolveProductTurnIntent(message, senderRoles, undefined, taskIntentResolver).catch(() => undefined))?.kind
          : undefined;
        const routedTask = await routeTaskInterjection(detachedTasks, taskActor, matched.content, productIntent, { locale: message.locale });
        if (routedTask.handled) {
          if (routedTask.reply) await reply(routedTask.reply);
          logger.info(formatCompact({ op: 'agent_host_task_interjection', kind: routedTask.kind, task: routedTask.taskId }));
          return true;
        }
      }

      if (!workroomAgentTurn && isClearCommand(matched.content)) {
        await zhinAgent.archiveSession(sessionKey);
        await reply(t(message.locale, 'cleared'));
        return true;
      }

      // #725: ordinary IM turns go through the admission gate. Workroom turns
      // and products that resolve their own turn intent keep their semantics.
      const intentResolver = resolveSnapshotTurnIntentResolver(snapshot, requester) ?? options.resolveTurnIntent;
      const gate = workroomAgentTurn || intentResolver || message.metadata?.turnIntent !== undefined
        ? undefined
        : this.#gate();
      const senderId = turnAccess.principal.subjectId;
      if (gate && isCancelIntent(matched.content)) {
        const stopped = gate.stop(sessionKey, senderId, senderRoles.isMaster);
        if (stopped === 'stopped') {
          await reply(t(message.locale, 'stopped'));
          logger.info(formatCompact({ op: 'agent_host_turn_stopped', sessionKey }));
          return true;
        }
        // Nothing of the sender's to stop: handle it as an ordinary message.
      }

      let capabilityActive = true;
      /** 进入模型回合的时刻；未进入时为 undefined（审计只为真正跑过的模型写 `model_run`）。 */
      let modelStartedAt: number | undefined;
      let spoke = false;
      const modelPayload = (): Record<string, unknown> => ({
        model: binding.model,
        provider: binding.providerAlias,
        ambient,
        spoke,
        ...(modelStartedAt !== undefined ? { durationMs: Date.now() - modelStartedAt } : {}),
      });
      let admission: Extract<TurnAdmission, { kind: 'run' }> | undefined;
      try {
        const preprocessed = await preprocessInboundTurn(
          message,
          matched.content,
          options.transcribeUrl,
        );
        let inbound = preprocessed;
        if (gate) {
          const plainText = isPlainTextRuntimeMessage(message);
          const admitted = await gate.admit({
            sessionKey,
            senderId,
            text: preprocessed.text,
            plainText,
            mergeable: isMergeableGroupTurn({
              message,
              trigger,
              plainText,
              isMaster: senderRoles.isMaster,
              content: matched.content,
            }),
            ...(message.sender?.name ? { senderName: message.sender.name } : {}),
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
        // ADR 0038 §2: a merged turn may only do what every member may do.
        const members = admission && admission.participants.length > 1
          ? mergedMemberAccess(admission.participants, turnAccess)
          : undefined;
        const read = await readTurnCapabilities(
          ingress,
          snapshot,
          requester,
          turnAccess,
          members,
          () => capabilityActive,
        );
        const turnAccessForTurn = members
          ? withMergeMembers(narrowMergedAccess(turnAccess, members), read.members, read.memberTools)
          : turnAccess;
        const capabilities = restrictWorkroomAgentCapabilities(read.capabilities, workroomAgentTurn != null);
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
        if (trigger.thinkingMessage && !ambient && !outboundBlocked('thinking')) {
          message.$reply(trigger.thinkingMessage).catch((error: unknown) => {
            logger.debug(formatCompact({
              op: 'agent_host_thinking_reply_failed',
              error: error instanceof Error ? error.message : String(error),
            }));
          });
        }

        const traceId = randomUUID();
        modelStartedAt = Date.now();
        const outcome = await withTriggerTimeout(
          async (signal) => runWithAgentDecisionTurn(snapshot, turnId, async decisionRuntime => {
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
                  provider: decisionRuntime.provider,
                  policy: approvalPolicy,
                  baseline: options.agent.approvalJudgment,
                  observe: decisionRuntime.observe,
                  intent: routed.userText,
                  principal: turnAccessForTurn.principal,
                })
              : undefined;
            const turnPolicy = resolveSandboxTurnPolicy({
              platform: turnAccess.origin.kind === 'im' ? turnAccess.origin.platform : '',
              isMaster: senderRoles.isMaster,
              scope: turnAccess.origin.kind === 'im' ? turnAccess.origin.scope : undefined,
              masterShell: service.getAgentConfig()?.masterShell,
              metadata: message.metadata,
              projectRoot: options.projectRoot,
              defaultNetwork: interactiveNetworkPolicy(service.getAgentConfig()),
            });
            const approvalInteraction = ownerId
              ? options.im.createInteraction(message, { subjectId: ownerId })
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
            const request = createRuntimeTurnRequest(message, routed.userText, senderRoles, {
              ...(members ? { access: turnAccessForTurn } : {}),
              traceId,
              turnId,
              signal: admission ? AbortSignal.any([signal, admission.signal]) : signal,
              workspaceRoot: turnPolicy.filesystem.workspaceRoot,
              workingDirectory: turnPolicy.filesystem.workingDirectory,
              filesystemAccess: turnPolicy.filesystem.access,
              shell: turnPolicy.shell,
              network: turnPolicy.network,
              sessionKey,
              ...(sceneEvents.length ? { sceneEvents } : {}),
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
                approval: options.approvalPort ?? resolveApprovalPort({
                  mode: turnPolicy.shell?.approvalMode
                    ?? service.getAgentConfig()?.execApprovalMode
                    ?? 'auto',
                  auto: createAutoApprovalPort(
                    options.agent.approvalReviewer,
                    escalatedApprovalPort,
                    approvalJudgment,
                  ),
                  ask: askApprovalPort,
                }),
                question: createRuntimeQuestionPort(options.im, message),
                reply: {
                  // Message segments follow the target scene; reactions additionally need the original message.
                  segments: workroomReplyConversation || !message.message
                    ? { ...replySegments, reaction: undefined }
                    : replySegments,
                  send: async (output) => {
                    logger.debug(formatCompact({
                      op: 'replychain_port_send',
                      outputElements: output.length,
                      outputPreview: flattenOutputElements(output).trim() || '(empty)',
                    }));
                    const outcome = await sendOutputMessages(output, {
                      render: messageOutput => flattenOutputElements([...messageOutput]),
                      send: async (messageOutput) => {
                        if (outboundBlocked('reply')) {
                          auditOutbound(audit, { status: 'suppressed' }, { control: true });
                          return { status: 'suppressed' as const };
                        }
                        const reaction = reactionOf(messageOutput);
                        if (reaction !== undefined) {
                          // A gesture, not a message: best effort, and it counts as having answered.
                          const applied = message.message
                            ? await options.im.endpoints.addReaction({
                                adapter: effectiveAdapter,
                                endpointKey: effectiveEndpoint,
                                message: message.message,
                                emoji: reaction,
                              }).catch((error: unknown) => {
                                logger.debug(formatCompact({ op: 'agent_reaction_failed', error: error instanceof Error ? error.message : String(error) }));
                                return null;
                              })
                            : null;
                          logger.debug(formatCompact({ op: 'agent_reaction', emoji: reaction, applied: applied !== null }));
                          admission?.markDelivered();
                          spoke = true;
                          auditOutbound(audit, { status: 'sent' }, { reaction: true, applied: applied !== null });
                          return { status: 'sent' as const };
                        }
                        // Model output may name local files or URLs: hold them to this Turn's own authority.
                        const content = await publishOutboundElements([...messageOutput], effectiveAdapter || undefined, undefined, {
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
                          sent = deliveryOutcomeFromReceipt(await reply(content));
                        } catch (error) {
                          auditOutbound(audit, { status: 'failed', code: error instanceof Error ? error.message : String(error), retryable: false });
                          throw error;
                        }
                        auditOutbound(audit, sent, { segments: content.length });
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
            return options.runtime.executeLeased(
              lease,
              requester,
              request,
              {
                binding,
                mcpServers: binding.mcpServers,
                agent: routed.agent?.qualifiedName ?? routed.agent?.name,
              },
              observeWithAdmission(observeAgentTurnTrace(traceRuntime, request), turnId, admission),
            );
          }, {
            disabled: workroomAgentTurn != null,
            observe: observation => {
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
          }),
          resolveTriggerTimeoutMs(trigger),
        );
        auditModelRun(audit, outcome, { ...modelPayload(), agent: routed.agent?.name ?? null });
        const elements = completedOutput(outcome);
        const outputText = flattenOutputElements(elements).trim();
        if (!outputText) {
          // spawn_task 等委派回合 finalReply 为空：用户可见文案由 subagent auto-continue
          // + proactive 出站；勿把 '(empty AI response)' 当成正文发给用户。
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
          model: binding.model,
          provider: binding.providerAlias,
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
        admission?.release();
      }
  }
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

/** The emoji of a reaction-only message from the structured reply, if this message is one. */
export function reactionOf(output: readonly AgentOutputElement[]): string | undefined {
  if (output.length !== 1) return undefined;
  const element = output[0]!;
  if (element.type !== 'message' || element.segments.length !== 1) return undefined;
  const segment = element.segments[0]!;
  if (segment.type !== REACTION_SEGMENT_TYPE) return undefined;
  const emoji = (segment.data as { emoji?: unknown }).emoji;
  return typeof emoji === 'string' && emoji ? emoji : undefined;
}

function admissionRejectionNotice(reason: 'queue_full' | 'expired' | 'stopped', locale?: Locale): string | undefined {
  if (reason !== 'stopped') return t(locale, reason);
  return undefined;
}

/** Records how the turn was admitted on its TurnTrace once the trace exists. */
function observeWithAdmission(
  observe: ReturnType<typeof observeAgentTurnTrace>,
  turnId: string,
  admission: Extract<TurnAdmission, { kind: 'run' }> | undefined,
): ReturnType<typeof observeAgentTurnTrace> {
  const facts = admission?.facts;
  if (!facts || (facts.queuedMs === 0 && facts.mergedMessages <= 1 && !facts.supersededPrevious)) return observe;
  let noted = false;
  return (event) => {
    if (!noted) {
      noted = true;
      noteTurnTrace(turnId, {
        kind: 'admission',
        queued_ms: facts.queuedMs,
        merged_messages: facts.mergedMessages,
        superseded_previous: facts.supersededPrevious,
        ...(facts.mergeWindow ? { merged_senders: facts.mergeWindow.senders.length } : {}),
      });
    }
    observe(event);
  };
}

/** Semantic selection only fills the gap left by explicit and platform routing. */
export async function selectDecisionAgentRoute(input: Readonly<{
  routed: ReturnType<typeof routeSpecialistAgent>;
  capabilities: Pick<AgentCapabilities, 'agents'>;
  decisionRuntime?: AgentDecisionRuntime;
  workroomTurn: boolean;
  signal: AbortSignal;
}>): Promise<ReturnType<typeof routeSpecialistAgent>> {
  if (input.routed.agent || input.workroomTurn || /^@[^\s:：]+/u.test(input.routed.userText)) {
    return input.routed;
  }
  const ranking = await rankDecisionCandidates(
    input.decisionRuntime,
    'agents',
    input.routed.userText,
    input.capabilities.agents.map(agent => ({
      name: agent.qualifiedName,
      description: agent.description,
    })),
    input.signal,
  );
  if (!ranking.applied || ranking.selectedNames.length === 0) return input.routed;
  const agent = input.capabilities.agents.find(candidate => candidate.qualifiedName === ranking.selectedNames[0]);
  return agent ? { ...input.routed, agent } : input.routed;
}

function resolveApprovalPort(input: Readonly<{
  mode: 'ask' | 'auto' | 'bypass';
  ask: ApprovalPort;
  auto: ApprovalPort;
}>): ApprovalPort {
  if (input.mode === 'auto') return input.auto;
  if (input.mode === 'bypass') return createBypassApprovalPort(input.ask);
  return input.ask;
}

async function readTurnCapabilities(
  ingress: CapabilityIngress,
  snapshot: RuntimeSnapshot,
  requester: PluginId,
  carrier: TurnAccessContext,
  members: readonly TurnAccessContext[] | undefined,
  isActive: () => boolean,
): Promise<Readonly<{
  capabilities: AgentCapabilities;
  /** Merged turn only: every member (carrier first) and the Tool names each sees alone. */
  members: readonly TurnAccessContext[];
  memberTools: readonly (readonly string[])[];
}>> {
  const own = await ingress.read(snapshot, requester, isActive, carrier);
  if (!members) return { capabilities: own, members: [], memberTools: [] };
  const others = members.filter((member) => member !== carrier);
  const reads = await Promise.all(others.map((member) => ingress.read(snapshot, requester, isActive, member)));
  return {
    capabilities: intersectCapabilities(own, reads),
    members: [carrier, ...others],
    memberTools: [own, ...reads].map((read) => read.tools.map((tool) => tool.name)),
  };
}

/**
 * Every member's own access (ADR 0038 §2). A participant admitted without one
 * cannot be checked, so the turn falls back to the anonymous `user` floor:
 * nothing beyond what an unknown group member could use.
 */
export function mergedMemberAccess(
  participants: readonly Readonly<{ senderId: string; access?: TurnAccessContext }>[],
  carrier: TurnAccessContext,
): readonly TurnAccessContext[] {
  return participants.map((participant) => participant.access ?? anonymousMemberAccess(carrier, participant.senderId));
}

function anonymousMemberAccess(carrier: TurnAccessContext, senderId: string): TurnAccessContext {
  return Object.freeze({
    ...carrier,
    principal: Object.freeze({ subjectId: senderId, roles: Object.freeze(['user']) }),
    policy: Object.freeze({ ...carrier.policy, permissions: Object.freeze(['user']) }),
  });
}

export function resolveSnapshotDetachedTaskRunner(
  snapshot: Pick<RuntimeSnapshot, 'resources'>,
  requester: PluginId,
): DetachedTaskRunner | undefined {
  const candidate = snapshot.resources.get(requester)?.get(detachedTaskRunnerToken.id);
  return candidate && typeof (candidate as DetachedTaskRunner).steer === 'function'
    ? candidate as DetachedTaskRunner
    : undefined;
}
