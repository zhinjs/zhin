import type { EndpointChildLease, EndpointEvent, PeerRegistry } from '@zhin.js/adapter';
import type { CommandExecutionBudget, CommandOperationController } from '@zhin.js/command/internal/execution';
import type { OperationResourceView } from '@zhin.js/feature-kit';
import { normalizePlatformStanding, type DeliveryReceipt, type UserInteraction } from '@zhin.js/im-contract';
import { createErrorId, formatCompact, getLogger, truncatePreview } from '@zhin.js/logger';
import { redactChatIdentityBindText, redactSecretText } from '@zhin.js/kernel';
import type {
  CapabilityId,
  GenerationAdmissionGate,
  PluginId,
  RuntimeSnapshot,
  SnapshotLease,
} from '@zhin.js/plugin-runtime';
import type { IncomingNotice, Notice } from '../../notice.js';
import type { IncomingRequest, Request } from '../../request.js';
import type { EndpointEventContext } from '../../side-event/base.js';
import type { IncomingSystemEvent, SystemEvent } from '../../system-event.js';
import {
  RuntimeMessage,
  inboundOutcomeFacade,
  operationEndpoint,
  type CaptureEndpointOperationInput,
  type CapturedEndpointOperation,
  type IncomingMessage,
  type InboundSecretGuard,
  type InboundSecretMatch,
  type Message,
  type MessageDispatchResult,
  type MessageSenderRef,
  type RuntimeMessageOperation,
  type SendRequest,
} from './contracts.js';
import { requireAdapters } from './endpoint-runtime.js';
import type { RecordIncomingOptions } from './conversation-runtime.js';
import { adapterDeclaresInboundTextAuthoredBySender } from './outbound-segments.js';
import type { InboundDeduper } from './inbound-dedup.js';
import type { InboundOriginClassifier } from './inbound-origin.js';
import {
  arbitrateRoomInboundDeduplication,
  dispatchCanonicalEndpointEvent,
  dispatchInboundHandlers,
  dispatchInboundInteractive,
  handlers,
  interactionResult,
  isAddressedMessage,
  messageLocale,
  resolveRoomMembership,
  runInboundMiddlewareAndSpine,
  withEndpointEventPayload,
  type InboundInteractionPort,
  type InboundOutcome,
  type IngressRoute,
} from './inbound-spine.js';
import type { RuntimeMessageDiagnostics } from './message-diagnostics.js';
import { InboundOutcomeLedger, type MessageOutcomeLog } from './inbound-outcome-ledger.js';
import { QUIET_MESSAGE_OUTCOMES, type MessageOutcomeRecord } from './message-outcome.js';
import { defaultCommandPrefixResolver, MessageDispatcher, normalizeCommandInputText } from './message-dispatcher.js';
import { suggestCommandReply } from './command-suggestion.js';
import type { OutboundCommandEnvironmentInput } from './outbound-command-environment.js';
import { interactionMessages } from '../../built/interaction-messages.js';
import {
  formatConversationLog,
  previewMessageContent,
  type RuntimeMessageEvent,
} from './message-events.js';

const logger = getLogger('im.inbound');

interface InboundRuntimeContext {
  readonly commandExecution?: CommandExecutionBudget;
  runCommandOperation?<T>(controller: CommandOperationController, operation: () => T): T;
  readonly diagnostics?: RuntimeMessageDiagnostics;
  /** ADR 0061: settled inbound outcomes (process-local log). Absent: outcomes are only logged. */
  readonly outcomes?: Pick<MessageOutcomeLog, 'record'>;
  readonly interactions: InboundInteractionPort;
  captureOperation(input: CaptureEndpointOperationInput): CapturedEndpointOperation;
  createOperationResources?(input: Readonly<{ lease: SnapshotLease; message: RuntimeMessage; owner: PluginId; signal: AbortSignal; conversationSequence?: number; delegatedFrom?: PluginId }>): OperationResourceView | undefined;
  /**
   * #1250 第 85 批: the generation's ingress route for `lease` (the Root-private `ingressRouteToken`, read
   * through the Root's real SnapshotStore). Absent: no ingress route runs.
   */
  resolveIngressRoute?(lease: SnapshotLease): IngressRoute | undefined;
  readonly inboundClaim?: (message: Message) => boolean | Promise<boolean>;
  /** One-time secrets (ADR 0060 §3.3 claim code): handled before anything records, logs or routes them. */
  readonly inboundSecret?: InboundSecretGuard;
  /** Trusted origin classifier. Absent: messages carry no origin (legacy behavior). */
  readonly originClassifier?: InboundOriginClassifier;
  /** Cross-Endpoint dedup of human group messages. Absent: no dedup. */
  readonly deduper?: Pick<InboundDeduper, 'claim'> & Partial<Pick<InboundDeduper, 'arbitrate'>>;
  /** Registry probes handed to the Room Router (account / availability). */
  readonly registry?: Pick<PeerRegistry, 'isReady' | 'selfOf'>;
  /** Process-level prompt probe (`inboundClaim`-style). Absent: false. */
  readonly inboundClaimPending?: (conversation: IncomingMessage['conversation'], senderId: string) => boolean;
  /** Resolve a replied-to message id to the local Endpoint that sent it (outbound ledger). */
  readonly resolveReplyTarget?: (conversation: IncomingMessage['conversation'], messageId: string) => string | undefined;
  readonly enrichSender?: (
    sender: MessageSenderRef | undefined,
    conversation: IncomingMessage['conversation'],
    snapshot: RuntimeSnapshot,
  ) => MessageSenderRef | undefined;
  acquire(): SnapshotLease;
  release(lease: SnapshotLease): void;
  deliver(request: SendRequest, snapshot: RuntimeSnapshot): Promise<DeliveryReceipt>;
  recordIncoming(
    input: IncomingMessage,
    sender: MessageSenderRef | undefined,
    options?: RecordIncomingOptions,
  ): Promise<number | undefined>;
  recordNotice(notice: Notice): Promise<unknown>;
  /** #996: join requests into a group/channel are conversation facts too. */
  recordRequest?(request: Request): Promise<unknown>;
  /** Keep a message that answered an interaction prompt out of later agent context. */
  markInteractionAnswer?(message: NonNullable<IncomingMessage['message']>): void;
  publish(event: RuntimeMessageEvent): void;
}

/** Conversations remembered for the per-minute `not_addressed` info line (bounded; cleared when full). */
const QUIET_LOG_CONVERSATIONS = 2_000;

/** Owns Endpoint ingress normalization, routing, dispatch, and side-event action scopes. */
export class InboundRuntime {
  readonly #dispatcher: MessageDispatcher;
  /**
   * zhinjs/zhin#1250 (`unaddressed-message-no-record`): the minute of the last `not_addressed` line
   * logged at info per conversation. The first unaddressed message of a conversation each minute
   * is logged at info (the instance log the Console shows), the rest of that minute at debug.
   */
  readonly #quietLogged = new Map<string, number>();

  constructor(
    private readonly context: InboundRuntimeContext,
    commandPrefix?: string,
  ) {
    this.#dispatcher = new MessageDispatcher(
      commandPrefix === undefined
        ? defaultCommandPrefixResolver
        : () => commandPrefix,
    );
  }

  createInteraction(
    message: Message,
    bind?: { readonly subjectId: string },
  ): UserInteraction | undefined {
    return this.context.interactions.createForMessage(message, bind);
  }

  /**
   * zhinjs/zhin#1250: the command environment of an outbound send's account, computed by the same
   * dispatcher (and prefix resolver) as inbound command dispatch on that account.
   */
  outboundCommandEnvironment(input: OutboundCommandEnvironmentInput, snapshot: RuntimeSnapshot): Readonly<{ prefix: string; menu?: string }> {
    const source = { conversation: input.conversation, locale: input.locale,
      ...(input.endpointId !== undefined ? { endpointId: input.endpointId } : {}) };
    // The resolver and the feature gate read only the conversation, the endpoint name and the locale.
    return this.#dispatcher.commandEnvironment(source as unknown as Message, snapshot);
  }

  async receive(
    event: EndpointEvent,
    admission?: GenerationAdmissionGate,
  ): Promise<unknown> {
    switch (event.name) {
      case 'message.receive':
        return this.context.diagnostics
          ? this.context.diagnostics.run(() => this.#receiveMessage(event as EndpointEvent<IncomingMessage>, admission))
          : this.#receiveMessage(event as EndpointEvent<IncomingMessage>, admission);
      case 'notice.receive':
        return this.#receiveCanonicalEndpointEvent(event as EndpointEvent<IncomingNotice>);
      case 'request.receive':
        return this.#receiveCanonicalEndpointEvent(event as EndpointEvent<IncomingRequest>);
      case 'system.receive':
        return this.#receiveCanonicalEndpointEvent(event as EndpointEvent<IncomingSystemEvent>);
      default:
        return this.#receiveSideEvent(event);
    }
  }

  async #receiveMessage(
    source: EndpointEvent<IncomingMessage>,
    admission?: GenerationAdmissionGate,
  ): Promise<MessageDispatchResult> {
    const receivedAt = Date.now();
    // ADR 0061 §4.1: one ledger per message, settled exactly once in `finally`.
    const ledger = new InboundOutcomeLedger({
      conversation: { ...source.payload?.conversation, endpoint: { id: source.endpoint.id, adapter: source.endpoint.adapter } },
      // A malformed event without a payload still settles an outcome (the code below then throws).
      ...(typeof source.payload?.sender?.id === 'string' ? { senderId: source.payload.sender.id } : {}),
      ...(typeof source.payload?.message?.id === 'string' ? { messageId: source.payload.message.id } : {}),
      receivedAt,
    });
    let failure: unknown;
    let failed = false;
    const lease = this.context.acquire();
    let active = true;
    let commandOperation: CommandOperationController | undefined;
    let endpointLease: EndpointChildLease | undefined;
    /** Drains the operation, releases leases and settles the outcome; a drain failure is a failure. */
    const close = async (): Promise<void> => {
      try { await commandOperation?.finish(); }
      catch (error) {
        // Without an earlier failure the drain failure is this message's failure and propagates;
        // with one, it is only logged and the original exception is the one the caller sees.
        if (failed) {
          logger.warn(formatCompact({ op: 'inbound_operation_finish_failed', error: logSafeError(error) }));
        } else {
          failed = true;
          failure = error;
          throw error;
        }
      } finally {
        active = false;
        try { endpointLease?.release(); } finally {
          this.context.release(lease);
          this.#settleOutcome(ledger, failed, failure);
        }
      }
    };
    try {
      const adapter = source.endpoint.id as CapabilityId;
      this.context.diagnostics?.begin(lease.value.generation, {
        ...source.payload.conversation,
        endpoint: { id: source.endpoint.id, adapter: source.endpoint.adapter },
      }, source.payload.message?.id);
      ledger.linkDiagnostic(this.context.diagnostics?.currentId());
      const adapters = requireAdapters(lease.value);
      const requester = adapters.owner(adapter);
      endpointLease = adapters.acquireInbound(adapter, source.client);
      const boundEndpoint = endpointLease;
      const adapterInstance = adapters.adapterForEndpoint(adapter);
      if (!adapterInstance) throw new Error('Inbound Endpoint has no owning Adapter');
      const operationSignal = AbortSignal.any([lease.stopSignal, boundEndpoint.signal]);
      // Routing identity belongs to the bound Endpoint, never to a protocol
      // normalizer's payload or a Plugin owner inferred from a CapabilityId.
      const conversation = Object.freeze({ ...source.payload.conversation,
        ...(source.payload.conversation.parent ? { parent: Object.freeze({ ...source.payload.conversation.parent }) } : {}),
        endpoint: Object.freeze({ id: source.endpoint.id, adapter: adapters.clientAdapter(adapter) }),
      });
      const sender = adapterSender(source.payload.sender);
      const { sender: _payloadSender, ...payload } = source.payload;
      const input = Object.freeze({ ...payload, conversation,
        ...(sender ? { sender } : {}),
        ...(source.payload.message ? { message: Object.freeze({ ...source.payload.message, conversation }) } : {}),
      });
      this.context.diagnostics?.identify(conversation);
      // ADR 0060 §3.3: a one-time secret is recognized before it is logged, recorded or routed.
      const secret = this.#matchSecret(input, lease.value);
      // #1250: a bind message no guard took (no open code, a group) is still logged as `绑定 ***`.
      const visibleContent = secret ? secret.redacted : redactChatIdentityBindText(input.content);
      logger.debug(formatCompact({
        op: 'receive',
        conv: formatConversationLog(conversation),
        sender: `${input.sender?.name || 'undefined'}(${input.sender?.id || 'undefined'})`,
        preview: truncatePreview(visibleContent),
      }));
      const enrichedSender = this.context.enrichSender
        ? this.context.enrichSender(input.sender, conversation, lease.value)
        : input.sender;
      // Origin is decided only from trusted state (Registry / ledger / membership port),
      // never from payload metadata or message text.
      const roomMembership = resolveRoomMembership(lease.value);
      const classified = this.context.originClassifier?.classify({
        conversation,
        sender: enrichedSender,
        messageId: input.message?.id,
        content: input.content,
      }, roomMembership);
      const origin = classified?.origin;
      this.context.diagnostics?.step('origin', origin ?? 'unclassified');
      if (origin === 'self') {
        // One of our own accounts posted the secret where others saw it: revoke it like any drop.
        await this.#discardSecret(secret);
        ledger.report({ outcome: 'ignored_self', reason: 'self_echo', stage: 'ingress' });
        this.context.diagnostics?.route('self_echo');
        logger.debug(formatCompact({
          op: 'self_echo',
          conv: formatConversationLog(conversation),
          basis: classified?.basis,
        }));
        return Object.freeze({ matched: false });
      }
      if (typeof roomMembership?.isRoomReady === 'function') {
        const readiness = roomMembership.isRoomReady({
          platform: conversation.endpoint.adapter,
          sceneType: conversation.kind,
          sceneId: conversation.id,
          ...(conversation.threadId !== undefined ? { threadId: conversation.threadId } : {}),
        });
        if (!readiness.ready) {
          await this.#discardSecret(secret);
          ledger.markAddressed(input.mentioned === true || conversation.kind === 'private');
          ledger.report({ outcome: 'dropped_unready', reason: 'venue_unready', stage: 'ingress',
            detail: readiness.unreadyEndpoints?.join(',') ?? '' });
          logger.warn(formatCompact({
            op: 'venue_unready',
            conv: formatConversationLog(conversation),
            unreadyEndpoints: readiness.unreadyEndpoints?.join(',') ?? '',
            reason: 'Venue member endpoints have not reported selfUserId yet',
          }));
          return Object.freeze({ matched: false });
        }
      }
      const { recordOnly, routedTarget } = await arbitrateRoomInboundDeduplication({
        origin,
        deduper: this.context.deduper,
        roomMembership,
        conversation,
        enrichedSender,
        incoming: input,
        routeRequest: {
          conversation,
          senderId: String(enrichedSender?.id ?? ''),
          input,
          adapters,
          generation: lease.value.generation,
          interactions: this.context.interactions,
          registry: this.context.registry,
          inboundClaimPending: this.context.inboundClaimPending,
          resolveReplyTarget: this.context.resolveReplyTarget,
        },
      });
      const mentioned = routedTarget ? true : input.mentioned;
      ledger.markAddressed(conversation.kind === 'private' || mentioned === true
        || (input.replyTo?.id !== undefined && this.context.resolveReplyTarget?.(conversation, input.replyTo.id) !== undefined));
      const locale = await messageLocale(lease.value, conversation, enrichedSender?.id);
      let operationReplied = false;
      const operationReply: RuntimeMessageOperation['reply'] = (content, replyRequester = requester, targetConversation) => {
          if (!active) throw new Error('Message reply scope has ended');
          boundEndpoint.assertActive();
          operationReplied = true;
          const effectiveConversation = targetConversation
            ? { ...targetConversation, endpoint: conversation.endpoint }
            : conversation;
          const deliver = () => this.context.deliver({
            conversation: effectiveConversation,
            [operationEndpoint]: boundEndpoint,
            requester: replyRequester,
            locale,
            content,
            incoming: {
              sender: enrichedSender,
              content: visibleContent,
              ...(secret ? {} : { segments: input.segments }),
              messageId: input.message?.id,
              timestamp: receivedAt,
              endpointId: input.endpointId,
              mentioned,
            },
          }, lease.value);
          // A held Message may reply from another async caller while its operation is
          // draining. Restore that Message's private controller, not the caller's scope.
          const delivery = commandOperation && this.context.runCommandOperation
            ? this.context.runCommandOperation(commandOperation, deliver) : deliver();
          return Promise.resolve(delivery).then((receipt) => {
            if (receipt?.status === 'sent') ledger.noteReplyDelivered(replyRequester);
            if (receipt && receipt.status !== 'sent') {
              ledger.report({ outcome: 'delivery_failed', reason: receipt.failure?.code ?? receipt.status, stage: 'delivery',
                ...(receipt.failure?.deliveryUnknown ? { facets: ['delivery_unknown'] } : {}) });
            }
            return receipt;
          });
        };
      commandOperation = this.context.commandExecution?.openOperation({
        snapshot: lease.value, conversation, senderId: enrichedSender?.id,
        retirementSignal: operationSignal, locale, reply: (owner, text) => operationReply(text, owner),
      });
      const execute = async (): Promise<MessageDispatchResult> => {
        const segments = input.segments ? Object.freeze([...input.segments]) : undefined;
        const recorded: { sequence?: number } = {};
        const message = new RuntimeMessage(
          {
            conversation,
            content: input.content,
            sender: enrichedSender,
            metadata: Object.freeze({ ...input.metadata }),
            segments,
            message: input.message,
            endpointId: input.endpointId,
            mentioned,
            replyTo: input.replyTo,
          },
          {
            generation: lease.value.generation,
            reply: operationReply,
            client: () => {
              if (!active) throw new Error('Message Client scope has ended');
              boundEndpoint.assertActive();
              return source.client;
            },
            clientAdapter: adapters.clientAdapter(adapter),
            snapshot: lease.value,
            signal: operationSignal,
            session: {
              adapter: adapterInstance,
              endpoint: boundEndpoint.endpoint,
              adapterName: adapters.clientAdapter(adapter),
              scene: conversation,
              event: input.event,
              signal: operationSignal,
              ...(enrichedSender
                ? {
                    sender: Object.freeze({
                      id: enrichedSender.id,
                      ...(enrichedSender.name !== undefined ? { name: enrichedSender.name } : {}),
                      ...(enrichedSender.platform ? { platform: enrichedSender.platform } : {}),
                      ...(enrichedSender.chatRole ? { chatRole: enrichedSender.chatRole } : {}),
                      ...(enrichedSender.chatRoleLevels ? { chatRoleLevels: enrichedSender.chatRoleLevels } : {}),
                    }),
                  }
                : {}),
              message: Object.freeze({
                text: input.content,
                receivedAt,
                ...(input.message ? { id: input.message.id, ref: input.message } : {}),
                ...(segments ? { segments } : {}),
                ...(input.platformSentAt !== undefined ? { platformSentAt: input.platformSentAt } : {}),
                ...(mentioned !== undefined ? { mentioned } : {}),
                ...(input.replyTo ? { replyTo: Object.freeze({ ...input.replyTo }) } : {}),
              }),
            },
            captureInteraction: owner => this.context.captureOperation({ target: conversation,
              client: source.client, requester: owner, signal: boundEndpoint.signal }),
            registerOperationView: commandOperation?.bind,
            // #1250 第 84 批: the message's own conversation sequence (recorded below, before any
            // command runs), so a command's operation resources can fold scene events up to it.
            createOperationResources: request => this.context.createOperationResources?.({ ...request, lease,
              ...(recorded.sequence !== undefined ? { conversationSequence: recorded.sequence } : {}) }),
            assertActive: () => {
              if (!active) throw new Error('Message author binding scope has ended');
              boundEndpoint.assertActive();
            },
            ...(origin ? { origin } : {}),
            outcomes: inboundOutcomeFacade(ledger),
            presentation: {
              locale,
              resolveCommands: (message) => this.#dispatcher.commandEnvironment(message, lease.value),
            },
          },
        );
        // A secret-bearing message never enters the conversation history.
        const conversationSequence = secret ? undefined : await this.context.recordIncoming(input, enrichedSender, {
          // ADR 0067 D8: original-text evidence only where the adapter vouches for its text segments.
          textAuthoredBySender: adapterDeclaresInboundTextAuthoredBySender(adapter, lease.value, conversation),
        });
        recorded.sequence = conversationSequence;
        let result: MessageDispatchResult = Object.freeze({ matched: false });
        let reply: InboundOutcome['reply'];
        ledger.markAddressed(isAddressedMessage(message));
        if (recordOnly === 'duplicate') {
          ledger.report({ outcome: 'dropped_duplicate', reason: 'duplicate', stage: 'ingress' });
          this.context.diagnostics?.route('duplicate');
          logger.debug(formatCompact({
            op: 'inbound_duplicate',
            conv: formatConversationLog(conversation),
            basis: recordOnly,
          }));
          return result;
        }
        if (recordOnly === 'dedup_error') {
          await this.#discardSecret(secret);
          ledger.report({ outcome: 'dropped_dedup_error', reason: 'dedup_error', stage: 'ingress' });
          this.context.diagnostics?.route('dedup_error');
          this.context.publish({
            direction: 'inbound',
            conversation,
            ...(enrichedSender !== undefined ? { sender: enrichedSender } : {}),
            contentPreview: previewMessageContent(visibleContent),
            ...(input.message?.id ? { messageId: input.message.id } : {}),
            timestamp: receivedAt,
          });
          return result;
        }
        if (origin === 'member' || origin === 'peer_bot') {
          await this.#discardSecret(secret);
          ledger.report({ outcome: 'ignored_bot', reason: origin, stage: 'ingress' });
          this.context.diagnostics?.route('bot_origin');
          logger.debug(formatCompact({
            op: 'bot_origin_recorded',
            conv: formatConversationLog(conversation),
            origin,
            basis: classified?.basis,
          }));
          this.context.publish({
            direction: 'inbound',
            conversation,
            ...(enrichedSender !== undefined ? { sender: enrichedSender } : {}),
            contentPreview: previewMessageContent(visibleContent),
            ...(input.message?.id ? { messageId: input.message.id } : {}),
            timestamp: receivedAt,
          });
          return result;
        }
        if (secret) {
          // Handled here alone: no middleware, handler, command, interaction prompt or Agent sees it.
          ledger.enter('command');
          this.context.diagnostics?.route('command');
          const content = await secret.handle(message);
          ledger.report({ outcome: 'command_replied', reason: 'secret', stage: 'command', command: secret.name, owner: lease.value.root });
          result = Object.freeze({ matched: true, status: 'executed', command: secret.name, owner: lease.value.root });
          this.context.diagnostics?.dispatch(result);
          await commandOperation?.stopProgress();
          if (content !== undefined) await message.$replyFrom(lease.value.root, content);
          this.context.publish({
            direction: 'inbound',
            conversation,
            ...(enrichedSender !== undefined ? { sender: enrichedSender } : {}),
            contentPreview: previewMessageContent(visibleContent),
            ...(input.message?.id ? { messageId: input.message.id } : {}),
            timestamp: receivedAt,
          });
          return result;
        }
        ledger.enter('interaction');
        const claimed = await this.context.inboundClaim?.(message) === true;
        const claim = claimed ? undefined : await this.#resolveClaim(message, lease.value);
        if (claimed) {
          ledger.report({ outcome: 'interaction_answered', reason: 'prompt', stage: 'interaction' });
          this.context.diagnostics?.route('interaction');
          result = interactionResult(requester);
        } else if (claim) {
          ledger.report(claim.answerLike
            ? { outcome: 'interaction_answered', reason: 'prompt', stage: 'interaction', ...(claim.owner ? { owner: claim.owner } : {}) }
            : { outcome: 'interaction_consumed', reason: 'prompt_captured', stage: 'interaction', ...(claim.owner ? { owner: claim.owner } : {}) });
          this.context.diagnostics?.route('interaction');
          if (input.message) this.context.markInteractionAnswer?.(input.message);
          result = interactionResult(requester);
        } else {
          const interactionFactory = (value: unknown) =>
            this.context.interactions.createFromUnknown(value);
          const outcome = await runInboundMiddlewareAndSpine({
            message,
            lease,
            requester,
            conversationSequence,
            admission,
            signal: operationSignal,
            interactionFactory,
            ingressRoute: this.context.resolveIngressRoute?.(lease),
            diagnostics: this.context.diagnostics,
            runHandlers: () => dispatchInboundHandlers({
              lease,
              event: 'message.receive',
              args: [withEndpointEventPayload(source, message)],
              signal: operationSignal,
              interactions: this.context.interactions,
              deliver: (req, snap) => this.context.deliver(req, snap),
            }),
            dispatchInteractive: () => dispatchInboundInteractive({
              message,
              requester,
              admission,
              snapshot: lease.value,
              interactions: this.context.interactions,
            }),
            dispatchCommand: (observe) => this.#dispatcher.dispatchWithReply(
              message,
              lease.value,
              interactionFactory,
              observe,
            ),
            suggestCommand: () => suggestCommandReply(
              message,
              lease.value,
              message.commandPrefix ?? this.#dispatcher.commandEnvironment(message, lease.value).prefix,
            ),
            hasReplied: () => operationReplied,
            findEventHandlerName: (event) =>
              handlers(lease.value)?.list().find(descriptor => descriptor.event === event)?.name,
          }, this.context.diagnostics);
          result = outcome.dispatch;
          reply = outcome.reply;
        }
        this.context.diagnostics?.dispatch(result);
        await commandOperation?.stopProgress();
        if (reply) await message.$replyFrom(reply.owner, reply.content);
        if (result.matched) {
          logger.debug(formatCompact({
            op: 'dispatched',
            conv: formatConversationLog(conversation),
            command: result.command,
          }));
        }
        this.context.publish({
          direction: 'inbound',
          conversation,
          ...(enrichedSender !== undefined ? { sender: enrichedSender } : {}),
          contentPreview: previewMessageContent(visibleContent),
          ...(input.message?.id ? { messageId: input.message.id } : {}),
          timestamp: receivedAt,
        });
        return result;
      };
      return commandOperation && this.context.runCommandOperation
        ? await this.context.runCommandOperation(commandOperation, execute) : await execute();
    } catch (error) {
      failed = true;
      failure = error;
      throw error;
    } finally {
      await close();
    }
  }

  /** The guard's match for this message; a throwing guard matches nothing (logged). */
  #matchSecret(input: IncomingMessage, snapshot: RuntimeSnapshot): InboundSecretMatch | undefined {
    const guard = this.context.inboundSecret;
    if (!guard) return undefined;
    try {
      return guard.match({ text: normalizeCommandInputText(input), prefix: this.#dispatcher.prefixOf(input, snapshot),
        conversation: input.conversation, snapshot });
    } catch (error) {
      logger.warn(formatCompact({ op: 'inbound_secret_guard_failed', error: logSafeError(error) }));
      return undefined;
    }
  }

  /**
   * ADR 0060 §3.3 (#1289 review): an Endpoint event other than a message (native platform events,
   * notices, requests and their comments, system events) that carries the secret is neither recorded
   * nor dispatched to Handlers.
   */
  #withholdSecretEvent(event: EndpointEvent): boolean {
    if (!this.#nativeCarriesSecret(event)) return false;
    logger.debug(formatCompact({ op: 'native_secret_withheld', event: event.name, endpoint: String(event.endpoint.id) }));
    return true;
  }

  #nativeCarriesSecret(event: EndpointEvent): boolean {
    const inspect = this.context.inboundSecret?.inspectNative;
    if (!inspect) return false;
    try { return inspect.call(this.context.inboundSecret, event.payload, { name: event.name }) === true; } catch (error) {
      // Fail closed: an event that cannot be inspected is not dispatched while a secret is open.
      logger.warn(formatCompact({ op: 'inbound_secret_guard_failed', error: logSafeError(error) }));
      return true;
    }
  }

  /**
   * A withheld notice, request or system event was still seen on the platform (an admin reads a join
   * request's comment): the guard revokes the secret it carries (#1291 review). `platform.receive` is
   * not revoked here: the same message's `message.receive` still reaches the claim.
   */
  async #discardNativeSecret(event: EndpointEvent): Promise<void> {
    const guard = this.context.inboundSecret;
    try { await guard?.discardNative?.(event.payload, { name: event.name }); } catch (error) {
      logger.warn(formatCompact({ op: 'inbound_secret_discard_failed', error: logSafeError(error) }));
    }
  }

  /** A dropped message's secret is revoked; a failing guard is logged, never the message's failure. */
  async #discardSecret(secret: InboundSecretMatch | undefined): Promise<void> {
    try { await secret?.discard?.(); } catch (error) {
      logger.warn(formatCompact({ op: 'inbound_secret_discard_failed', error: logSafeError(error) }));
    }
  }

  /**
   * Claim resolution with the answer classification, when the coordinator offers it. ADR 0061
   * decision 11 (revised, #1250): a command or media from the asked sender ends the prompt
   * instead (a mention alone does not); the sender is told once (throttled) and the message is processed normally.
   */
  async #resolveClaim(message: Message, snapshot: RuntimeSnapshot): Promise<{ answerLike: boolean; owner?: string } | undefined> {
    const interactions = this.context.interactions;
    if (typeof interactions.resolveClaimDetailed !== 'function') {
      return interactions.resolveClaim(message) ? { answerLike: true } : undefined;
    }
    const resolution = interactions.resolveClaimDetailed(message, undefined, {
      matchesCommand: () => this.#dispatcher.routesToCommand(message, snapshot),
    });
    if (!resolution) return undefined;
    if (!resolution.escaped) return resolution;
    logger.info(formatCompact({ op: 'interaction_interrupted', conv: formatConversationLog(message.conversation),
      owner: resolution.owner, notified: resolution.notify === true }));
    if (resolution.notify) {
      try {
        await message.$replyFrom(snapshot.root, interactionMessages(message.locale, 'exited'));
      } catch (error) {
        // The notice is a courtesy: the new message is processed whether or not it was delivered.
        logger.warn(formatCompact({ op: 'interaction_exit_notice_failed', error: logSafeError(error) }));
      }
    }
    return undefined;
  }

  /** True for the first `not_addressed` of `conv` in the minute of `at` (see {@link InboundRuntime.#quietLogged}). */
  #firstQuietThisMinute(conv: string, at: number): boolean {
    const minute = Math.floor(at / 60_000);
    if (this.#quietLogged.get(conv) === minute) return false;
    if (this.#quietLogged.size >= QUIET_LOG_CONVERSATIONS && !this.#quietLogged.has(conv)) this.#quietLogged.clear();
    this.#quietLogged.set(conv, minute);
    return true;
  }

  /** Settles the ledger once (ADR 0061 §4.1); never throws over the original failure. */
  #settleOutcome(ledger: InboundOutcomeLedger, failed: boolean, failure: unknown): void {
    let record: MessageOutcomeRecord;
    try {
      if (failed) {
        const errorId = createErrorId();
        record = ledger.settle({ error: { errorId, ...(failure instanceof Error ? { name: failure.name, message: failure.message } : { message: String(failure) }) } });
        let conv: string;
        try { conv = formatConversationLog(record.conversation); } catch { conv = 'unknown'; }
        logger.error(formatCompact({ op: 'inbound_internal_error', errorId, conv,
          messageId: record.messageId, stage: record.stage,
          error: logSafeError(failure) }));
      } else {
        record = ledger.settle();
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'test' && !failed) throw error;
      return;
    }
    try {
      this.context.diagnostics?.outcome(record);
      this.context.outcomes?.record(record);
    } catch { /* silent-ok: observer — the outcome projection never changes the message's result */ }
    let conv: string;
    try { conv = formatConversationLog(record.conversation); } catch { conv = 'unknown'; }
    const fields = { op: 'inbound_outcome', conv, messageId: record.messageId,
      outcome: record.outcome, reason: record.reason, stage: record.stage, addressed: record.addressed, errorId: record.errorId };
    if (record.outcome === 'unrecorded') {
      logger.warn(formatCompact({ ...fields, op: 'inbound_outcome_unrecorded', lastStage: record.lastStage }));
    } else if (!record.addressed && QUIET_MESSAGE_OUTCOMES.has(record.outcome)) {
      if (record.outcome === 'not_addressed' && this.#firstQuietThisMinute(conv, record.settledAt)) {
        logger.info(formatCompact({ ...fields, sampled: 'first_per_minute' }));
      } else {
        logger.debug(formatCompact(fields));
      }
    } else {
      logger.info(formatCompact(fields));
    }
  }

  async #receiveCanonicalEndpointEvent(
    source: EndpointEvent<IncomingNotice | IncomingRequest | IncomingSystemEvent>,
  ): Promise<void> {
    if (this.#withholdSecretEvent(source)) {
      await this.#discardNativeSecret(source);
      return;
    }
    const lease = this.context.acquire();
    let active = true;
    let endpointLease: EndpointChildLease | undefined;
    try {
      const adapters = requireAdapters(lease.value);
      endpointLease = adapters.acquireInbound(source.endpoint.id, source.client);
      const captured = endpointLease;
      const operationSignal = AbortSignal.any([lease.stopSignal, captured.signal]);
      const assertActive = () => {
        if (!active) throw new Error('Endpoint event context expired with its generation operation');
        captured.assertActive();
      };
      const context: EndpointEventContext = {
        endpoint: {
          id: source.endpoint.id,
          adapter: adapters.clientAdapter(source.endpoint.id),
        },
        generation: lease.value.generation,
        client: () => {
          assertActive();
          return source.client;
        },
      };
      const dispatch = async (payload: Notice | Request | SystemEvent) => {
        await dispatchInboundHandlers({
          lease,
          event: source.name,
          args: [withEndpointEventPayload(source, payload)],
          signal: operationSignal,
          interactions: this.context.interactions,
          deliver: (req, snap) => this.context.deliver(req, snap),
          captureInteraction: (owner, conversation) => {
            assertActive();
            return this.context.captureOperation({ target: conversation, client: source.client, requester: owner, signal: captured.signal });
          },
        });
      };
      await dispatchCanonicalEndpointEvent({
        source,
        context,
        assertActive,
        recordNotice: (notice) => this.context.recordNotice(notice),
        recordRequest: this.context.recordRequest ? (req) => this.context.recordRequest!(req) : undefined,
        dispatch,
      });
    } finally {
      active = false;
      try { endpointLease?.release(); } finally { this.context.release(lease); }
    }
  }

  async #receiveSideEvent(event: EndpointEvent): Promise<void> {
    if (this.#withholdSecretEvent(event)) return;
    let active = true;
    const lease = this.context.acquire();
    let endpointLease: EndpointChildLease | undefined;
    try {
      endpointLease = requireAdapters(lease.value).acquireInbound(event.endpoint.id, event.client);
      const captured = endpointLease;
      const signal = AbortSignal.any([lease.stopSignal, captured.signal]);
      const assertActive = () => {
        if (!active) throw new Error('Endpoint event context expired with its generation operation');
        captured.assertActive();
      };
      await dispatchInboundHandlers({
        lease,
        event: event.name,
        args: [withEndpointEventPayload(event, event.payload)],
        signal,
        interactions: this.context.interactions,
        deliver: (req, snap) => this.context.deliver(req, snap),
        captureInteraction: (owner, conversation) => {
          assertActive();
          return this.context.captureOperation({
            target: conversation,
            client: event.client,
            requester: owner,
            signal: captured.signal,
          });
        },
      });
    } finally {
      active = false;
      try { endpointLease?.release(); } finally { this.context.release(lease); }
    }
  }
}

/**
 * ADR 0056 §1: an Adapter reports `id`, `name` and the normalized `platform` standing only. Any
 * payload `chatRole` / `chatRoleLevels` is dropped here; only the sender enricher sets them.
 */
function adapterSender(sender: MessageSenderRef | undefined): MessageSenderRef | undefined {
  if (!sender || typeof sender !== 'object' || typeof sender.id !== 'string') return sender;
  const platform = normalizePlatformStanding((sender as { platform?: unknown }).platform);
  return Object.freeze({
    id: sender.id,
    ...(sender.name !== undefined ? { name: sender.name } : {}),
    ...(platform ? { platform } : {}),
  });
}

const MAX_LOGGED_ERROR_CHARS = 500;

/** Error text for the instance log: secrets masked (decision audit patterns), one line, bounded. */
function logSafeError(failure: unknown): string {
  const text = redactSecretText(failure instanceof Error ? failure.message : String(failure)).replace(/\p{Cc}+/gu, ' ').trim();
  const chars = [...text];
  return chars.length > MAX_LOGGED_ERROR_CHARS ? `${chars.slice(0, MAX_LOGGED_ERROR_CHARS - 1).join('')}…` : text;
}
