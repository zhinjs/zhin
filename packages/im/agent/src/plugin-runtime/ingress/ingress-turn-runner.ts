import { randomUUID } from 'node:crypto';
import type { AITriggerConfig, VenueRouteResult, readOperationSession } from '@zhin.js/core';
import type {
  CapturedEndpointOperation,
  ImRuntime,
  Message,
  SendContent,
} from '@zhin.js/core/runtime';
import type { InferenceOperationScope } from '@zhin.js/ai/provider';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { PluginId, RuntimeSnapshot, SnapshotLease } from '@zhin.js/plugin-runtime';
import { createAutoApprovalPort } from '../../session/approval-review-agent.js';
import type { ApprovalPort } from '../../session/approval-port.js';
import type { TurnAccessContext, TurnOutcome } from '../../turn/turn-ingress.js';
import { DecisionApprovalJudgment } from '../../session/index.js';
import {
  narrowMergedAccess,
  readOnlyCapabilities,
  withMergeMembers,
  type TurnAdmission,
  type TurnLiveDanmaku,
} from '../../turn/index.js';
import type { HostMailbox } from '../../collaboration/host-mailbox.js';
import { runInMailTurn } from '../../collaboration/mail-turn-context.js';
import { AMBIENT_ENGAGEMENT_METADATA_KEY } from '../../context/index.js';
import { runWithAgentDecisionTurn } from '../decision-runtime.js';
import type { AgentRuntime } from '../agent-runtime.js';
import type { CapabilityIngress } from '../capability-ingress.js';
import type { TurnIntentResolver } from '../turn-intent-resolver.js';
import type { preprocessInboundTurn } from './content.js';
import type { DecisionAudit } from './decision-audit.js';
import {
  NO_APPROVAL_PORT,
  observeWithAdmission,
  resolveApprovalPort,
} from './ingress-delivery-helpers.js';
import {
  admitIngressMailTurn,
  createIngressReplyPort,
  finalizeIngressTurnSuccess,
  handleIngressTurnFailure,
} from './ingress-outbound.js';
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
} from './ports.js';
import type { ReactionPacer } from './reaction-pacer.js';
import {
  createRuntimeApprovalPort,
  createRuntimeQuestionPort,
  createRuntimeTurnAccess,
  createRuntimeTurnRequest,
  interactiveNetworkPolicy,
  resolveProductTurnIntent,
  resolveRuntimeTurnCapabilities,
  resolveRuntimeTurnContextState,
  resolveSandboxTurnPolicy,
  runtimePersonalSessionAddress,
  type RuntimeSenderRoles,
} from './request.js';
import type { SceneFactRefresher } from './scene-fact-refresher.js';
import {
  resolveTriggerTimeoutMs,
  routeSpecialistAgent,
  withTriggerTimeout,
} from './unified-mailbox-spine.js';

export {
  admitIngressMailTurn,
  createIngressReplyPort,
  finalizeIngressTurnSuccess,
  handleIngressTurnFailure,
};

type OperationSession = ReturnType<typeof readOperationSession>;
type PreprocessedInbound = Awaited<ReturnType<typeof preprocessInboundTurn>>;
type TurnCapabilities = Awaited<ReturnType<typeof readTurnCapabilities>>['capabilities'];

const logger = getLogger('agent');

export interface IngressTurnExecutionHooks {
  setProfileOperation(op: CapturedEndpointOperation | undefined): void;
  setModelStartedAt(timestamp: number): void;
  markSpoke(): void;
  isCapabilityActive(): boolean;
  staleReplyBlocked(): boolean;
  outboundBlocked(stage: string): boolean;
}

export interface ExecuteAdmittedMailTurnInput {
  readonly message: Message;
  readonly lease: SnapshotLease;
  readonly snapshot: RuntimeSnapshot;
  readonly requester: PluginId;
  readonly operationSession: OperationSession;
  readonly operationSignal: AbortSignal | undefined;
  readonly turnId: string;
  readonly sessionKey: string;
  readonly senderId: string;
  readonly senderRoles: RuntimeSenderRoles;
  readonly ownerId: string | undefined;
  readonly effectiveAdapter: string;
  readonly turnAccess: TurnAccessContext;
  readonly conversationSequence: number | undefined;
  readonly sceneEvents: readonly string[];
  readonly inbound: PreprocessedInbound;
  readonly liveRoom: boolean;
  readonly ambient: boolean;
  readonly sceneMerge: boolean;
  readonly gate: HostMailbox | undefined;
  readonly mailbox: HostMailbox;
  readonly admission: Extract<TurnAdmission, { kind: 'run' }>;
  readonly venueRoute: VenueRouteResult | undefined;
  readonly trigger: AITriggerConfig | undefined;
  readonly projectRoot: string;
  readonly im: ImRuntime;
  readonly runtime: AgentRuntime;
  readonly ingress: CapabilityIngress;
  readonly agent: AgentIngressFoundationPort;
  readonly approvalPort: ApprovalPort | undefined;
  readonly assistantStatus: AgentAssistantStatusPort | undefined;
  readonly intentResolver: TurnIntentResolver | undefined;
  readonly sceneFactRefresher: SceneFactRefresher;
  readonly reactionPacer: ReactionPacer;
  readonly audit: DecisionAudit;
  readonly reply: (content: SendContent) => Promise<Awaited<ReturnType<Message['$reply']>>>;
  readonly withInference: <T>(
    inferInput: Readonly<{ lease: SnapshotLease; sessionKey: string; operationId?: string; signal: AbortSignal }>,
    run: (scope: InferenceOperationScope) => Promise<T>,
  ) => Promise<T>;
  readonly hooks: IngressTurnExecutionHooks;
}

/**
 * Executes an admitted Mail turn inside `runInMailTurn` and `withTriggerTimeout`,
 * wiring capability discovery, decision routing, sandbox policy, and outbound reply ports.
 */
export async function executeAdmittedMailTurn(input: ExecuteAdmittedMailTurnInput): Promise<{
  readonly outcome: TurnOutcome;
  readonly capabilities: TurnCapabilities;
  readonly routed: ReturnType<typeof routeSpecialistAgent>;
}> {
  const {
    message,
    lease,
    snapshot,
    requester,
    operationSession,
    operationSignal,
    turnId,
    sessionKey,
    senderId,
    senderRoles,
    ownerId,
    effectiveAdapter,
    turnAccess,
    conversationSequence,
    sceneEvents,
    inbound,
    liveRoom,
    ambient,
    sceneMerge,
    gate,
    mailbox,
    admission,
    venueRoute,
    trigger,
    projectRoot,
    im,
    runtime,
    ingress,
    agent,
    approvalPort,
    assistantStatus,
    intentResolver,
    sceneFactRefresher,
    reactionPacer,
    audit,
    reply,
    withInference,
    hooks,
  } = input;
  const service = agent.service;
  const traceRuntime = agent.traceRuntime;
  const binding = service.getBindingRegistry().requireZhinBinding();

  return runInMailTurn({ mailbox, mail: admission.mail, batch: admission.batch }, () =>
    withTriggerTimeout(async (timeoutSignal) => {
      const signal = AbortSignal.any([
        timeoutSignal,
        ...(operationSignal ? [operationSignal] : []),
        admission.signal,
        ...(lease.stopSignal ? [lease.stopSignal] : []),
      ]);
      const source = operationSession;
      let profileOperation: CapturedEndpointOperation | undefined;
      if (source) {
        profileOperation = im.endpoints.captureOperation({
          target: message.conversation,
          client: source.endpoint,
          signal,
          requester,
        });
        hooks.setProfileOperation(profileOperation);
      }
      const contextState = await resolveRuntimeTurnContextState({
        snapshot,
        conversation: message.conversation,
        signal,
        senderId: message.sender?.id,
        selfProfile: profileOperation?.profile,
        factServices: { store: agent.agent.getUserProfiles?.()?.scenes, refresher: sceneFactRefresher },
      });
      signal.throwIfAborted();
      const platformCapabilities = resolveRuntimeTurnCapabilities(snapshot, message.conversation, contextState);
      const contextAccess = createRuntimeTurnAccess(message, senderRoles, contextState, platformCapabilities, conversationSequence);
      const liveWindow = admission.facts.liveWindow;
      const liveDanmaku: TurnLiveDanmaku | undefined = liveWindow
        ? Object.freeze({
            mode: mailbox.config.live.mode,
            candidates: liveWindow.candidates,
            senders: mergedTurnSenders(admission.participants),
          })
        : undefined;
      const liveAccess = liveDanmaku ? anonymousMemberAccess(contextAccess, senderId) : undefined;
      if (liveWindow) {
        logger.debug(formatCompact({ op: 'agent_host_danmaku_window', sessionKey, candidates: liveWindow.candidates, kept: liveWindow.kept }));
      }
      const hasMergedOrShiftedParticipants = !liveDanmaku && (
        admission.participants.length > 1
        || (admission.participants.length === 1 && admission.participants[0]!.senderId !== senderId)
      );
      const members = hasMergedOrShiftedParticipants
        ? mergedMemberAccess(admission.participants, contextAccess)
        : undefined;
      const effectiveCarrier = members ? members[0]! : (liveAccess ?? contextAccess);
      const read = await readTurnCapabilities(
        ingress,
        snapshot,
        requester,
        effectiveCarrier,
        members && members.length > 1 ? members : undefined,
        hooks.isCapabilityActive,
      );
      signal.throwIfAborted();
      const turnAccessForTurn = members
        ? (members.length > 1
          ? withMergeMembers(narrowMergedAccess(effectiveCarrier, members), read.members, read.memberTools)
          : effectiveCarrier)
        : effectiveCarrier;
      const mergedSenders = members && members.length > 1 ? mergedTurnSenders(admission.participants) : undefined;
      const capabilities = liveDanmaku ? readOnlyCapabilities(read.capabilities) : read.capabilities;
      let routed = routeSpecialistAgent(
        inbound.text,
        capabilities,
        venueRoute?.member.agent,
        binding.name,
        turnAccess.origin.kind === 'im' ? turnAccess.origin.platform : undefined,
      );
      if (trigger?.thinkingMessage && !ambient && !liveDanmaku && !hooks.outboundBlocked('thinking')) {
        message.$reply(trigger.thinkingMessage).catch((error: unknown) => {
          logger.debug(formatCompact({
            op: 'agent_host_thinking_reply_failed',
            error: error instanceof Error ? error.message : String(error),
          }));
        });
      }

      const traceId = randomUUID();
      hooks.setModelStartedAt(Date.now());
      const outcome = await withInference({ lease, sessionKey, operationId: turnId, signal }, scope =>
        runWithAgentDecisionTurn({
          snapshot,
          turnId,
          inferenceSnapshot: scope.snapshot,
          models: { graph: scope.graph, inference: scope.client, resolve: scope.resolve },
          disabled: false,
          observe: observation => {
            assistantStatus?.recordDecision(observation);
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
            workroomTurn: venueRoute != null,
            signal,
          });
          const approvalPolicy = decisionRuntime?.config.approval;
          const approvalJudgment = decisionRuntime && approvalPolicy && approvalPolicy.mode !== 'off'
            ? new DecisionApprovalJudgment({
                provider: decisionRuntime.forTask('approval')!,
                policy: approvalPolicy,
                baseline: agent.approvalJudgment,
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
            projectRoot,
            defaultNetwork: interactiveNetworkPolicy(service.getAgentConfig()),
          });
          const approverId = senderRoles.isMaster ? message.sender?.id : ownerId;
          const approvalInteraction = approverId
            ? im.createInteraction(message, { subjectId: approverId })
            : undefined;
          const askApprovalPort = createRuntimeApprovalPort({
            locale: message.locale,
            isMaster: senderRoles.isMaster && turnPolicy.shell?.approvalMode !== 'ask',
            interaction: approvalInteraction,
            memory: agent.approvalReviewer,
          });
          const escalatedApprovalPort = createRuntimeApprovalPort({
            locale: message.locale,
            isMaster: false,
            interaction: approvalInteraction,
            memory: agent.approvalReviewer,
          });
          const replyPort = createIngressReplyPort({
            message,
            snapshot,
            requester,
            signal,
            operationSession,
            sessionKey,
            effectiveAdapter,
            platformCapabilities,
            turnPolicy,
            service,
            im,
            admission,
            liveDanmaku,
            mergedSenders,
            reactionPacer,
            audit,
            reply,
            hooks,
          });
          const request = createRuntimeTurnRequest({ message, text: routed.userText, roles: senderRoles }, {
            ...(members || liveAccess ? { access: turnAccessForTurn } : {}),
            traceId,
            turnId,
            signal,
            projectRoot,
            workspaceRoot: turnPolicy.filesystem.workspaceRoot,
            workingDirectory: turnPolicy.filesystem.workingDirectory,
            filesystemAccess: liveDanmaku ? 'read-only' : turnPolicy.filesystem.access,
            shell: liveDanmaku ? undefined : turnPolicy.shell,
            network: turnPolicy.network,
            sessionKey,
            ...(!liveRoom && !ambient && !sceneMerge
              ? { personalSession: runtimePersonalSessionAddress(turnAccess, projectRoot) } : {}),
            contextState,
            ...(platformCapabilities ? { platformCapabilities } : {}),
            ...(conversationSequence !== undefined ? { conversationSequence } : {}),
            ...(sceneEvents.length ? { sceneEvents } : {}),
            ...(mergedSenders ? { mergedSenders } : {}),
            ...(liveDanmaku ? { liveDanmaku } : {}),
            ...(ambient ? {
              trustedMetadata: Object.freeze({ [AMBIENT_ENGAGEMENT_METADATA_KEY]: 'ambient' }),
            } : {}),
            intent: gate ? Object.freeze({ kind: 'new' as const }) : await resolveProductTurnIntent(
              message,
              senderRoles,
              service.getAgentConfig()?.mailbox?.groupMode,
              intentResolver,
            ),
            resolveReference: (reference, limits, referenceSignal) =>
              im.resolveConversationReference(lease, reference, {
                signal: referenceSignal,
                maxDepth: limits.depth,
                maxEntries: limits.maxEntries,
                maxChars: limits.maxChars,
              }),
            ...(conversationSequence === undefined ? {} : {
              readConversationContext: async (consumer: string, contextSignal: AbortSignal) => {
                contextSignal.throwIfAborted();
                if (!lease.active) throw new Error('Conversation context generation lease expired');
                return im.readConversationContext(
                  message.conversation,
                  consumer,
                  conversationSequence,
                  50,
                  message.message?.id,
                );
              },
              commitConversationContext: async (consumer: string, cursor: number) => {
                if (!lease.active) throw new Error('Conversation context generation lease expired');
                await im.commitConversationContext(message.conversation, consumer, cursor);
              },
            }),
            ports: {
              ...(profileOperation?.profile ? { selfProfile: profileOperation.profile } : {}),
              approval: liveDanmaku ? NO_APPROVAL_PORT : approvalPort ?? resolveApprovalPort({
                mode: turnPolicy.shell?.approvalMode
                  ?? service.getAgentConfig()?.execApprovalMode
                  ?? 'auto',
                auto: createAutoApprovalPort(
                  agent.approvalReviewer,
                  escalatedApprovalPort,
                  approvalJudgment,
                  { escalateRejections: senderRoles.isMaster && turnAccess.origin.kind === 'im' && turnAccess.origin.scope === 'private' },
                ),
                ask: askApprovalPort,
              }),
              question: createRuntimeQuestionPort(im, message),
              reply: replyPort.port,
            },
          });
          try {
            return await runtime.executeLeased(
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
          } finally {
            replyPort.release();
          }
        }),
      );
      return { outcome, capabilities, routed };
    }, resolveTriggerTimeoutMs(trigger)),
  );
}
