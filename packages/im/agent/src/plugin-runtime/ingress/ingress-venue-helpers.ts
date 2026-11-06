import {
  routeVenueMessage,
  venueProjectorToken,
  venueRegistryToken,
  type AITriggerConfig,
  type VenueDefinition,
  type VenueProjector,
  type VenueRegistry,
  type VenueRouteResult,
} from '@zhin.js/core';
import { agentFeatureId, isAgentIndex } from '@zhin.js/agent-feature';
import {
  adapterDeclaresLiveDanmaku,
  type ImRuntime,
  type Message,
  type SendContent,
} from '@zhin.js/core/runtime';
import type { InferenceOperationScope } from '@zhin.js/ai/provider';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId, RuntimeSnapshot, SnapshotLease } from '@zhin.js/plugin-runtime';
import type { TurnAccessContext } from '../../turn/turn-ingress.js';
import { isCancelIntent } from '../../turn/index.js';
import type { HostMailbox } from '../../collaboration/host-mailbox.js';
import type { AmbientEngagement } from './ambient-engagement.js';
import type { ColdFieldMonitor } from './cold-field.js';
import {
  auditControlGate,
  auditControlOutbound,
  checkControlAtIngress,
  checkControlAtOutbound,
  logControlBlocked,
  type ControlGateTarget,
} from './control-gate.js';
import {
  auditCannotSpeak,
  type DecisionAudit,
} from './decision-audit.js';
import { considerAmbientEngagement } from './ingress-ambient-stage.js';
import type { AgentAssistantStatusPort, AgentIngressFoundationPort } from './ports.js';
import {
  runtimeImSessionKey,
  runtimeSceneTaskSessionKey,
  type RuntimeSenderRoles,
} from './request.js';
import type { SceneEventIngress } from './scene-event-ingress.js';
import { observeSessionAndCheckSpeak } from './session-gate.js';
import {
  hasIgnoredTriggerPrefix,
  ingressMessages as t,
  resolveRuntimeAgentTrigger,
  routeSpecialistAgent,
} from './unified-mailbox-spine.js';

type RuntimeTriggerMatch = NonNullable<ReturnType<typeof resolveRuntimeAgentTrigger>>;

const logger = getLogger('agent');

export interface IngressVenueRoutingContext {
  readonly venueRegistry: VenueRegistry | undefined;
  readonly venueProjector: VenueProjector | undefined;
  readonly matchedVenue: VenueDefinition | undefined;
  readonly venueRoute: VenueRouteResult | undefined;
  readonly venueAddressed: boolean;
  readonly liveRoom: boolean;
  readonly initialMatched: RuntimeTriggerMatch | null;
  readonly initialSessionKey: string;
}

/**
 * Resolves multi-bot Venue addressing (ADR 0048 H4), live-room danmaku status,
 * initial trigger match, and initial session key for an inbound message.
 */
export function resolveIngressVenueContext(input: {
  readonly message: Message;
  readonly snapshot: RuntimeSnapshot;
  readonly turnAccess: TurnAccessContext;
  readonly effectiveEndpoint: string;
  readonly trigger: AITriggerConfig | undefined;
  readonly projectRoot: string;
  readonly venueRegistry?: VenueRegistry;
  readonly venueProjector?: VenueProjector;
}): IngressVenueRoutingContext {
  const {
    message,
    snapshot,
    turnAccess,
    effectiveEndpoint,
    trigger,
    projectRoot,
  } = input;
  const venueRegistry = input.venueRegistry
    ?? (snapshot.resources.get(snapshot.root)?.get(venueRegistryToken.id) as VenueRegistry | undefined);
  const venueProjector = input.venueProjector
    ?? (snapshot.resources.get(snapshot.root)?.get(venueProjectorToken.id) as VenueProjector | undefined);
  const matchedVenue: VenueDefinition | undefined = turnAccess.origin.kind === 'im'
    ? venueRegistry?.findByConversation({
        platform: turnAccess.origin.platform,
        sceneType: message.conversation.kind,
        sceneId: message.conversation.id,
      })
    : undefined;
  const structuredMentions = Array.isArray(message.metadata?.mentions)
    ? (message.metadata.mentions as readonly unknown[]).filter((m): m is string => typeof m === 'string')
    : undefined;
  const replyToSenderId = typeof message.metadata?.replyToSenderId === 'string'
    ? message.metadata.replyToSenderId
    : undefined;
  const venueRoute = matchedVenue
    ? routeVenueMessage({
        venue: matchedVenue,
        text: message.content ?? '',
        ...(structuredMentions ? { mentions: structuredMentions } : {}),
        ...(replyToSenderId ? { replyToSenderId } : {}),
        winningEndpointId: effectiveEndpoint,
      })
    : undefined;
  const venueAddressed = venueRoute !== undefined
    && (venueRoute.reason === 'mention' || venueRoute.reason === 'reply' || venueRoute.reason === 'pending');
  const initialMatched = resolveRuntimeAgentTrigger(message, trigger, venueAddressed);
  const liveRoom = turnAccess.origin.kind === 'im'
    && turnAccess.origin.scope !== 'private'
    && adapterDeclaresLiveDanmaku(message.conversation.endpoint.id as CapabilityId, snapshot);
  const initialSessionKey = liveRoom
    ? runtimeSceneTaskSessionKey(turnAccess, projectRoot)
    : runtimeImSessionKey(turnAccess, projectRoot);

  return {
    venueRegistry,
    venueProjector,
    matchedVenue,
    venueRoute,
    venueAddressed,
    liveRoom,
    initialMatched,
    initialSessionKey,
  };
}

/** Builds the frozen Venue metadata descriptor passed into `HostMailbox.admit`. */
export function buildAdmittedVenueDescriptor(
  message: Message,
  matchedVenue: VenueDefinition | undefined,
  venueRoute: VenueRouteResult | undefined,
): Readonly<{
  kind: Message['conversation']['kind'];
  id: string;
  platform: string;
  sceneType: string;
  sceneId: string;
  threadId?: string;
  accountId?: string;
}> | undefined {
  if (!matchedVenue) return undefined;
  return Object.freeze({
    kind: message.conversation.kind,
    id: matchedVenue.id,
    platform: matchedVenue.conversation.platform,
    sceneType: matchedVenue.conversation.sceneType ?? message.conversation.kind,
    sceneId: matchedVenue.conversation.sceneId,
    ...(matchedVenue.conversation.threadId ? { threadId: matchedVenue.conversation.threadId } : {}),
    ...(venueRoute?.member.botEndpoint ? { accountId: venueRoute.member.botEndpoint } : {}),
  });
}

export type IngressGateEvaluation =
  | { readonly kind: 'halt'; readonly handled: boolean }
  | {
      readonly kind: 'proceed';
      readonly matched: RuntimeTriggerMatch;
      readonly ambient: boolean;
      readonly sessionKey: string;
      readonly outboundBlocked: (stage: string) => boolean;
    };

/**
 * Evaluates control-plane gates, session-gate speaking eligibility, live-room danmaku
 * candidacy, and ambient engagement fallback before opening a Mail turn.
 */
export async function evaluateIngressGatesAndTrigger(input: {
  readonly message: Message;
  readonly lease: SnapshotLease;
  readonly turnAccess: TurnAccessContext;
  readonly effectiveEndpoint: string;
  readonly conversationSequence: number | undefined;
  readonly trigger: AITriggerConfig | undefined;
  readonly bindingNickname: string | undefined;
  readonly projectRoot: string;
  readonly liveRoom: boolean;
  readonly initialMatched: RuntimeTriggerMatch | null;
  readonly initialSessionKey: string;
  readonly im: ImRuntime;
  readonly agent: AgentIngressFoundationPort;
  readonly assistantStatus: AgentAssistantStatusPort | undefined;
  readonly ambientEngagement: AmbientEngagement | null;
  readonly coldField: ColdFieldMonitor;
  readonly audit: DecisionAudit;
  readonly withInference: <T>(
    inferInput: Readonly<{ lease: SnapshotLease; sessionKey: string; operationId?: string; signal: AbortSignal }>,
    run: (scope: InferenceOperationScope) => Promise<T>,
  ) => Promise<T>;
}): Promise<IngressGateEvaluation> {
  const {
    message,
    lease,
    turnAccess,
    effectiveEndpoint,
    conversationSequence,
    trigger,
    bindingNickname,
    projectRoot,
    liveRoom,
    im,
    agent,
    assistantStatus,
    ambientEngagement,
    coldField,
    audit,
    withInference,
  } = input;
  let matched = input.initialMatched;
  let sessionKey = input.initialSessionKey;
  let ambient = false;

  const zhinAgent = agent.agent;
  const platform = turnAccess.origin.kind === 'im' ? turnAccess.origin.platform : '';
  const ambientKey = message.conversation.kind === 'group' ? `${platform}:${message.conversation.id}` : undefined;
  const control = zhinAgent.getControlPlane?.();
  const controlTarget: ControlGateTarget | undefined = turnAccess.origin.kind === 'im'
    ? { platform, scope: turnAccess.origin.scope, sceneId: turnAccess.origin.sceneId }
    : undefined;

  if (ambientKey && matched != null) coldField.reset(ambientKey);
  if (controlTarget) {
    const verdict = checkControlAtIngress(control, controlTarget, matched != null || controlTarget.scope === 'private');
    if (verdict.blocked) {
      logControlBlocked('agent_turn_skipped_control', `${platform}:${message.conversation.id}`, verdict);
      auditControlGate(audit, verdict, { source: 'message', addressed: matched != null });
      return { kind: 'halt', handled: matched != null };
    }
  }

  const outboundBlocked = (stage: string): boolean => {
    if (!controlTarget) return false;
    const verdict = checkControlAtOutbound(control, controlTarget);
    if (!verdict.blocked) return false;
    logControlBlocked('agent_outbound_blocked_control', `${platform}:${message.conversation.id}`, verdict);
    auditControlOutbound(audit, verdict, { source: stage });
    return true;
  };

  if (turnAccess.origin.kind === 'im') {
    const blocked = await observeSessionAndCheckSpeak({
      sessions: zhinAgent.getUserProfiles?.()?.sessions,
      events: im.conversationEventReader,
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
      return { kind: 'halt', handled: matched != null };
    }
  }

  if (!matched && liveRoom) {
    const text = message.content.trim();
    if (text && trigger?.enabled !== false && !hasIgnoredTriggerPrefix(text, trigger)) matched = { content: text };
  }
  if (!matched) {
    matched = await considerAmbientEngagement({
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
      botName: bindingNickname?.trim() || 'Zhin',
      audit,
    });
    if (!matched) return { kind: 'halt', handled: false };
    ambient = true;
    sessionKey = runtimeSceneTaskSessionKey(turnAccess, projectRoot);
  } else if (ambientKey) {
    ambientEngagement?.noteSpoke(ambientKey);
  }

  return {
    kind: 'proceed',
    matched,
    ambient,
    sessionKey,
    outboundBlocked,
  };
}

/** Collects `[Scene events]` summary lines for non-private IM turns (#996). */
export async function collectIngressSceneEventLines(input: {
  readonly sceneEvents: SceneEventIngress;
  readonly turnAccess: TurnAccessContext;
  readonly sessionKey: string;
  readonly message: Message;
  readonly platform: string;
  readonly effectiveEndpoint: string;
  readonly conversationSequence: number | undefined;
}): Promise<readonly string[]> {
  const {
    sceneEvents,
    turnAccess,
    sessionKey,
    message,
    platform,
    effectiveEndpoint,
    conversationSequence,
  } = input;
  if (turnAccess.origin.kind !== 'im' || turnAccess.origin.scope === 'private') {
    return [];
  }
  return sceneEvents.linesFor({
    sessionKey,
    conversation: message.conversation,
    platform,
    endpointId: turnAccess.origin.endpoint,
    throughSequence: conversationSequence,
    selfIds: [effectiveEndpoint, message.metadata?.selfId, message.metadata?.self_id]
      .filter((value): value is string | number => (typeof value === 'string' && value !== '') || typeof value === 'number')
      .map(String),
  });
}

/** Resolves the pre-routed specialist/venue/binding entry actor name for Mailbox admission and cancel checks. */
export function resolvePreRoutedEntryActorName(input: {
  readonly snapshot: RuntimeSnapshot;
  readonly matchedContent: string;
  readonly venueAgentName: string | undefined;
  readonly bindingName: string;
  readonly platform: string | undefined;
}): string {
  const { snapshot, matchedContent, venueAgentName, bindingName, platform } = input;
  const agentProj = snapshot.projections.get(agentFeatureId);
  const snapshotAgents = isAgentIndex(agentProj) ? agentProj.list() : [];
  let preRoutedAgentName: string | undefined;
  try {
    preRoutedAgentName = routeSpecialistAgent(
      matchedContent,
      { agents: snapshotAgents },
      venueAgentName,
      bindingName,
      platform,
    ).agent?.name;
  } catch {
    preRoutedAgentName = undefined;
  }
  return preRoutedAgentName ?? venueAgentName ?? bindingName;
}

/** Attempts to stop an in-flight turn in the personal or merged scene session when the user sends a cancel word. */
export async function tryStopActiveMailTurn(input: {
  readonly gate: HostMailbox | undefined;
  readonly matchedContent: string;
  readonly sessionKey: string;
  readonly senderId: string;
  readonly senderRoles: RuntimeSenderRoles;
  readonly entryActorName: string;
  readonly mergeWindowEnabled: boolean;
  readonly liveRoom: boolean;
  readonly ambient: boolean;
  readonly turnAccess: TurnAccessContext;
  readonly projectRoot: string;
  readonly message: Message;
  readonly reply: (content: SendContent) => Promise<Awaited<ReturnType<Message['$reply']>>>;
}): Promise<boolean> {
  const {
    gate,
    matchedContent,
    sessionKey,
    senderId,
    senderRoles,
    entryActorName,
    mergeWindowEnabled,
    liveRoom,
    ambient,
    turnAccess,
    projectRoot,
    message,
    reply,
  } = input;
  if (!gate || !isCancelIntent(matchedContent)) return false;

  let stoppedKey = sessionKey;
  let stopped = await gate.stop(sessionKey, senderId, senderRoles.isMaster, entryActorName);
  if (
    stopped !== 'stopped'
    && mergeWindowEnabled
    && !liveRoom
    && !ambient
    && turnAccess.origin.kind === 'im'
    && turnAccess.origin.scope !== 'private'
  ) {
    const sceneKey = runtimeSceneTaskSessionKey(turnAccess, projectRoot);
    if (sceneKey !== sessionKey && (await gate.stop(sceneKey, senderId, senderRoles.isMaster, entryActorName)) === 'stopped') {
      stopped = 'stopped';
      stoppedKey = sceneKey;
    }
  }
  if (stopped === 'stopped') {
    await reply(t(message.locale, 'stopped'));
    logger.info(formatCompact({ op: 'agent_host_turn_stopped', sessionKey: stoppedKey }));
    return true;
  }
  return false;
}
