import type { AITriggerConfig, VenueDefinition, VenueRouteResult, readOperationSession } from '@zhin.js/core';
import {
  resolveAiOutboundSegments,
  type CapturedEndpointOperation,
  type CoreReplyStream,
  type ImRuntime,
  type Message,
  type SendContent,
} from '@zhin.js/core/runtime';
import { EndpointDeliveryError, type TextSegment } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import {
  publishOutboundElements,
  resolveOutboundCapabilities,
} from '../../media/index.js';
import type {
  ReplyPort,
  TurnAccessContext,
  TurnOutcome,
} from '../../turn/turn-ingress.js';
import {
  liveReplyAuditPayload,
  mergedReplyAuditPayload,
  type TurnAdmission,
  type TurnLiveDanmaku,
  type TurnMergedSender,
} from '../../turn/index.js';
import type { readTurnCapabilities } from './ingress-turn-execution-stage.js';
import type { HostMailbox } from '../../collaboration/host-mailbox.js';
import {
  completedOutput,
  flattenOutputElements,
  preprocessInboundTurn,
} from './content.js';
import {
  auditModelError,
  auditModelRun,
  auditOutbound,
  type DecisionAudit,
} from './decision-audit.js';
import { admissionRejectionNotice, reactionOf } from './ingress-delivery-helpers.js';
import { buildAdmittedVenueDescriptor } from './ingress-venue-helpers.js';
import type { AgentIngressFoundationPort } from './ports.js';
import { deliverReaction, type ReactionPacer } from './reaction-pacer.js';
import { sendOutputMessages } from './reply-messages.js';
import {
  deliveryOutcomeFromReceipt,
  resolveRuntimeTurnCapabilities,
  type RuntimeSenderRoles,
} from './request.js';
import type { resolveSandboxTurnPolicy } from './sandbox-policy.js';
import { renderChatTurnError } from './trigger.js';

type OperationSession = ReturnType<typeof readOperationSession>;
type PreprocessedInbound = Awaited<ReturnType<typeof preprocessInboundTurn>>;
type SandboxTurnPolicy = ReturnType<typeof resolveSandboxTurnPolicy>;
type TurnCapabilities = Awaited<ReturnType<typeof readTurnCapabilities>>['capabilities'];

const logger = getLogger('agent');

export interface IngressOutboundHooks {
  markSpoke(): void;
  staleReplyBlocked(): boolean;
  outboundBlocked(stage: string): boolean;
}

export interface CreateIngressReplyPortInput {
  readonly message: Message;
  readonly snapshot: RuntimeSnapshot;
  readonly requester: PluginId;
  readonly signal: AbortSignal;
  readonly operationSession: OperationSession;
  readonly sessionKey: string;
  readonly effectiveAdapter: string;
  readonly platformCapabilities: ReturnType<typeof resolveRuntimeTurnCapabilities>;
  readonly turnPolicy: SandboxTurnPolicy;
  readonly service: AgentIngressFoundationPort['service'];
  readonly im: ImRuntime;
  readonly admission: Extract<TurnAdmission, { kind: 'run' }>;
  readonly liveDanmaku: TurnLiveDanmaku | undefined;
  readonly mergedSenders: readonly TurnMergedSender[] | undefined;
  readonly reactionPacer: ReactionPacer;
  readonly audit: DecisionAudit;
  readonly reply: (content: SendContent) => Promise<Awaited<ReturnType<Message['$reply']>>>;
  readonly hooks: IngressOutboundHooks;
}

/**
 * Builds the `ReplyPort` (`openStream` + `send`) for an admitted IM turn,
 * handling reaction pacing, progressive stream settlement, and outbound audit.
 */
export function createIngressReplyPort(input: CreateIngressReplyPortInput): {
  readonly port: ReplyPort;
  readonly release: () => void;
} {
  const {
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
  } = input;
  const replyConversation = message.conversation;
  const replySegments = resolveAiOutboundSegments(
    replyConversation.endpoint.id as CapabilityId,
    snapshot,
    replyConversation.kind,
  );
  let replyOperation: CapturedEndpointOperation | undefined;
  let danmakuAudited = false;

  const port: ReplyPort = {
    segments: !message.message
      ? { ...replySegments, reaction: undefined }
      : replySegments,
    openStream: () => {
      if (liveDanmaku) return undefined;
      replyOperation ??= im.endpoints.captureOperation({
        target: replyConversation,
        client: message.$client,
        signal,
        requester,
      });
      const stream = replyOperation.openReplyStream?.({
        locale: message.locale,
        source: { messageId: message.message?.id, senderId: message.sender?.id, event: operationSession?.event },
        beforeSubmit: () => {
          if (hooks.staleReplyBlocked() || hooks.outboundBlocked('reply')) {
            throw new EndpointDeliveryError('reply_suppressed', 'Reply admission is no longer active', 'not_sent');
          }
        },
        prepare: segments => publishOutboundElements(
          [{ type: 'message', segments: [...segments] }],
          effectiveAdapter || undefined,
          undefined,
          {
            filesystem: turnPolicy.filesystem,
            imageAssets: service.imageAssets,
            ...(turnPolicy.network ? { network: turnPolicy.network } : {}),
          },
        ),
      });
      if (!stream) return undefined;
      let settlement: Promise<CoreReplyStream['receipt']> | undefined;
      const settle = (receipt: CoreReplyStream['receipt']) => settlement ??= Promise.resolve().then(() => {
        const deliveryOutcome = deliveryOutcomeFromReceipt(receipt);
        auditOutbound(audit, deliveryOutcome, { progressive: true });
        if (stream.confirmed.length) {
          hooks.markSpoke();
          admission.markDelivered();
        }
        return receipt;
      });
      return Object.freeze({
        get minIntervalMs() { return stream.minIntervalMs; },
        get receipt() { return stream.receipt; },
        get confirmed() { return stream.confirmed; },
        update: snapshotInput => stream.update(snapshotInput),
        finish: snapshotInput => stream.finish(snapshotInput).then(settle),
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
      const deliveryOutcome = await sendOutputMessages(output, {
        render: messageOutput => flattenOutputElements([...messageOutput]),
        send: async (messageOutput) => {
          if (hooks.staleReplyBlocked()) {
            logger.debug(formatCompact({ op: 'agent_host_reply_stale_discarded', sessionKey }));
            return { status: 'suppressed' as const };
          }
          if (hooks.outboundBlocked('reply')) {
            auditOutbound(audit, { status: 'suppressed' }, { control: true });
            return { status: 'suppressed' as const };
          }
          const reaction = reactionOf(messageOutput);
          if (reaction !== undefined) {
            const delivery = await deliverReaction({
              pacer: reactionPacer,
              sessionKey,
              add: message.message
                ? () => im.endpoints.addReaction({
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
            admission.markDelivered();
            hooks.markSpoke();
            auditOutbound(audit, { status: 'sent' }, { reaction: true, applied: delivery.applied, ...(delivery.paced ? { paced: true } : {}) });
            return { status: 'sent' as const };
          }
          const content = await publishOutboundElements(
            [...messageOutput],
            effectiveAdapter || undefined,
            resolveOutboundCapabilities(effectiveAdapter, platformCapabilities),
            {
              filesystem: turnPolicy.filesystem,
              imageAssets: service.imageAssets,
              ...(turnPolicy.network ? { network: turnPolicy.network } : {}),
            },
          );
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
              ? content.map(segment => String(segment.data.text)).join('')
              : undefined;
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
            hooks.markSpoke();
            admission.markDelivered();
          }
          return sent;
        },
      });
      logger.debug(formatCompact({
        op: 'replychain_delivery_outcome',
        status: deliveryOutcome.status,
        code: 'code' in deliveryOutcome ? deliveryOutcome.code : undefined,
        messageId: 'messageId' in deliveryOutcome ? deliveryOutcome.messageId : undefined,
      }));
      return deliveryOutcome;
    },
  };

  return {
    port,
    release: () => replyOperation?.release(),
  };
}

/**
 * Preprocesses inbound audio/text and submits the turn to `HostMailbox.admit`,
 * handling merge-window join/flush audit and rejection notices.
 */
export async function admitIngressMailTurn(input: {
  readonly message: Message;
  readonly matchedContent: string;
  readonly transcribeUrl: ((audioUrl: string) => Promise<string | null>) | undefined;
  readonly matchedVenue: VenueDefinition | undefined;
  readonly venueRoute: VenueRouteResult | undefined;
  readonly mailbox: HostMailbox;
  readonly gate: HostMailbox | undefined;
  readonly sessionKey: string;
  readonly turnId: string;
  readonly senderId: string;
  readonly entryActorName: string;
  readonly senderRoles: RuntimeSenderRoles;
  readonly plainText: boolean;
  readonly liveRoom: boolean;
  readonly mergeable: boolean;
  readonly turnAccess: TurnAccessContext;
  readonly audit: DecisionAudit;
  readonly reply: (content: SendContent) => Promise<Awaited<ReturnType<Message['$reply']>>>;
}): Promise<
  | { readonly kind: 'completed' }
  | {
      readonly kind: 'admitted';
      readonly admission: Extract<TurnAdmission, { kind: 'run' }>;
      readonly inbound: PreprocessedInbound;
    }
> {
  const {
    message,
    matchedContent,
    transcribeUrl,
    matchedVenue,
    venueRoute,
    mailbox,
    gate,
    sessionKey,
    turnId,
    senderId,
    entryActorName,
    senderRoles,
    plainText,
    liveRoom,
    mergeable,
    turnAccess,
    audit,
    reply,
  } = input;
  const preprocessed = await preprocessInboundTurn(message, matchedContent, transcribeUrl);
  let inbound = preprocessed;
  const venueDescriptor = buildAdmittedVenueDescriptor(message, matchedVenue, venueRoute);
  const admitted = await mailbox.admit({
    sessionKey: gate ? sessionKey : `turn:${turnId}`,
    senderId,
    entry: entryActorName,
    isMaster: senderRoles.isMaster,
    text: preprocessed.text,
    plainText,
    ...(venueDescriptor ? { venue: venueDescriptor } : {}),
    live: gate !== undefined && liveRoom && !senderRoles.isMaster,
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
    return { kind: 'completed' };
  }
  if (admitted.kind === 'rejected') {
    logger.info(formatCompact({ op: 'agent_host_turn_rejected', sessionKey, reason: admitted.reason }));
    const notice = admissionRejectionNotice(admitted.reason, message.locale);
    if (notice) await reply(notice);
    return { kind: 'completed' };
  }
  if (gate) inbound = { ...preprocessed, text: admitted.text };
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
  return { kind: 'admitted', admission: admitted, inbound };
}

/** Records model-run audit and diagnostic logs after an admitted Mail turn completes. */
export function finalizeIngressTurnSuccess(input: {
  readonly audit: DecisionAudit;
  readonly outcome: TurnOutcome;
  readonly capabilities: TurnCapabilities;
  readonly routedAgentName: string | undefined;
  readonly modelPayload: () => Record<string, unknown>;
  readonly sttApplied: boolean;
}): void {
  const { audit, outcome, capabilities, routedAgentName, modelPayload, sttApplied } = input;
  auditModelRun(audit, outcome, { ...modelPayload(), agent: routedAgentName ?? null });
  const elements = completedOutput(outcome);
  const outputText = flattenOutputElements(elements).trim();
  if (!outputText) {
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
    stt: sttApplied,
    agent: routedAgentName ?? '-',
  }));
}

/** Handles turn abort/supersede or unexpected errors during an admitted Mail turn. */
export async function handleIngressTurnFailure(input: {
  readonly error: unknown;
  readonly admission: Extract<TurnAdmission, { kind: 'run' }> | undefined;
  readonly modelStartedAt: number | undefined;
  readonly modelPayload: () => Record<string, unknown>;
  readonly audit: DecisionAudit;
  readonly sessionKey: string;
  readonly trigger: AITriggerConfig | undefined;
  readonly isMaster: boolean;
  readonly locale: Message['locale'];
  readonly outboundBlocked: (stage: string) => boolean;
  readonly reply: (content: SendContent) => Promise<Awaited<ReturnType<Message['$reply']>>>;
}): Promise<boolean> {
  const {
    error,
    admission,
    modelStartedAt,
    modelPayload,
    audit,
    sessionKey,
    trigger,
    isMaster,
    locale,
    outboundBlocked,
    reply,
  } = input;
  if (admission?.signal.aborted) {
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
    const line = renderChatTurnError(trigger, error, isMaster, locale);
    if (line && !outboundBlocked('error_reply')) await reply(line);
  } catch {
    /* ignore reply failure */
  }
  return true;
}
