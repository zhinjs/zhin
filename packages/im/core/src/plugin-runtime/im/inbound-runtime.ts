import type {
  CapabilityId,
  GenerationAdmissionGate,
  PluginId,
  RuntimeSnapshot,
  SnapshotLease,
} from '@zhin.js/plugin-runtime';
import type { EndpointEvent } from '@zhin.js/adapter';
import { HandlerIndex, isHandlerIndex, handlerFeatureId } from '../../feature/handler.js';
import type { HandlerDispatchOptions } from '@zhin.js/handler';
import { formatCompact, getLogger, truncatePreview } from '@zhin.js/logger';
import type { DeliveryReceipt } from '@zhin.js/im-contract';
import type { UserInteraction } from '@zhin.js/interaction';
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
import { runRuntimeMiddleware } from './runtime-middleware.js';

const logger = getLogger('im.inbound');

type InboundInteractionPort = Pick<
  RuntimeInteractionCoordinator<GenerationAdmissionGate>,
  'create' | 'createForMessage' | 'createFromUnknown' | 'dispatch' | 'resolveClaim'
>;

interface InboundRuntimeContext {
  readonly interactions: InboundInteractionPort;
  readonly inboundClaim?: (message: Message) => boolean | Promise<boolean>;
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
  recordNotice(notice: Notice): Promise<void>;
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
        return this.#receiveMessage(event as EndpointEvent<IncomingMessage>, admission);
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
    const input = source.payload;
    const lease = this.context.acquire();
    let active = true;
    try {
      const conversation = input.conversation;
      const adapter = conversation.endpoint.id as CapabilityId;
      const requester = requireAdapters(lease.value).owner(adapter);
      logger.debug(formatCompact({
        op: 'receive',
        conv: formatConversationLog(conversation),
        sender: `${input.sender?.name || 'undefined'}(${input.sender?.id || 'undefined'})`,
        preview: truncatePreview(input.content),
      }));
      const enrichedSender = this.context.enrichSender
        ? this.context.enrichSender(input.sender, conversation, lease.value)
        : input.sender;
      const message = new RuntimeMessage(
        conversation,
        input.content,
        lease.value.generation,
        (content, replyRequester = requester, targetConversation) => {
          if (!active) throw new Error('Message reply scope has ended');
          const effectiveConversation = targetConversation
            ? { endpoint: conversation.endpoint, ...targetConversation }
            : conversation;
          return this.context.deliver({
            conversation: effectiveConversation,
            requester: replyRequester,
            content,
            incoming: {
              sender: enrichedSender,
              content: input.content,
              segments: input.segments,
              messageId: input.message?.id,
              timestamp: Date.now(),
              endpointId: input.endpointId,
              mentioned: input.mentioned,
            },
          }, lease.value);
        },
        enrichedSender,
        Object.freeze({ ...input.metadata }),
        input.segments ? Object.freeze([...input.segments]) : undefined,
        input.message,
        input.endpointId,
        input.mentioned,
        input.replyTo,
        (): unknown => {
          if (!active) throw new Error('Message Client scope has ended');
          return source.client;
        },
        source.endpoint.adapter,
      );
      const conversationSequence = await this.context.recordIncoming(input, enrichedSender);
      let result: MessageDispatchResult = Object.freeze({ matched: false });
      const claimed = await this.context.inboundClaim?.(message) === true;
      if (claimed) {
        result = interactionResult(requester);
      } else if (this.context.interactions.resolveClaim(message)) {
        result = interactionResult(requester);
      } else {
        const interactionFactory = (value: unknown) =>
          this.context.interactions.createFromUnknown(value);
        await runRuntimeMiddleware(
          lease.value,
          message,
          async () => {
            const ingressRoute = resolveIngressRoute(lease.value);
            const preRouted = await ingressRoute?.preRoute?.(
              message,
              lease,
              requester,
              conversationSequence,
            ) === true;
            if (preRouted) {
              result = Object.freeze({ matched: true, command: 'pre-route', owner: requester });
              return;
            }
            if (ingressRoute?.shouldRouteBeforeDispatch?.(message) === true) {
              const handled = await ingressRoute.route(
                message,
                lease,
                requester,
                conversationSequence,
              );
              if (handled) {
                result = Object.freeze({ matched: true, command: 'ai', owner: requester });
                return;
              }
            }
            await this.#runHandlers(lease.value, 'message.receive', [
              withEndpointEventPayload(source, message),
            ]);
            result = await this.#dispatchInteractive(message, requester, admission)
              ?? await this.#dispatcher.dispatch(message, lease.value, interactionFactory);
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
                result = Object.freeze({ matched: true, command: 'ai', owner: requester });
              }
            }
          },
          'inbound',
        );
      }
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
        timestamp: Date.now(),
      });
      return result;
    } finally {
      active = false;
      this.context.release(lease);
    }
  }

  async #receiveCanonicalEndpointEvent(
    source: EndpointEvent<IncomingNotice | IncomingRequest | IncomingSystemEvent>,
  ): Promise<void> {
    const lease = this.context.acquire();
    let active = true;
    try {
      const context: EndpointEventContext = {
        endpoint: {
          id: source.endpoint.id,
          adapter: String(requireAdapters(lease.value).owner(source.endpoint.id)),
        },
        generation: lease.value.generation,
        client: () => {
          if (!active) throw new Error('Endpoint event Client context expired with its generation operation');
          return source.client;
        },
      };
      const dispatch = async (payload: Notice | Request | SystemEvent) => {
        await this.#runHandlers(lease.value, source.name, [withEndpointEventPayload(source, payload)]);
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
            await dispatch(new RuntimeRequest(input, context));
          });
          break;
        case 'system':
          await dispatch(new RuntimeSystemEvent(source.payload, context));
          break;
      }
    } finally {
      active = false;
      this.context.release(lease);
    }
  }

  async #receiveSideEvent(event: EndpointEvent): Promise<void> {
    const lease = this.context.acquire();
    try {
      await this.#runHandlers(lease.value, event.name, [event]);
    } finally {
      this.context.release(lease);
    }
  }

  async #runHandlers(
    snapshot: RuntimeSnapshot,
    event: string,
    args: readonly unknown[],
  ): Promise<void> {
    const index = handlers(snapshot);
    if (!index) return;
    const options: HandlerDispatchOptions = {
      resolveInteraction: (name, interactionArgs) => {
        const eventContext = interactionArgs[0] as EndpointEvent | undefined;
        const payload = eventContext?.payload;
        if (name === 'message.receive' && payload instanceof RuntimeMessage) {
          return this.createInteraction(payload);
        }
        if (
          name === 'notice.receive'
          || name === 'request.receive'
        ) {
          return this.#createInteractionForSideEvent(
            payload as Notice | Request,
            snapshot,
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
  ): UserInteraction | undefined {
    const conversation = payload.conversation;
    if (!conversation) return undefined;
    const requester = snapshot.root;
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
    return this.context.interactions.create(source);
  }

  async #dispatchInteractive(
    message: Message,
    requester: PluginId,
    admission?: GenerationAdmissionGate,
  ): Promise<MessageDispatchResult | undefined> {
    const handled = await this.context.interactions.dispatch(message, admission);
    return handled
      ? Object.freeze({ matched: true, command: 'interactive', owner: requester })
      : undefined;
  }
}

function interactionResult(requester: PluginId): MessageDispatchResult {
  return Object.freeze({ matched: true, command: 'interaction', owner: requester });
}

async function withRequestActionScope(
  request: IncomingRequest,
  dispatch: (request: IncomingRequest) => Promise<void>,
): Promise<void> {
  let active = true;
  const actions = new Set<Promise<void>>();
  const run = (action: () => void | Promise<void>): Promise<void> => {
    if (!active) throw new Error('Request action port expired with its generation operation');
    const operation = Promise.resolve().then(action);
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
  });
}
