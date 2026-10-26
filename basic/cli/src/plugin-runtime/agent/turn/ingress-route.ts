import { randomUUID } from 'node:crypto';
import {
  createAutoApprovalPort,
  createBypassApprovalPort,
  detachedTaskRunnerToken,
  handleDetachedTaskCommand,
  handleRuntimeManagementCommand,
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
  isCancelIntent,
  normalizeInboundQueueConfig,
  TurnAdmissionGate,
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
  type SendContent,
} from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { sendOutputMessages } from './reply-messages.js';
import {
  rootPluginId,
  type CapabilityId,
  type PluginId,
  type RuntimeSnapshot,
  type SnapshotLease,
} from '@zhin.js/plugin-runtime';
import { observeAgentTurnTrace } from '../runtime-factory.js';
import type { AgentRuntimeFoundation } from '../runtime-foundation.js';
import {
  completedOutput,
  flattenOutputElements,
  isClearCommand,
  preprocessInboundTurn,
} from './content.js';
import {
  hasIgnoredTriggerPrefix,
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
  type RuntimeSenderRoles,
} from './request.js';
import { NO_WORKROOM_PORT, type AgentWorkroomPort } from '../workroom-port.js';
import { AMBIENT_ENGAGEMENT_METADATA_KEY } from '@zhin.js/agent/context';
import {
  AmbientEngagement,
  createAmbientDecisionJudge,
  FallbackEngagementJudge,
  LlmEngagementJudge,
  type EngagementJudge,
} from './ambient-engagement.js';
import { resolveSandboxTurnPolicy } from './sandbox-policy.js';
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

  constructor(private readonly options: AgentTurnIngressRouteOptions) {
    this.workroomPort = options.workroom ?? NO_WORKROOM_PORT;
    options.assistantStatus?.bindAmbientConfig(() => options.agent.service.getTriggerConfig()?.ambient);
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
            senderRoles,
            semanticMemory: options.agent.semanticMemory,
            senderId: turnAccess.principal.subjectId,
          });
      if (managementReply != null) {
        await reply(managementReply);
        logger.info(formatCompact({ op: 'agent_host_management', handled: true }));
        return true;
      }

      const approveReply = !workroomAgentTurn && /^\/approve(?:\s|$)/iu.test(message.content.trim())
        ? zhinAgent.ownerApprovals.handleCommand(
            {
              platform: turnAccess.origin.kind === 'im' ? turnAccess.origin.platform : '',
              endpoint: turnAccess.origin.kind === 'im' ? turnAccess.origin.endpoint : '',
              ownerId,
              subjectId: turnAccess.principal.subjectId,
              scope: turnAccess.origin.kind === 'im' ? turnAccess.origin.scope : 'private',
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
        const taskReply = await handleDetachedTaskCommand(detachedTasks, taskActor, message.content);
        if (taskReply != null) {
          await reply(taskReply);
          logger.info(formatCompact({ op: 'agent_host_task_command', handled: true }));
          return true;
        }
      }

      const platform = turnAccess.origin.kind === 'im' ? turnAccess.origin.platform : '';
      const ambientKey = message.conversation.kind === 'group' ? `${platform}:${message.conversation.id}` : undefined;
      let ambient = false;
      if (!matched) {
        matched = workroomAgentTurn ? null : await this.#considerAmbient(
          snapshot,
          message,
          conversationSequence,
          platform,
          binding.nickname?.trim() || 'Zhin',
        );
        if (!matched) return false;
        ambient = true;
      } else if (ambientKey) {
        this.#ambientEngagement()?.noteSpoke(ambientKey);
      }

      // #732: a message in a session with an active background task may stop
      // or redirect it; anything else continues as an ordinary new turn.
      if (detachedTasks) {
        // Reuse the product TurnIntentResolver (or trusted metadata) when present.
        const taskIntentResolver = resolveSnapshotTurnIntentResolver(snapshot, requester) ?? options.resolveTurnIntent;
        const productIntent = taskIntentResolver || message.metadata?.turnIntent !== undefined
          ? (await resolveProductTurnIntent(message, senderRoles, undefined, taskIntentResolver).catch(() => undefined))?.kind
          : undefined;
        const routedTask = await routeTaskInterjection(detachedTasks, taskActor, matched.content, productIntent);
        if (routedTask.handled) {
          if (routedTask.reply) await reply(routedTask.reply);
          logger.info(formatCompact({ op: 'agent_host_task_interjection', kind: routedTask.kind, task: routedTask.taskId }));
          return true;
        }
      }

      if (!workroomAgentTurn && isClearCommand(matched.content)) {
        await zhinAgent.archiveSession(sessionKey);
        await reply('已清空本会话的 AI 多轮上下文。');
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
          await reply('好的，已停止当前回复。');
          logger.info(formatCompact({ op: 'agent_host_turn_stopped', sessionKey }));
          return true;
        }
        // Nothing of the sender's to stop: handle it as an ordinary message.
      }

      let capabilityActive = true;
      let admission: Extract<TurnAdmission, { kind: 'run' }> | undefined;
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
            plainText: isPlainTextRuntimeMessage(message),
          });
          if (admitted.kind === 'merged') {
            logger.debug(formatCompact({ op: 'agent_host_turn_merged', sessionKey }));
            return true;
          }
          if (admitted.kind === 'rejected') {
            logger.info(formatCompact({ op: 'agent_host_turn_rejected', sessionKey, reason: admitted.reason }));
            const notice = admissionRejectionNotice(admitted.reason);
            if (notice) await reply(notice);
            return true;
          }
          admission = admitted;
          inbound = { ...preprocessed, text: admitted.text };
        }
        const capabilities = restrictWorkroomAgentCapabilities(await readCapabilities(
          ingress,
          snapshot,
          requester,
          message,
          senderRoles,
          () => capabilityActive,
        ), workroomAgentTurn != null);
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
        if (trigger.thinkingMessage && !ambient) {
          message.$reply(trigger.thinkingMessage).catch((error: unknown) => {
            logger.debug(formatCompact({
              op: 'agent_host_thinking_reply_failed',
              error: error instanceof Error ? error.message : String(error),
            }));
          });
        }

        const traceId = randomUUID();
        const turnId = randomUUID();
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
                  principal: turnAccess.principal,
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
              // Sandbox `ask` must be a real interaction, even though the
              // authenticated Console user maps to the endpoint owner.
              isMaster: senderRoles.isMaster && turnPolicy.shell?.approvalMode !== 'ask',
              interaction: approvalInteraction,
              memory: options.agent.approvalReviewer,
            });
            const escalatedApprovalPort = createRuntimeApprovalPort({
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
              traceId,
              turnId,
              signal: admission ? AbortSignal.any([signal, admission.signal]) : signal,
              workspaceRoot: turnPolicy.filesystem.workspaceRoot,
              workingDirectory: turnPolicy.filesystem.workingDirectory,
              filesystemAccess: turnPolicy.filesystem.access,
              shell: turnPolicy.shell,
              network: turnPolicy.network,
              sessionKey,
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
                          return { status: 'sent' as const };
                        }
                        // Model output may name local files or URLs: hold them to this Turn's own authority.
                        const content = await publishOutboundElements([...messageOutput], effectiveAdapter || undefined, undefined, {
                          filesystem: turnPolicy.filesystem,
                          ...(turnPolicy.network ? { network: turnPolicy.network } : {}),
                        });
                        logger.debug(formatCompact({
                          op: 'replychain_publish_outbound',
                          segments: content.length,
                        }));
                        if (content.length === 0) return { status: 'suppressed' as const };
                        const sent = deliveryOutcomeFromReceipt(await reply(content));
                        if (sent.status === 'sent') admission?.markDelivered();
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
          logger.debug(formatCompact({ op: 'agent_host_turn_replaced', sessionKey }));
          return true;
        }
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn(formatCompact({ op: 'agent_host_turn_fail', error: detail }));
        try {
          const line = renderChatTurnError(trigger, error, senderRoles.isMaster);
          if (line) await reply(line);
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

function admissionRejectionNotice(reason: 'queue_full' | 'expired' | 'stopped'): string | undefined {
  if (reason === 'queue_full') return '前面还有几条消息在处理，请稍后再发。';
  if (reason === 'expired') return '这条消息排队太久，已跳过，需要的话请重新发送。';
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

async function readCapabilities(
  ingress: CapabilityIngress,
  snapshot: RuntimeSnapshot,
  requester: PluginId,
  message: Message,
  roles: RuntimeSenderRoles,
  isActive: () => boolean,
): Promise<AgentCapabilities> {
  return ingress.read(snapshot, requester, isActive, createRuntimeTurnAccess(message, roles));
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
