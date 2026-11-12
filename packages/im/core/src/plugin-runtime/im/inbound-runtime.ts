import type { EndpointChildLease, EndpointEvent, PeerRegistry } from '@zhin.js/adapter';
import type { CommandExecutionBudget, CommandOperationController } from '@zhin.js/command/internal/execution';
import type { OperationResourceView } from '@zhin.js/feature-kit';
import { normalizePlatformStanding, type DeliveryReceipt, type UserInteraction } from '@zhin.js/im-contract';
import { formatCompact, getLogger, truncatePreview } from '@zhin.js/logger';
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
  operationEndpoint,
  type CaptureEndpointOperationInput,
  type CapturedEndpointOperation,
  type IncomingMessage,
  type Message,
  type MessageDispatchResult,
  type MessageSenderRef,
  type RuntimeMessageOperation,
  type SendRequest,
} from './contracts.js';
import { requireAdapters } from './endpoint-runtime.js';
import type { InboundDeduper } from './inbound-dedup.js';
import type { InboundOriginClassifier } from './inbound-origin.js';
import {
  arbitrateRoomInboundDeduplication,
  dispatchCanonicalEndpointEvent,
  dispatchInboundHandlers,
  dispatchInboundInteractive,
  handlers,
  interactionResult,
  messageLocale,
  resolveIngressRoute,
  resolveRoomMembership,
  runInboundMiddlewareAndSpine,
  withEndpointEventPayload,
  type InboundInteractionPort,
  type InboundOutcome,
} from './inbound-spine.js';
import type { RuntimeMessageDiagnostics } from './message-diagnostics.js';
import { defaultCommandPrefixResolver, MessageDispatcher } from './message-dispatcher.js';
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
  readonly interactions: InboundInteractionPort;
  captureOperation(input: CaptureEndpointOperationInput): CapturedEndpointOperation;
  createOperationResources?(input: Readonly<{ lease: SnapshotLease; message: RuntimeMessage; owner: PluginId; signal: AbortSignal }>): OperationResourceView | undefined;
  readonly inboundClaim?: (message: Message) => boolean | Promise<boolean>;
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
  ): Promise<number | undefined>;
  recordNotice(notice: Notice): Promise<unknown>;
  /** #996: join requests into a group/channel are conversation facts too. */
  recordRequest?(request: Request): Promise<unknown>;
  /** Keep a message that answered an interaction prompt out of later agent context. */
  markInteractionAnswer?(message: NonNullable<IncomingMessage['message']>): void;
  publish(event: RuntimeMessageEvent): void;
}

/** Owns Endpoint ingress normalization, routing, dispatch, and side-event action scopes. */
export class InboundRuntime {
  readonly #dispatcher: MessageDispatcher;

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
    const lease = this.context.acquire();
    let active = true;
    let commandOperation: CommandOperationController | undefined;
    let endpointLease: EndpointChildLease | undefined;
    try {
      const adapter = source.endpoint.id as CapabilityId;
      this.context.diagnostics?.begin(lease.value.generation, {
        ...source.payload.conversation,
        endpoint: { id: source.endpoint.id, adapter: source.endpoint.adapter },
      }, source.payload.message?.id);
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
      logger.debug(formatCompact({
        op: 'receive',
        conv: formatConversationLog(conversation),
        sender: `${input.sender?.name || 'undefined'}(${input.sender?.id || 'undefined'})`,
        preview: truncatePreview(input.content),
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
              content: input.content,
              segments: input.segments,
              messageId: input.message?.id,
              timestamp: receivedAt,
              endpointId: input.endpointId,
              mentioned,
            },
          }, lease.value);
          // A held Message may reply from another async caller while its operation is
          // draining. Restore that Message's private controller, not the caller's scope.
          return commandOperation && this.context.runCommandOperation
            ? this.context.runCommandOperation(commandOperation, deliver) : deliver();
        };
      commandOperation = this.context.commandExecution?.openOperation({
        snapshot: lease.value, conversation, senderId: enrichedSender?.id,
        retirementSignal: operationSignal, locale, reply: (owner, text) => operationReply(text, owner),
      });
      const execute = async (): Promise<MessageDispatchResult> => {
        const segments = input.segments ? Object.freeze([...input.segments]) : undefined;
        const authorizationRoles = enrichedSender?.roles?.filter(role => role === 'master' || role === 'trusted' || role === 'user');
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
                      ...(authorizationRoles
                        ? { authorizationRoles: Object.freeze(authorizationRoles) }
                        : {}),
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
            createOperationResources: request => this.context.createOperationResources?.({ ...request, lease }),
            assertActive: () => {
              if (!active) throw new Error('Message author binding scope has ended');
              boundEndpoint.assertActive();
            },
            ...(origin ? { origin } : {}),
            presentation: {
              locale,
              resolveCommands: (message) => this.#dispatcher.commandEnvironment(message, lease.value),
            },
          },
        );
        const conversationSequence = await this.context.recordIncoming(input, enrichedSender);
        let result: MessageDispatchResult = Object.freeze({ matched: false });
        let reply: InboundOutcome['reply'];
        if (recordOnly === 'duplicate') {
          this.context.diagnostics?.route('duplicate');
          logger.debug(formatCompact({
            op: 'inbound_duplicate',
            conv: formatConversationLog(conversation),
            basis: recordOnly,
          }));
          return result;
        }
        if (recordOnly === 'dedup_error') {
          this.context.diagnostics?.route('dedup_error');
          this.context.publish({
            direction: 'inbound',
            conversation,
            ...(input.sender !== undefined ? { sender: input.sender } : {}),
            contentPreview: previewMessageContent(input.content),
            ...(input.message?.id ? { messageId: input.message.id } : {}),
            timestamp: receivedAt,
          });
          return result;
        }
        if (origin === 'member' || origin === 'peer_bot') {
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
            ...(input.sender !== undefined ? { sender: input.sender } : {}),
            contentPreview: previewMessageContent(input.content),
            ...(input.message?.id ? { messageId: input.message.id } : {}),
            timestamp: receivedAt,
          });
          return result;
        }
        const claimed = await this.context.inboundClaim?.(message) === true;
        if (claimed) {
          this.context.diagnostics?.route('interaction');
          result = interactionResult(requester);
        } else if (this.context.interactions.resolveClaim(message)) {
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
            ingressRoute: resolveIngressRoute(lease.value),
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
          ...(input.sender !== undefined ? { sender: input.sender } : {}),
          contentPreview: previewMessageContent(input.content),
          ...(input.message?.id ? { messageId: input.message.id } : {}),
          timestamp: receivedAt,
        });
        return result;
      };
      return commandOperation && this.context.runCommandOperation
        ? await this.context.runCommandOperation(commandOperation, execute) : await execute();
    } finally {
      try { await commandOperation?.finish(); }
      finally {
        active = false;
        try { endpointLease?.release(); } finally { this.context.release(lease); }
      }
    }
  }

  async #receiveCanonicalEndpointEvent(
    source: EndpointEvent<IncomingNotice | IncomingRequest | IncomingSystemEvent>,
  ): Promise<void> {
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
 * ADR 0056 §1: an Adapter reports `id`, `name` and the normalized `platform` standing only.
 * Framework roles (`roles`) come from the runtime's sender enrichment, never from the payload.
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
