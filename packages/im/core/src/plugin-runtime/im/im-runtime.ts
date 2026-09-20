import {
  Scope,
  createToken,
  generationAdmissionBinder,
  type CapabilityId,
  type GenerationAdmissionGate,
  type PluginId,
  type RuntimeSnapshot,
  type SnapshotLease,
  type SnapshotReader,
} from '@zhin.js/plugin-runtime';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PermissionHost, permissionHostToken } from '@zhin.js/permission';
import { MessageBus, messageBusToken } from './message-bus.js';
import {
  type EndpointContentResolveContext,
  endpointEventGatewayToken,
  type EndpointEvent,
  type EndpointEventGateway,
} from '@zhin.js/adapter';
import {
  type ConversationEventStore,
  type ConversationEventReader,
  type ConversationContextBlock,
  type ConversationReference,
  type ConversationResolution,
  type ConversationRef,
  type DeliveryReceipt,
} from '@zhin.js/im-contract';
import { HandlerIndex, isHandlerIndex, handlerFeatureId } from '../../feature/handler.js';
import type { HandlerDispatchOptions } from '@zhin.js/handler';
import { formatCompact, getLogger, truncatePreview } from '@zhin.js/logger';
import {
  Message,
  createOutboundEnvelope,
  type IncomingMessage,
  type MessageDispatchResult,
  type OutboundMessageService,
  type MessageSenderRef,
  type SendContent,
  type SendRequest,
} from './contracts.js';
import { loginAssistToken } from './login-assist-host.js';
import { LoginAssist } from '../../built/login-assist.js';
import type { Notice } from '../../notice.js';
import type { Request } from '../../request.js';
import type { SystemEvent } from '../../system-event.js';
import { sideEventSendChannel } from '../../side-event/base.js';
import type { UserInteraction } from '@zhin.js/interaction';
import { defaultCommandPrefixResolver, MessageDispatcher } from './message-dispatcher.js';
import type { OutboundRenderer } from './outbound-renderer.js';
import {
  RuntimeInteractionCoordinator,
  type UserInteractionSource,
} from './interaction-runtime.js';
import { ConversationRuntime } from './conversation-runtime.js';
import {
  EndpointRuntime,
  requireAdapters,
} from './endpoint-runtime.js';
import {
  RuntimeMessageEventStream,
  formatConversationLog,
  previewMessageContent,
  type RuntimeMessageEvent,
  type RuntimeMessageEventSource,
} from './message-events.js';
import {
  OutboundDeliveryRuntime,
  failedDeliveryReceipt,
} from './outbound-delivery-runtime.js';
import { runRuntimeMiddleware } from './runtime-middleware.js';

const logger = getLogger('im');

/** @public Stable inbound and outbound IM gateway token for Adapter integrations. */
export const outboundMessageToken = createToken<OutboundMessageService>('zhin.im.outbound-message');

/** Generation-owned ingress hooks before ordinary dispatch and after it misses. */
export interface IngressRoute {
  preRoute?(
    message: Message,
    lease: SnapshotLease,
    requester: PluginId,
    conversationSequence: number | undefined,
  ): Promise<boolean>;
  /** A live pre-route handoff that must run before handlers and commands. */
  shouldRouteBeforeDispatch?(message: Message): boolean;
  route(
    message: Message,
    lease: SnapshotLease,
    requester: PluginId,
    conversationSequence: number | undefined,
  ): Promise<boolean>;
}

export const ingressRouteToken = createToken<IngressRoute>('zhin.im.ingress-route');

export interface ImRuntimeOptions {
  /**
   * 全局静态命令前缀（如 `'/'`）。缺省时按适配器实例 config 的
   * `commandPrefix` 解析（`endpoints[i]` 可逐项覆盖），默认 `''` 无前缀。
   */
  readonly commandPrefix?: string;
  readonly renderer?: OutboundRenderer;
  readonly conversationEvents?: ConversationEventStore;
  /** Process-root ingress claim (pending interaction, authentication challenge, etc.). */
  readonly inboundClaim?: (message: Message) => boolean | Promise<boolean>;
  /**
   * 入站 sender 增强：在构造 Message 前，将框架级角色（master / trusted）
   * 合并到 sender.roles，使整个下游链路（命令分发、agent ingress 等）都能读到完整角色。
   *
   * 返回增强后的 sender（可原样返回）。缺省时 sender 保留适配器给出的平台角色。
   */
  readonly enrichSender?: (
    sender: MessageSenderRef | undefined,
    conversation: IncomingMessage['conversation'],
    snapshot: RuntimeSnapshot,
  ) => MessageSenderRef | undefined;
}

export class ImRuntime implements OutboundMessageService {
  readonly #dispatcher: MessageDispatcher;
  readonly #messageEventStream = new RuntimeMessageEventStream();
  readonly messageEvents: RuntimeMessageEventSource = Object.freeze({
    subscribe: (listener: (event: RuntimeMessageEvent) => void) =>
      this.#messageEventStream.subscribe(listener),
  });
  readonly #interactions = new RuntimeInteractionCoordinator<GenerationAdmissionGate>();
  readonly #conversations: ConversationRuntime;
  readonly #outbound: OutboundDeliveryRuntime;
  readonly endpoints: EndpointRuntime;
  readonly #operationSnapshot = new AsyncLocalStorage<SnapshotLease>();
  #snapshots?: SnapshotReader;
  readonly #inboundClaim?: ImRuntimeOptions['inboundClaim'];
  readonly #enrichSender?: ImRuntimeOptions['enrichSender'];

  constructor(options: ImRuntimeOptions = {}) {
    this.#dispatcher = new MessageDispatcher(
      options.commandPrefix === undefined
        ? defaultCommandPrefixResolver
        : () => options.commandPrefix ?? '',
    );
    this.#conversations = new ConversationRuntime(options.conversationEvents);
    this.#outbound = new OutboundDeliveryRuntime({
      record: (request, receipt) => this.#conversations.recordOutbound(request, receipt),
      rememberFallback: (conversation, generation, map) =>
        this.#interactions.rememberFallback(conversation, generation, map),
      publish: (event) => this.#messageEventStream.publish(event),
    }, options.renderer);
    this.endpoints = new EndpointRuntime({
      acquire: () => this.#acquire(),
      release: (lease) => this.#release(lease),
      send: (request, snapshot) => this.#outbound.deliver(request, snapshot),
    });
    this.#inboundClaim = options.inboundClaim;
    this.#enrichSender = options.enrichSender;
  }

  /** Process composition replaces the bootstrap memory store after required DB activation. */
  replaceConversationEventStore(store: ConversationEventStore): void {
    this.#conversations.replaceStore(store);
  }

  get conversationEventReader(): ConversationEventReader {
    return this.#conversations.reader;
  }

  /** Pins all nested IM operations to the snapshot current at operation ingress. */
  async runWithSnapshotView<T>(operation: () => Promise<T>): Promise<T> {
    const inherited = this.#operationSnapshot.getStore();
    if (inherited?.active) return operation();
    if (!this.#snapshots) throw new Error('ImRuntime is not attached to a Root');
    const lease = this.#snapshots.acquire();
    try {
      return await this.#operationSnapshot.run(lease, operation);
    } finally {
      lease.release();
    }
  }

  async resolveConversationReference(
    lease: SnapshotLease,
    reference: ConversationReference,
    context: EndpointContentResolveContext,
  ): Promise<ConversationResolution> {
    if (!this.#snapshots?.owns(lease) || !lease.active) {
      return Object.freeze({ status: 'expired', code: 'generation_lease_expired' });
    }
    const local = await this.#conversations.resolveLocal(reference);
    if (local) return local;
    context.signal.throwIfAborted();
    const conversation = reference.kind === 'message' ? reference.message.conversation : reference.conversation;
    return requireAdapters(lease.value).resolveContent(
      conversation.endpoint.id as CapabilityId,
      reference,
      context,
    );
  }

  async readConversationContext(
    conversation: ConversationRef,
    consumer: string,
    throughSequence: number,
    limit = 50,
    excludeMessageId?: string,
  ): Promise<Readonly<{ blocks: readonly ConversationContextBlock[]; cursor: number }>> {
    return this.#conversations.readContext(
      conversation,
      consumer,
      throughSequence,
      limit,
      excludeMessageId,
    );
  }

  async commitConversationContext(
    conversation: ConversationRef,
    consumer: string,
    cursor: number,
  ): Promise<void> {
    await this.#conversations.commitContext(conversation, consumer, cursor);
  }

  attach(snapshots: SnapshotReader): void {
    if (this.#snapshots && this.#snapshots !== snapshots) {
      throw new Error('ImRuntime is already attached to another Root');
    }
    this.#snapshots = snapshots;
  }

  readonly permissionHost = new PermissionHost();
  readonly messageBus = new MessageBus();
  readonly loginAssist = new LoginAssist();

  install(resources: Scope): void {
    resources.provide(outboundMessageToken, this);
    resources.provide(endpointEventGatewayToken, this.endpointEvents);
    resources.provide(loginAssistToken, this.loginAssist);
    resources.provide(permissionHostToken, this.permissionHost);
    resources.provide(messageBusToken, this.messageBus);
  }

  /** The sole Adapter ingress, also installed as endpointEventGatewayToken. */
  readonly endpointEvents: EndpointEventGateway & {
    [generationAdmissionBinder](gate: GenerationAdmissionGate): EndpointEventGateway;
  } = (() => {
    const self = this;
    const gateway: EndpointEventGateway & {
      [generationAdmissionBinder](gate: GenerationAdmissionGate): EndpointEventGateway;
    } = {
      receive: (event) => self.receiveEndpointEvent(event),
      [generationAdmissionBinder](gate: GenerationAdmissionGate): EndpointEventGateway {
        return Object.freeze({
          receive: async (event: EndpointEvent) => gate.enter(
            () => self.receiveEndpointEvent(event, gate),
          ),
        });
      },
    };
    return gateway;
  })();

  [generationAdmissionBinder](gate: GenerationAdmissionGate): OutboundMessageService {
    const gateway: OutboundMessageService = {
      send: async (request: SendRequest) => gate.enter(() => this.send(request))
        ?? failedDeliveryReceipt('generation_not_admitted'),
      registerInteractiveHandler: (prefix, handler) =>
        this.#interactions.register(prefix, handler, gate),
    };
    return Object.freeze(gateway);
  }

  /**
   * 注册 interactive action 回跳 handler（prefix 最长匹配；返回注销函数）。
   * 在 Command dispatch 之前路由：action 段 / 数字回跳 / 指令预填 payload。
   */
  registerInteractiveHandler(
    prefix: string,
    handler: (message: Message) => Promise<boolean> | boolean,
  ): () => void {
    return this.#interactions.register(prefix, handler);
  }

  /**
   * User interaction bound to this conversation.
   * `bind.subjectId` waits for that user (e.g. master) instead of the message sender.
   */
  createInteraction(
    message: Message,
    bind?: { readonly subjectId: string },
  ): UserInteraction | undefined {
    return this.#interactions.createForMessage(message, bind);
  }

  async #receive(
    source: EndpointEvent<IncomingMessage>,
    admission?: GenerationAdmissionGate,
  ): Promise<MessageDispatchResult> {
    const input = source.payload;
    const lease = this.#acquire();
    let active = true;
    try {
      const conversation = input.conversation;
      const adapter = conversation.endpoint.id as CapabilityId;
      const requester = requireAdapters(lease.value).owner(adapter);
      logger.debug(formatCompact({
        op: 'receive',
        conv: formatConversationLog(conversation),
        sender: `${input.sender?.name||'undefined'}(${input.sender?.id||'undefined'})`,
        preview: truncatePreview(input.content),
      }));
      const enrichedSender = this.#enrichSender
        ? this.#enrichSender(input.sender, conversation, lease.value)
        : input.sender;
      const message = new Message(
        conversation,
        input.content,
        lease.value.generation,
        (content, replyRequester = requester, targetConversation) => {
          if (!active) throw new Error('Message reply scope has ended');
          const effectiveConversation = targetConversation
            ? { endpoint: conversation.endpoint, ...targetConversation }
            : conversation;
          return this.#outbound.deliver({
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
      const conversationSequence = await this.#conversations.recordIncoming(input, enrichedSender);
      let result: MessageDispatchResult = Object.freeze({ matched: false });
      const claimed = await this.#inboundClaim?.(message) === true;
      if (claimed) {
        result = Object.freeze({ matched: true, command: 'interaction', owner: requester });
      } else if (this.#interactions.resolveClaim(message)) {
        result = Object.freeze({ matched: true, command: 'interaction', owner: requester });
      } else {
        const interactionFactory = (source: unknown) => this.#interactions.createFromUnknown(source);
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
              logger.debug(formatCompact({ op: 'unmatched', conv: formatConversationLog(conversation) }));
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
      this.#messageEventStream.publish({
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
      this.#release(lease);
    }
  }

  async send(request: SendRequest): Promise<DeliveryReceipt> {
    const lease = this.#acquire();
    try {
      return await this.#outbound.deliver(request, lease.value);
    } finally {
      this.#release(lease);
    }
  }

  /** Sends through the exact generation lease that admitted the current operation. */
  async sendWithSnapshotLease(
    lease: SnapshotLease,
    request: SendRequest,
  ): Promise<DeliveryReceipt> {
    if (!this.#snapshots?.owns(lease) || !lease.active) {
      throw new Error('Outbound message generation lease expired');
    }
    return this.#outbound.deliver(request, lease.value);
  }

  async #receiveNotice(source: EndpointEvent<Notice>): Promise<void> {
    const notice = source.payload;
    await this.#conversations.recordNotice(notice);
    await this.#receiveSideEvent(withEndpointEventPayload(source, notice));
  }

  async #receiveRequest(source: EndpointEvent<Request>): Promise<void> {
    await this.#withRequestActionScope(source.payload, async (scoped) => {
      await this.#receiveSideEvent(withEndpointEventPayload(source, scoped));
    });
  }

  async #withRequestActionScope(
    request: Request,
    dispatch: (request: Request) => Promise<void>,
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
    const scoped = Object.assign(Object.create(Object.getPrototypeOf(request)), request, {
      $approve: async (remark?: string) => run(() => request.$approve(remark)),
      $reject: async (reason?: string) => run(() => request.$reject(reason)),
    }) as Request;
    try {
      await dispatch(scoped);
    } finally {
      active = false;
      await Promise.allSettled([...actions]);
    }
  }

  async #receiveSystem(source: EndpointEvent<SystemEvent>): Promise<void> {
    await this.#receiveSideEvent(source);
  }

  async #receiveSideEvent(event: EndpointEvent<Notice | Request | SystemEvent>): Promise<void> {
    const lease = this.#acquire();
    try {
      await this.#runHandlers(lease.value, event.name, [event]);
    } finally {
      this.#release(lease);
    }
  }

  async receiveEndpointEvent(
    event: EndpointEvent,
    admission?: GenerationAdmissionGate,
  ): Promise<unknown> {
    switch (event.name) {
      case 'message.receive':
        return this.#receive(event as EndpointEvent<IncomingMessage>, admission);
      case 'notice.receive':
        return this.#receiveNotice(event as EndpointEvent<Notice>);
      case 'request.receive':
        return this.#receiveRequest(event as EndpointEvent<Request>);
      case 'system.receive':
        return this.#receiveSystem(event as EndpointEvent<SystemEvent>);
      default: {
        const lease = this.#acquire();
        try {
          await this.#runHandlers(lease.value, event.name, [event]);
          return undefined;
        } finally {
          this.#release(lease);
        }
      }
    }
  }

  /**
   * User interaction bound to a side-event scene (private/group channel derived from
   * `$scene_type` / `$scene_id`). Returns undefined when outbound is unavailable.
   */
  #createInteractionForSideEvent(
    payload: Notice | Request | SystemEvent,
    snapshot: RuntimeSnapshot,
  ): UserInteraction | undefined {
    const adapter = String(payload.$adapter);
    const endpointKey = String(payload.$endpoint);
    if (!adapter || !endpointKey) return undefined;
    const channel = sideEventSendChannel(payload);
    const conversation: ConversationRef = Object.freeze({
      endpoint: Object.freeze({ adapter, id: endpointKey }),
      kind: channel.type,
      id: channel.id || endpointKey,
    });
    const requester = snapshot.root;
    const source: UserInteractionSource = Object.freeze({
      conversation,
      ...(payload.$actor?.id
        ? { sender: Object.freeze({ id: payload.$actor.id }) }
        : {}),
      $reply: (content: SendContent) => this.#outbound.deliver({
        conversation,
        requester,
        content,
      }, snapshot),
    });
    return this.#interactions.create(source);
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
        const context = interactionArgs[0] as EndpointEvent | undefined;
        const payload = context?.payload;
        if (name === 'message.receive' && payload instanceof Message) {
          return this.createInteraction(payload);
        }
        if (
          name === 'notice.receive'
          || name === 'request.receive'
          || name === 'system.receive'
        ) {
          return this.#createInteractionForSideEvent(
            payload as Notice | Request | SystemEvent,
            snapshot,
          );
        }
        return undefined;
      },
    };
    await index.dispatch(event, args, options);
  }

  /**
   * Console `GET /api/stats` 同源计数：非 root 插件节点 + AdapterIndex endpoints。
   * 供命令 / 状态卡等在 Plugin Runtime 下读取（legacy `root.adapters` / `root.children` 已不存在）。
   */
  inventory(): Readonly<{
    plugins: number;
    endpoints: { readonly total: number; readonly online: number };
  }> {
    try {
      const lease = this.#acquire();
      try {
        const plugins = [...lease.value.tree.values()]
          .filter((node) => node.parent !== undefined).length;
        const endpoints = requireAdapters(lease.value).describe();
        return Object.freeze({
          plugins,
          endpoints: Object.freeze({
            total: endpoints.length,
            online: endpoints.filter((endpoint) => endpoint.status === 'online').length,
          }),
        });
      } finally {
        this.#release(lease);
      }
    } catch {
      return Object.freeze({
        plugins: 0,
        endpoints: Object.freeze({ total: 0, online: 0 }),
      });
    }
  }

  #acquire(): SnapshotLease {
    const inherited = this.#operationSnapshot.getStore();
    if (inherited?.active) return inherited;
    if (!this.#snapshots) throw new Error('ImRuntime is not attached to a Root');
    return this.#snapshots.acquire();
  }

  #release(lease: SnapshotLease): void {
    if (this.#operationSnapshot.getStore() === lease) return;
    lease.release();
  }

  /**
   * interactive 回跳分发（Command dispatch 之前）：action 段 / owner fallback
   * 数字回跳 / 指令预填 payload → prefix 最长匹配 handler。
   */
  async #dispatchInteractive(
    message: Message,
    requester: PluginId,
    admission?: GenerationAdmissionGate,
  ): Promise<MessageDispatchResult | undefined> {
    const handled = await this.#interactions.dispatch(message, admission);
    return handled
      ? Object.freeze({ matched: true, command: 'interactive', owner: requester })
      : undefined;
  }
}

function resolveIngressRoute(snapshot: RuntimeSnapshot): IngressRoute | undefined {
  const candidate = snapshot.resources.get(snapshot.root)?.get(ingressRouteToken.id);
  return candidate
    && typeof candidate === 'object'
    && typeof (candidate as IngressRoute).route === 'function'
    ? candidate as IngressRoute
    : undefined;
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
