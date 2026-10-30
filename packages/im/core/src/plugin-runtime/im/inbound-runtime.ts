import type {
  CapabilityId,
  GenerationAdmissionGate,
  PluginId,
  RuntimeSnapshot,
  SnapshotLease,
} from '@zhin.js/plugin-runtime';
import type { EndpointEvent, PeerRegistry, EndpointChildLease } from '@zhin.js/adapter';
import { operationEndpoint } from './operation-endpoint.js';
import { isMiddlewareIndex, middlewareFeatureId } from '@zhin.js/middleware';
import { HandlerIndex, isHandlerIndex, handlerFeatureId } from '../../feature/handler.js';
import type { HandlerDispatchOptions } from '@zhin.js/handler';
import { bindOperationInput, operationInputBinding } from '@zhin.js/feature-kit';
import { formatCompact, getLogger, truncatePreview } from '@zhin.js/logger';
import type { DeliveryReceipt } from '@zhin.js/im-contract';
import type { UserInteraction } from '@zhin.js/interaction';
import type { CommandExecutionBudget, CommandOperationController } from '@zhin.js/command/internal/execution';
import { RuntimeNotice, type IncomingNotice, type Notice } from '../../notice.js';
import { RuntimeRequest, type IncomingRequest, type Request } from '../../request.js';
import { RuntimeSystemEvent, type IncomingSystemEvent, type SystemEvent } from '../../system-event.js';
import type { EndpointEventContext } from '../../side-event/base.js';
import {
  RuntimeMessage,
  type Message,
  type IncomingMessage,
  type MessageDispatchResult,
  type MessageSenderRef,
  type SendContent,
  type SendRequest,
} from './contracts.js';
import { defaultCommandPrefixResolver, MessageDispatcher } from './message-dispatcher.js';
import { messageLocale } from './locale.js';
import type { RuntimeMessageDiagnostics } from './message-diagnostics.js';
import type {
  RuntimeInteractionCoordinator,
  UserInteractionSource,
} from './interaction-runtime.js';
import { requireAdapters } from './endpoint-runtime.js';
import {
  formatConversationLog,
  previewMessageContent,
  type RuntimeMessageEvent,
} from './message-events.js';
import { resolveIngressRoute } from './ingress-route.js';
import type { InboundDeduper } from './inbound-dedup.js';
import { actionPayloadFromSegments } from './interactive-router.js';
import { readMentionSegmentTarget } from '../../built/segment-contract/mention.js';
import {
  roomMembershipToken,
  type InboundOriginClassifier,
  type RoomInboundRouteInput,
  type RoomMembershipPort,
} from './inbound-origin.js';

const logger = getLogger('im.inbound');

type InboundInteractionPort = Pick<
  RuntimeInteractionCoordinator<GenerationAdmissionGate>,
  'create' | 'createForMessage' | 'createFromUnknown' | 'dispatch' | 'resolveClaim'
> & Partial<Pick<RuntimeInteractionCoordinator<GenerationAdmissionGate>, 'hasPendingAnswer'>>;

interface InboundRuntimeContext {
  readonly commandExecution?: CommandExecutionBudget;
  runCommandOperation?<T>(controller: CommandOperationController, operation: () => T): T;
  readonly diagnostics?: RuntimeMessageDiagnostics;
  readonly interactions: InboundInteractionPort;
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

interface InboundOutcome {
  readonly dispatch: MessageDispatchResult;
  readonly reply?: { readonly owner: PluginId; readonly content: SendContent };
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

  #routeInput(
    conversation: IncomingMessage['conversation'],
    senderId: string,
    input: IncomingMessage,
    adapters: ReturnType<typeof requireAdapters>,
    generation: number,
  ): RoomInboundRouteInput {
    const mentionTargets = (input.segments ?? [])
      .map((segment) => readMentionSegmentTarget(segment as { type: unknown; data?: unknown }))
      .filter((target) => target !== '' && target !== 'all');
    const replyToId = input.replyTo?.id;
    const replyToEndpointId = replyToId !== undefined && this.context.resolveReplyTarget
      ? this.context.resolveReplyTarget(conversation, replyToId)
      : undefined;
    const registry = this.context.registry;
    return {
      conversation,
      senderId,
      content: input.content,
      mentionTargets,
      ...(replyToEndpointId !== undefined ? { replyToEndpointId } : {}),
      pending: (endpointId) => {
        // Registry/index skew or a throwing probe must never fail the whole message closed:
        // an Endpoint we cannot probe simply has nothing pending.
        try {
          const adapter = adapters.clientAdapter(endpointId as CapabilityId);
          const probe = Object.freeze({ ...conversation, endpoint: Object.freeze({ id: endpointId, adapter }) });
          return this.context.interactions.hasPendingAnswer?.(
            probe, senderId, generation, { content: input.content, segments: input.segments },
          ) === true || this.context.inboundClaimPending?.(probe, senderId) === true;
        } catch {
          return false;
        }
      },
      accountOf: (endpointId) => registry?.selfOf(endpointId),
      isAvailable: (endpointId) => registry?.isReady(endpointId) === true,
    };
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
      const operationSignal = AbortSignal.any([lease.retirementSignal, boundEndpoint.signal]);
      // Routing identity belongs to the bound Endpoint, never to a protocol
      // normalizer's payload or a Plugin owner inferred from a CapabilityId.
      const conversation = Object.freeze({ ...source.payload.conversation,
        endpoint: Object.freeze({ id: source.endpoint.id, adapter: adapters.clientAdapter(adapter) }),
      });
      const input = Object.freeze({ ...source.payload, conversation,
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
      // Must stay synchronous and before any await: concurrent arrivals of the same
      // message from N Endpoints are decided atomically. Only human origin claims,
      // so bot-origin messages never consume the key. Scoped to Room conversations:
      // outside a Room each Endpoint keeps handling its own copy (mention / interaction
      // state is relative to the receiving Endpoint).
      let recordOnly: 'duplicate' | 'dedup_error' | undefined;
      // Set when the Room Router picked this Endpoint (or a fallback took over for it): `mentioned`
      // is relative to the receiving Endpoint, so the copy is forced to mentioned=true or AI ingress
      // would not trigger.
      let routedTarget = false;
      let pendingSettle: { readonly target: string; readonly listed: boolean; readonly settle: () => Promise<'handle' | 'duplicate'> } | undefined;
      // Action segments are only ever produced by an adapter from a platform callback structure
      // (e.g. Telegram callback_query); a plain text message cannot carry one. Such a callback is
      // delivered only to the Endpoint that sent the keyboard, and only that Endpoint holds the
      // keyboard's JSX registry / fallback. It is handled where it arrived: never routed elsewhere,
      // never claimed, never turned into a duplicate, never forced to mentioned.
      const platformCallback = actionPayloadFromSegments(input.segments) !== undefined;
      if ((origin === 'human' || origin === undefined) && this.context.deduper && !platformCallback
        && (conversation.kind === 'group' || conversation.kind === 'channel')) {
        try {
          if (roomMembership?.hasRoom?.(conversation) === true) {
            const senderId = String(enrichedSender?.id ?? '');
            const deduper = this.context.deduper;
            if (typeof roomMembership.route === 'function' && typeof deduper.arbitrate === 'function') {
              const route = roomMembership.route.bind(roomMembership);
              const routeInput = this.#routeInput(conversation, senderId, input, adapters, lease.value.generation);
              const verdict = deduper.arbitrate(conversation, senderId, input.message?.id, () => {
                try {
                  const decision = route(routeInput);
                  return decision
                    ? { target: decision.endpointId, fallbacks: decision.fallbackEndpointIds ?? [] }
                    : undefined;
                } catch (error) {
                  // A broken router must not drop the message: degrade to first-come-first-served.
                  logger.warn(formatCompact({
                    op: 'room_route_error',
                    conv: formatConversationLog(conversation),
                    error: error instanceof Error ? error.message : String(error),
                  }));
                  return undefined;
                }
              });
              switch (verdict.kind) {
                case 'handle':
                  routedTarget = verdict.routed;
                  break;
                case 'duplicate':
                  recordOnly = 'duplicate';
                  logger.debug(formatCompact({
                    op: 'room_non_target_copy',
                    conv: formatConversationLog(conversation),
                  }));
                  break;
                case 'wait':
                  pendingSettle = verdict;
                  break;
                case 'unkeyed':
                  // Known limitation: no message id / sender / private chat cannot be arbitrated,
                  // so each Endpoint keeps handling its own copy (may duplicate, never drops).
                  break;
              }
            } else {
              const claim = deduper.claim(conversation, senderId, input.message?.id);
              if (claim === 'duplicate') recordOnly = 'duplicate';
            }
          }
        } catch (error) {
          logger.warn(formatCompact({
            op: 'inbound_dedup_error',
            conv: formatConversationLog(conversation),
            error: error instanceof Error ? error.message : String(error),
          }));
          recordOnly = 'dedup_error';
        }
      }
      if (pendingSettle) {
        // The Router's target had not delivered its copy yet. Wait (grace period, a couple of
        // seconds at most, lease held) for it; if it never shows up this copy takes over so the
        // message is not lost. Nothing has been recorded yet, so a duplicate stays history-only.
        const outcome = await pendingSettle.settle();
        if (outcome === 'handle') {
          routedTarget = true;
          if (!pendingSettle.listed) {
            logger.warn(formatCompact({
              op: 'room_unlisted_member_takeover',
              conv: formatConversationLog(conversation),
              target: pendingSettle.target,
              takeover: conversation.endpoint.id,
            }));
          }
          logger.debug(formatCompact({
            op: 'room_target_missing_takeover',
            conv: formatConversationLog(conversation),
            target: pendingSettle.target,
            takeover: conversation.endpoint.id,
          }));
        } else {
          recordOnly = 'duplicate';
        }
      }
      const mentioned = routedTarget ? true : input.mentioned;
      const locale = await messageLocale(lease.value, conversation, enrichedSender?.id);
      const operationReply: ConstructorParameters<typeof RuntimeMessage>[3] = (content, replyRequester = requester, targetConversation) => {
          if (!active) throw new Error('Message reply scope has ended');
          boundEndpoint.assertActive();
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
        retirementSignal: operationSignal, reply: (owner, text) => operationReply(text, owner),
      });
      const execute = async (): Promise<MessageDispatchResult> => {
        const message = new RuntimeMessage(
          conversation,
          input.content,
          lease.value.generation,
          operationReply,
          enrichedSender,
          Object.freeze({ ...input.metadata }),
          input.segments ? Object.freeze([...input.segments]) : undefined,
          input.message,
          input.endpointId,
          mentioned,
          input.replyTo,
          (): unknown => {
            if (!active) throw new Error('Message Client scope has ended');
            boundEndpoint.assertActive();
            return source.client;
          },
          source.endpoint.adapter,
          { snapshot: lease.value, locale,
            resolveCommands: (message) => this.#dispatcher.commandEnvironment(message, lease.value),
            retirementSignal: operationSignal,
            session: { adapter: adapterInstance, endpoint: boundEndpoint.endpoint,
              adapterName: adapters.clientAdapter(adapter), event: input.event, receivedAt,
              platformSentAt: input.platformSentAt,
              platformRoles: input.sender?.roles?.filter(role => role !== 'master' && role !== 'trusted' && role !== 'user'),
              authorizationRoles: enrichedSender?.roles?.filter(role => role === 'master' || role === 'trusted' || role === 'user'),
              signal: operationSignal },
            registerOperationView: commandOperation?.bind, assertActive: () => {
            if (!active) throw new Error('Message author binding scope has ended');
            boundEndpoint.assertActive();
          }, ...(origin ? { origin } : {}) },
        );
        const conversationSequence = await this.context.recordIncoming(input, enrichedSender);
        let result: MessageDispatchResult = Object.freeze({ matched: false });
        let reply: InboundOutcome['reply'];
        if (recordOnly === 'duplicate') {
          this.context.diagnostics?.route('duplicate');
          // Duplicate of a message already routed via another Endpoint: history only,
          // no publish (avoids N copies in the console message feed).
          logger.debug(formatCompact({
            op: 'inbound_duplicate',
            conv: formatConversationLog(conversation),
            basis: recordOnly,
          }));
          return result;
        }
        if (recordOnly === 'dedup_error') {
          this.context.diagnostics?.route('dedup_error');
          // Undecidable: record only and never route (no duplicate routing), but publish so
          // the console feed still shows the message and a persistent failure is visible.
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
          // Bot-origin messages are recorded as chat history only: no claim, handlers,
          // commands, middleware or ingress route (prevents bot-to-bot loops).
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
          const terminal = async (): Promise<InboundOutcome> => {
              const ingressRoute = resolveIngressRoute(lease.value);
              const preRouted = await ingressRoute?.preRoute?.(
                message,
                lease,
                requester,
                conversationSequence,
              ) === true;
              if (preRouted) {
                this.context.diagnostics?.route('agent');
                result = Object.freeze({ matched: true, command: 'pre-route', owner: requester });
                return { dispatch: result };
              }
              if (ingressRoute?.shouldRouteBeforeDispatch?.(message) === true) {
                const handled = await ingressRoute.route(
                  message,
                  lease,
                  requester,
                  conversationSequence,
                );
                if (handled) {
                  this.context.diagnostics?.route('agent');
                  result = Object.freeze({ matched: true, command: 'ai', owner: requester });
                  return { dispatch: result };
                }
              }
              this.context.diagnostics?.step('handlers', 'started');
              await this.#runHandlers(lease, 'message.receive', [
                withEndpointEventPayload(source, message),
              ]);
              this.context.diagnostics?.step('handlers', 'completed');
              const interactive = await this.#dispatchInteractive(message, requester, admission, lease.value);
              if (interactive) this.context.diagnostics?.route('interaction');
              const dispatched = interactive ? undefined : await this.#dispatcher.dispatchWithReply(message, lease.value, interactionFactory,
                (stage, status) => this.context.diagnostics?.step(stage, status));
              result = interactive ?? dispatched!.dispatch;
              if (!result.matched && ingressRoute) {
                logger.debug(formatCompact({
                  op: 'unmatched',
                  conv: formatConversationLog(conversation),
                }));
                const handled = await ingressRoute.route(
                  message,
                  lease,
                  requester,
                  conversationSequence,
                );
                if (handled) {
                  this.context.diagnostics?.route('agent');
                  result = Object.freeze({ matched: true, command: 'ai', owner: requester });
                }
              }
              const response = dispatched?.reply ?? (interactive?.value !== undefined && interactive.owner
                ? { owner: interactive.owner, content: interactive.value as SendContent } : undefined);
              return {
                dispatch: result,
                ...(response ? { reply: response } : {}),
              };
          };
          const middleware = lease.value.projections.get(middlewareFeatureId);
          if (isMiddlewareIndex(middleware)) this.context.diagnostics?.step('middleware', 'entered');
          const outcome = isMiddlewareIndex(middleware)
            ? await middleware.runInbound(message, terminal, {
                stop: (owner): InboundOutcome => {
                  this.context.diagnostics?.route('middleware');
                  this.context.diagnostics?.step('middleware', 'stopped');
                  return { dispatch: { matched: true, command: 'middleware', owner } };
                },
                replace: (owner, value, downstream): InboundOutcome => {
                  this.context.diagnostics?.step('middleware', 'replaced');
                  if (!downstream?.dispatch.matched) this.context.diagnostics?.route('middleware');
                  return {
                    dispatch: downstream?.dispatch.matched
                      ? downstream.dispatch
                      : { matched: true, command: 'middleware', owner },
                    reply: { owner, content: value as SendContent },
                  };
                },
              }, lease.value)
            : await terminal();
          result = outcome.dispatch;
          if (isMiddlewareIndex(middleware)) this.context.diagnostics?.step('middleware', 'completed');
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
      const operationSignal = AbortSignal.any([lease.retirementSignal, captured.signal]);
      const assertActive = () => {
        if (!active) throw new Error('Endpoint event context expired with its generation operation');
        // A held Root callback may drain across Root retirement; a retired child may not.
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
        await this.#runHandlers(lease, source.name, [withEndpointEventPayload(source, payload)], operationSignal);
      };
      if (source.payload.type !== source.name.split('.')[0]) {
        throw new TypeError('Endpoint event payload type does not match its gateway event');
      }
      switch (source.payload.type) {
        case 'notice': {
          const notice = new RuntimeNotice(source.payload, context);
          await this.context.recordNotice(notice);
          await dispatch(notice);
          break;
        }
        case 'request':
          await withRequestActionScope(source.payload, async (input) => {
            const request = new RuntimeRequest(input, context);
            // Recording is best effort and must not delay the request handlers.
            const recording = Promise.resolve(this.context.recordRequest?.(request)).catch(() => undefined);
            try {
              await dispatch(request);
            } finally {
              await recording;
            }
          }, assertActive);
          break;
        case 'system':
          await dispatch(new RuntimeSystemEvent(source.payload, context));
          break;
      }
    } finally {
      active = false;
      try { endpointLease?.release(); } finally { this.context.release(lease); }
    }
  }

  async #receiveSideEvent(event: EndpointEvent): Promise<void> {
    const lease = this.context.acquire();
    try {
      await this.#runHandlers(lease, event.name, [event]);
    } finally {
      this.context.release(lease);
    }
  }

  async #runHandlers(
    lease: SnapshotLease,
    event: string,
    args: readonly unknown[],
    retirementSignal: AbortSignal = lease.retirementSignal,
  ): Promise<void> {
    const snapshot = lease.value;
    const index = handlers(snapshot);
    if (!index) return;
    const options: HandlerDispatchOptions = {
      snapshot,
      resolveInteraction: (name, interactionArgs, owner) => {
        const eventContext = interactionArgs[0] as EndpointEvent | undefined;
        const payload = eventContext?.payload;
        if (name === 'message.receive' && payload instanceof RuntimeMessage) {
          return this.context.interactions.createFromUnknown(bindOperationInput(payload, owner, snapshot));
        }
        if (
          name === 'notice.receive'
          || name === 'request.receive'
        ) {
          return this.#createInteractionForSideEvent(
            payload as Notice | Request,
            snapshot,
            owner,
            retirementSignal,
          );
        }
        return undefined;
      },
    };
    await index.dispatch(event, args, options);
  }

  #createInteractionForSideEvent(
    payload: Notice | Request,
    snapshot: RuntimeSnapshot,
    requester: PluginId,
    retirementSignal: AbortSignal,
  ): UserInteraction | undefined {
    const conversation = payload.conversation;
    if (!conversation) return undefined;
    const source: UserInteractionSource = Object.freeze({
      conversation,
      ...(payload.actor?.id
        ? { sender: Object.freeze({ id: payload.actor.id }) }
        : {}),
      $reply: (content: SendContent) => this.context.deliver({
        conversation,
        requester,
        content,
      }, snapshot),
    });
    return this.context.interactions.create(source, undefined, { snapshot, owner: requester, retirementSignal });
  }

  async #dispatchInteractive(
    message: Message,
    requester: PluginId,
    admission?: GenerationAdmissionGate,
    snapshot?: RuntimeSnapshot,
  ): Promise<MessageDispatchResult | undefined> {
    const handled = await this.context.interactions.dispatch(message, admission, snapshot);
    return handled
      ? Object.freeze({ matched: true, command: 'interactive', owner: requester })
      : undefined;
  }
}

function resolveRoomMembership(snapshot: RuntimeSnapshot): RoomMembershipPort | undefined {
  try {
    const candidate = snapshot.resources.get(snapshot.root)?.get(roomMembershipToken.id);
    return candidate
      && typeof candidate === 'object'
      && typeof (candidate as RoomMembershipPort).isMember === 'function'
      ? candidate as RoomMembershipPort
      : undefined;
  } catch {
    return undefined;
  }
}

function interactionResult(requester: PluginId): MessageDispatchResult {
  return Object.freeze({ matched: true, command: 'interaction', owner: requester });
}

async function withRequestActionScope(
  request: IncomingRequest,
  dispatch: (request: IncomingRequest) => Promise<void>,
  assertOperation: () => void,
): Promise<void> {
  let active = true;
  const actions = new Set<Promise<void>>();
  const run = (action: () => void | Promise<void>): Promise<void> => {
    if (!active) throw new Error('Request action port expired with its generation operation');
    const operation = Promise.resolve().then(() => { assertOperation(); return action(); });
    actions.add(operation);
    void operation.then(
      () => actions.delete(operation),
      () => actions.delete(operation),
    );
    return operation;
  };
  const scoped: IncomingRequest = Object.freeze({ ...request,
    $approve: async (remark?: string) => run(() => request.$approve(remark)),
    $reject: async (reason?: string) => run(() => request.$reject(reason)),
  });
  try {
    await dispatch(scoped);
  } finally {
    active = false;
    await Promise.allSettled([...actions]);
  }
}

function handlers(snapshot: RuntimeSnapshot): HandlerIndex | undefined {
  const projection = snapshot.projections.get(handlerFeatureId);
  return isHandlerIndex(projection) ? projection : undefined;
}

function withEndpointEventPayload<TPayload, TClient, TName extends string>(
  source: EndpointEvent<unknown, TClient, TName>,
  payload: TPayload,
): EndpointEvent<TPayload, TClient, TName> {
  return Object.freeze({
    name: source.name,
    payload,
    endpoint: source.endpoint,
    client: source.client,
    [operationInputBinding]: (owner: PluginId, snapshot: RuntimeSnapshot) =>
      withEndpointEventPayload(source, bindOperationInput(payload, owner, snapshot)),
  });
}
