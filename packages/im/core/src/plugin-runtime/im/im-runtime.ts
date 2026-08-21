import {
  Scope,
  createToken,
  generationAdmissionBinder,
  htmlRendererToken,
  type CapabilityId,
  type GenerationAdmissionGate,
  type HtmlRendererHost,
  type PluginId,
  type RuntimeSnapshot,
  type SnapshotLease,
  type SnapshotReader,
} from '@zhin.js/plugin-runtime';
import { createPermissionHost, permissionHostToken } from '@zhin.js/permission';
import { MessageBus, messageBusToken } from './message-bus.js';
import {
  AdapterIndex,
  adapterFeatureId,
  isAdapterIndex,
  endpointControlOf,
  resolveEndpointManagement,
  type EndpointControl,
  type EndpointManagement,
  type EndpointManagementCapability,
  type AdapterEndpointPhase,
  type EndpointContentResolveContext,
} from '@zhin.js/adapter';
import {
  MemoryConversationEventStore,
  conversationRefKey,
  messageRefKey,
  type ConversationEventStore,
  type ConversationEvent,
  type ConversationContextBlock,
  type ConversationMessage,
  type ConversationReference,
  type ConversationResolution,
  type ConversationRef,
  type DeliveryReceipt,
  type MessageRef,
} from '@zhin.js/im-contract';
import { segmentsToPlainText } from '../../built/segment-contract/text.js';
import { MiddlewareIndex, isMiddlewareIndex, middlewareFeatureId } from '@zhin.js/middleware';
import { HandlerIndex, isHandlerIndex, handlerFeatureId } from '../../feature/handler.js';
import type { HandlerDispatchOptions, HandlerPrompt } from '@zhin.js/handler';
import { formatCompact, getLogger, truncatePreview } from '@zhin.js/logger';
import {
  Message,
  createOutboundEnvelope,
  type ConversationAddress,
  type IncomingMessage,
  type MessageDispatchResult,
  type MessageGateway,
  type MessageSenderRef,
  type OutboundEnvelope,
  type SendContent,
  type SendRequest,
} from './contracts.js';
import {
  sideEventGatewayToken,
  type SideEventGateway,
} from './side-event-gateway.js';
import { loginAssistToken } from './login-assist-host.js';
import { LoginAssist } from '../../built/login-assist.js';
import type { Notice } from '../../notice.js';
import type { Request } from '../../request.js';
import type { SystemEvent } from '../../system-event.js';
import { sideEventSendChannel } from '../../side-event/base.js';
import type { CommandPrompt } from '@zhin.js/command';
import { defaultCommandPrefixResolver, MessageDispatcher } from './message-dispatcher.js';
import { OutboundRenderer } from './outbound-renderer.js';
import {
  applyOutboundInteractivePolicy,
  normalizeOutboundPayload,
  resolveOutboundInteractivePolicy,
  resolveOutboundMediaPolicy,
} from './outbound-segments.js';
import { assertCanonicalSegments } from '../../built/segment-contract/assert.js';
import { keyboardFallbackStore } from '../../built/interactive-segments/fallback-store.js';
import {
  findRuntimeInteractiveHandler,
  resolveRuntimeInteractivePayload,
  runtimeInteractiveConversationKey,
  type RegisteredRuntimeInteractiveHandler,
  type RuntimeInteractiveHandler,
} from './interactive.js';

const logger = getLogger('im');

export const messageGatewayToken = createToken<MessageGateway>('zhin.im.message-gateway');

/** Generation-owned terminal route after interactive/command routing misses. */
export interface IngressRoute {
  route(
    message: Message,
    lease: SnapshotLease,
    requester: PluginId,
    conversationSequence: number | undefined,
  ): Promise<boolean>;
}

export const ingressRouteToken = createToken<IngressRoute>('zhin.im.ingress-route');

/** Console 实时消息事件（SSE 推送源；content 仅为截断预览，不含完整原始段）。 */
export interface RuntimeMessageEvent {
  readonly direction: 'inbound' | 'outbound';
  readonly conversation: ConversationRef;
  /** inbound：发送者。 */
  readonly sender?: MessageSenderRef;
  /** outbound：发起方插件。 */
  readonly requester?: PluginId;
  /** 预览文本，截断至 200 字。 */
  readonly contentPreview: string;
  readonly messageId?: string;
  readonly timestamp: number;
}

export const messagePreviewLimit = 200;

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

interface PromptClaim {
  readonly resolve: (raw: string) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface PromptSource {
  readonly conversation: ConversationRef;
  readonly sender?: MessageSenderRef;
  readonly $reply: (content: SendContent) => Promise<DeliveryReceipt>;
}

export class ImRuntime implements MessageGateway {
  readonly #dispatcher: MessageDispatcher;
  readonly #renderer: OutboundRenderer;
  readonly #messageListeners = new Set<(event: RuntimeMessageEvent) => void>();
  readonly #interactiveHandlers: Array<RegisteredRuntimeInteractiveHandler & {
    readonly admission?: GenerationAdmissionGate;
  }> = [];
  readonly #promptClaims = new Map<string, PromptClaim>();
  #snapshots?: SnapshotReader;
  readonly #inboundClaim?: ImRuntimeOptions['inboundClaim'];
  readonly #enrichSender?: ImRuntimeOptions['enrichSender'];
  conversationEvents: ConversationEventStore;

  constructor(options: ImRuntimeOptions = {}) {
    this.#dispatcher = new MessageDispatcher(
      options.commandPrefix === undefined
        ? defaultCommandPrefixResolver
        : () => options.commandPrefix ?? '',
    );
    this.#renderer = options.renderer ?? new OutboundRenderer();
    this.conversationEvents = options.conversationEvents ?? new MemoryConversationEventStore();
    this.#inboundClaim = options.inboundClaim;
    this.#enrichSender = options.enrichSender;
  }

  /** Process composition replaces the bootstrap memory store after required DB activation. */
  replaceConversationEventStore(store: ConversationEventStore): void {
    this.conversationEvents = store;
  }

  async resolveConversationReference(
    lease: SnapshotLease,
    reference: ConversationReference,
    context: EndpointContentResolveContext,
  ): Promise<ConversationResolution> {
    if (!this.#snapshots?.owns(lease) || !lease.active) {
      return Object.freeze({ status: 'expired', code: 'generation_lease_expired' });
    }
    if (reference.kind === 'message') {
      const local = await this.conversationEvents.getMessage(reference.message);
      if (local) return Object.freeze({ status: 'resolved', reference, value: local });
    }
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
    if (!Number.isSafeInteger(throughSequence) || throughSequence < 0) {
      throw new TypeError('Conversation context throughSequence must be a non-negative integer');
    }
    const cursor = await this.conversationEvents.getCursor(consumer, conversation);
    const events = await this.conversationEvents.listBetween(
      conversation,
      cursor,
      throughSequence,
      limit,
    );
    const blocks = aggregateConversationContext(events, excludeMessageId);
    return Object.freeze({
      blocks: Object.freeze(blocks),
      cursor: Math.max(cursor, throughSequence),
    });
  }

  async commitConversationContext(
    conversation: ConversationRef,
    consumer: string,
    cursor: number,
  ): Promise<void> {
    await this.conversationEvents.commitCursor(consumer, conversation, cursor);
  }

  attach(snapshots: SnapshotReader): void {
    if (this.#snapshots && this.#snapshots !== snapshots) {
      throw new Error('ImRuntime is already attached to another Root');
    }
    this.#snapshots = snapshots;
  }

  readonly permissionHost = createPermissionHost();
  readonly messageBus = new MessageBus();
  readonly loginAssist = new LoginAssist();

  install(resources: Scope): void {
    resources.provide(messageGatewayToken, this);
    resources.provide(sideEventGatewayToken, this.#sideEventGateway);
    resources.provide(loginAssistToken, this.loginAssist);
    resources.provide(permissionHostToken, this.permissionHost);
    resources.provide(messageBusToken, this.messageBus);
  }

  readonly #sideEventGateway: SideEventGateway & {
    [generationAdmissionBinder](gate: GenerationAdmissionGate): SideEventGateway;
  } = (() => {
    const self = this;
    const gateway: SideEventGateway & {
      [generationAdmissionBinder](gate: GenerationAdmissionGate): SideEventGateway;
    } = {
      receiveNotice: (notice) => self.receiveNotice(notice),
      receiveRequest: (request) => self.receiveRequest(request),
      receiveSystem: (event) => self.receiveSystem(event),
      [generationAdmissionBinder](gate: GenerationAdmissionGate): SideEventGateway {
        return Object.freeze({
          receiveNotice: async (notice: Notice) => {
            await gate.enter(() => self.receiveNotice(notice));
          },
          receiveRequest: async (request: Request) => {
            await gate.enter(() => self.receiveRequest(request));
          },
          receiveSystem: async (event: SystemEvent) => {
            await gate.enter(() => self.receiveSystem(event));
          },
        });
      },
    };
    return gateway;
  })();

  [generationAdmissionBinder](gate: GenerationAdmissionGate): MessageGateway {
    const gateway: MessageGateway = {
      receive: async (input: IncomingMessage) => gate.enter(() => this.#receive(input, gate))
        ?? Object.freeze({ matched: false }),
      send: async (request: SendRequest) => gate.enter(() => this.send(request))
        ?? failedReceipt('generation_not_admitted'),
      registerInteractiveHandler: (prefix, handler) =>
        this.#registerInteractiveHandler(prefix, handler, gate),
    };
    return Object.freeze(gateway);
  }

  /**
   * 注册 interactive action 回跳 handler（prefix 最长匹配；返回注销函数）。
   * 在 Command dispatch 之前路由：action 段 / 数字回跳 / 指令预填 payload。
   */
  registerInteractiveHandler(prefix: string, handler: RuntimeInteractiveHandler): () => void {
    return this.#registerInteractiveHandler(prefix, handler);
  }

  #registerInteractiveHandler(
    prefix: string,
    handler: RuntimeInteractiveHandler,
    admission?: GenerationAdmissionGate,
  ): () => void {
    const entry = Object.freeze({ prefix, handler, admission });
    this.#interactiveHandlers.push(entry);
    return () => {
      const index = this.#interactiveHandlers.indexOf(entry);
      if (index >= 0) this.#interactiveHandlers.splice(index, 1);
    };
  }

  // ==========================================================================
  // Prompt claim — 命令对话式交互
  // ==========================================================================

  #promptConversationKey(message: PromptSource, subjectId = message.sender?.id ?? ''): string {
    const conv = message.conversation;
    return `${conv.endpoint.adapter}:${conv.endpoint.id}:${conv.kind}:${conv.id}:${subjectId}`;
  }

  #resolvePromptClaim(message: Message): boolean {
    const key = this.#promptConversationKey(message);
    const claim = this.#promptClaims.get(key);
    if (!claim) return false;
    claim.resolve(message.content);
    return true;
  }

  #claimNextMessage(
    message: PromptSource,
    timeout: number,
    timeoutText: string,
    signal?: AbortSignal,
    subjectId?: string,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError(signal, timeoutText));
        return;
      }
      const key = this.#promptConversationKey(message, subjectId);
      const existing = this.#promptClaims.get(key);
      if (existing) {
        clearTimeout(existing.timer);
        existing.reject(new Error('Prompt superseded'));
      }
      const timer = setTimeout(() => {
        settle(undefined, new Error(timeoutText));
      }, timeout);
      const onAbort = () => settle(undefined, abortError(signal, timeoutText));
      signal?.addEventListener('abort', onAbort, { once: true });
      const settle = (value?: string, error?: Error) => {
        if (this.#promptClaims.get(key) !== claim) return;
        this.#promptClaims.delete(key);
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (value !== undefined) resolve(value);
        else reject(error ?? new Error(timeoutText));
      };
      const claim: PromptClaim = {
        resolve: (raw) => settle(raw),
        reject: (error) => settle(undefined, error),
        timer,
      };
      this.#promptClaims.set(key, claim);
    });
  }

  #buildCommandPrompt(message: PromptSource, subjectId?: string): CommandPrompt {
    const DEFAULT_TIMEOUT = 3 * 60 * 1000;
    const DEFAULT_TIMEOUT_TEXT = '输入超时';
    const claim = (timeout: number, timeoutText: string, signal?: AbortSignal) =>
      this.#claimNextMessage(message, timeout, timeoutText, signal, subjectId);
    const reply = (content: string) => message.$reply(content);

    return {
      async text(tips, options) {
        await reply(tips);
        try {
          return await claim(
            options?.timeout ?? DEFAULT_TIMEOUT,
            options?.timeoutText ?? DEFAULT_TIMEOUT_TEXT,
            options?.signal,
          );
        } catch (e) {
          if (options?.default !== undefined) return options.default;
          await reply((e as Error).message);
          throw e;
        }
      },
      async number(tips, options) {
        await reply(tips);
        try {
          const raw = await claim(
            options?.timeout ?? DEFAULT_TIMEOUT,
            options?.timeoutText ?? DEFAULT_TIMEOUT_TEXT,
            options?.signal,
          );
          return +raw;
        } catch (e) {
          if (options?.default !== undefined) return options.default;
          await reply((e as Error).message);
          throw e;
        }
      },
      async confirm(tips, options) {
        const condition = options?.condition ?? 'yes';
        await reply(`${tips}\n输入"${condition}"以确认`);
        try {
          const raw = await claim(
            options?.timeout ?? DEFAULT_TIMEOUT,
            options?.timeoutText ?? DEFAULT_TIMEOUT_TEXT,
            options?.signal,
          );
          return raw === condition;
        } catch (e) {
          if (options?.default !== undefined) return options.default;
          await reply((e as Error).message);
          throw e;
        }
      },
      async list(tips, options) {
        const separator = options?.separator ?? ',';
        await reply(`${tips}\n值之间使用"${separator}"分隔`);
        try {
          const raw = await claim(
            options?.timeout ?? DEFAULT_TIMEOUT,
            options?.timeoutText ?? DEFAULT_TIMEOUT_TEXT,
            options?.signal,
          );
          const type = options?.type ?? 'text';
          return raw.split(separator).map((v) => {
            if (type === 'number') return +v;
            if (type === 'boolean') return v === 'true';
            return v;
          });
        } catch (e) {
          if (options?.default !== undefined) return options.default;
          await reply((e as Error).message);
          throw e;
        }
      },
      async pick(tips, options) {
        const items = options.options.map((o, i) => `${i + 1}.${o.label}`);
        const separator = options.separator ?? ',';
        if (options.multiple) items.push(`多选请用"${separator}"分隔`);
        await reply(`${tips}\n${items.join('\n')}`);
        try {
          const raw = await claim(
            options.timeout ?? DEFAULT_TIMEOUT,
            options.timeoutText ?? DEFAULT_TIMEOUT_TEXT,
            options.signal,
          );
          if (!options.multiple) {
            return options.options.find((_, i) => i + 1 === +raw)?.value as never;
          }
          const indices = raw.split(separator).map(Number);
          return options.options
            .filter((_, i) => indices.includes(i + 1))
            .map((o) => o.value) as never;
        } catch (e) {
          if (options.default !== undefined) return options.default as never;
          await reply((e as Error).message);
          throw e;
        }
      },
    };
  }

  /**
   * Bound Prompt for this conversation.
   * `bind.subjectId` waits for that user (e.g. master) instead of the message sender.
   */
  createPrompt(
    message: Message,
    bind?: { readonly subjectId: string },
  ): CommandPrompt | undefined {
    const subjectId = bind?.subjectId?.trim();
    if (bind && !subjectId) return undefined;
    if (typeof message.$reply !== 'function' || !message.conversation) return undefined;
    return this.#buildCommandPrompt(message, subjectId);
  }

  #createPromptForSource(source: unknown): CommandPrompt | undefined {
    if (!source || typeof source !== 'object') return undefined;
    const msg = source as Message;
    if (typeof msg.$reply !== 'function' || !msg.conversation) return undefined;
    return this.#buildCommandPrompt(msg);
  }

  /**
   * 订阅消息事件（入站 dispatch 完成后 / 出站发送成功后回调）。
   * 返回注销函数。listener 抛错不会阻断消息链路。
   */
  onMessage(listener: (event: RuntimeMessageEvent) => void): () => void {
    this.#messageListeners.add(listener);
    return () => { this.#messageListeners.delete(listener); };
  }

  #emitMessage(event: RuntimeMessageEvent): void {
    for (const listener of this.#messageListeners) {
      try {
        listener(event);
      } catch {
        // listener 异常不得影响消息收发
      }
    }
  }

  async receive(input: IncomingMessage): Promise<MessageDispatchResult> {
    return this.#receive(input);
  }

  async #receive(
    input: IncomingMessage,
    admission?: GenerationAdmissionGate,
  ): Promise<MessageDispatchResult> {
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
          return this.#sendWithSnapshot({
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
      );
      let conversationSequence: number | undefined;
      if (input.message?.id) {
        const appended = await this.conversationEvents.append(Object.freeze({
          eventId: `message:${messageRefKey(input.message)}`,
          conversation,
          timestamp: Date.now(),
          type: 'message.created',
          message: Object.freeze({
            ref: input.message,
            ...(enrichedSender ? { actor: Object.freeze({
              id: enrichedSender.id,
              ...(enrichedSender.name ? { displayName: enrichedSender.name } : {}),
            }) } : {}),
            segments: Object.freeze(input.segments?.length
              ? [...input.segments]
              : [{ type: 'text', data: { text: input.content } }]),
            timestamp: Date.now(),
            ...(input.replyTo ? { replyTo: Object.freeze({ conversation, id: input.replyTo.id }) } : {}),
          }),
        }));
        conversationSequence = appended.sequence;
      }
      await this.#runHandlers(lease.value, 'message.receive', [message]);
      let result: MessageDispatchResult = Object.freeze({ matched: false });
      const claimed = await this.#inboundClaim?.(message) === true;
      if (claimed) {
        result = Object.freeze({ matched: true, command: 'interaction', owner: requester });
      } else if (this.#resolvePromptClaim(message)) {
        result = Object.freeze({ matched: true, command: 'prompt', owner: requester });
      } else {
        const promptFactory = (source: unknown) => this.#createPromptForSource(source);
        await runMiddleware(
          lease.value,
          message,
          async () => {
            result = await this.#dispatchInteractive(message, requester, admission)
              ?? await this.#dispatcher.dispatch(message, lease.value, promptFactory);
            const ingressRoute = resolveIngressRoute(lease.value);
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
      this.#emitMessage({
        direction: 'inbound',
        conversation,
        ...(input.sender !== undefined ? { sender: input.sender } : {}),
        contentPreview: previewText(input.content),
        ...(input.message?.id ? { messageId: input.message.id } : {}),
        timestamp: Date.now(),
      });
      return result;
    } finally {
      active = false;
      lease.release();
    }
  }

  async send(request: SendRequest): Promise<DeliveryReceipt> {
    const lease = this.#acquire();
    try {
      return await this.#sendWithSnapshot(request, lease.value);
    } finally {
      lease.release();
    }
  }

  async receiveNotice(notice: Notice): Promise<void> {
    const event = conversationEventFromNotice(notice);
    if (event) await this.conversationEvents.append(event);
    await this.#receiveSideEvent('notice.receive', notice);
  }

  async receiveRequest(request: Request): Promise<void> {
    await this.#withRequestActionScope(request, async (scoped) => {
      await this.#receiveSideEvent('request.receive', scoped);
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

  async receiveSystem(event: SystemEvent): Promise<void> {
    await this.#receiveSideEvent('system.receive', event);
  }

  async #receiveSideEvent(
    event: 'notice.receive' | 'request.receive' | 'system.receive',
    payload: Notice | Request | SystemEvent,
  ): Promise<void> {
    const lease = this.#acquire();
    try {
      await this.#runHandlers(lease.value, event, [payload]);
    } finally {
      lease.release();
    }
  }

  /**
   * Prompt bound to a side-event scene (private/group channel derived from
   * `$scene_type` / `$scene_id`). Returns undefined when outbound is unavailable.
   */
  #createPromptForSideEvent(
    payload: Notice | Request | SystemEvent,
    snapshot: RuntimeSnapshot,
  ): HandlerPrompt | undefined {
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
    const source: PromptSource = Object.freeze({
      conversation,
      ...(payload.$actor?.id
        ? { sender: Object.freeze({ id: payload.$actor.id }) }
        : {}),
      $reply: (content: SendContent) => this.#sendWithSnapshot({
        conversation,
        requester,
        content,
      }, snapshot),
    });
    return this.#buildCommandPrompt(source) as HandlerPrompt;
  }

  async #runHandlers(
    snapshot: RuntimeSnapshot,
    event: string,
    args: readonly unknown[],
  ): Promise<void> {
    const index = handlers(snapshot);
    if (!index) return;
    const options: HandlerDispatchOptions = {
      resolvePrompt: (name, promptArgs) => {
        const payload = promptArgs[0];
        if (name === 'message.receive' && payload instanceof Message) {
          return this.createPrompt(payload) as HandlerPrompt | undefined;
        }
        if (
          name === 'notice.receive'
          || name === 'request.receive'
          || name === 'system.receive'
        ) {
          return this.#createPromptForSideEvent(
            payload as Notice | Request | SystemEvent,
            snapshot,
          );
        }
        return undefined;
      },
    };
    await index.dispatch(event, args, options);
  }

  /** Console `endpoint.list` — empty until Adapter Feature projection is ready. */
  listEndpoints(): readonly {
    readonly name: string;
    readonly adapter: string;
    readonly owner: string;
    readonly connected: boolean;
    readonly status: 'online' | 'offline';
    readonly phase: AdapterEndpointPhase;
    readonly managementCapabilities: readonly EndpointManagementCapability[];
  }[] {
    try {
      const lease = this.#acquire();
      try {
        return requireAdapters(lease.value).describe().map((row) => Object.freeze({
          name: row.name,
          // adapter 列显示平台类型（owner 包名去 scope/adapter- 前缀），不是 slot localName
          adapter: adapterTypeName(lease.value.tree.get(row.owner)?.packageName) ?? row.name,
          owner: row.owner,
          connected: row.connected,
          status: row.status,
          phase: row.phase,
          managementCapabilities: row.managementCapabilities,
        }));
      } finally {
        lease.release();
      }
    } catch {
      return Object.freeze([]);
    }
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
        lease.release();
      }
    } catch {
      return Object.freeze({
        plugins: 0,
        endpoints: Object.freeze({ total: 0, online: 0 }),
      });
    }
  }

  getEndpoint(adapter: string, endpointKey: string): {
    readonly name: string;
    readonly adapter: string;
    readonly connected: boolean;
    readonly status: 'online' | 'offline';
    readonly phase: AdapterEndpointPhase;
    readonly managementCapabilities: readonly EndpointManagementCapability[];
  } | null {
    try {
      const lease = this.#acquire();
      try {
        const index = requireAdapters(lease.value);
        const id = index.resolve(adapter, endpointKey);
        if (!id) return null;
        const row = index.describe().find((item) => item.id === id);
        if (!row) return null;
        // adapter 与 listEndpoints 对齐：平台类型（owner 包名去 scope/adapter- 前缀），
        // 不是 live name（如 ICQQ uin）。此前误写 row.name 导致 endpoint.info 与 list 不一致。
        return Object.freeze({
          name: row.name,
          adapter: adapterTypeName(lease.value.tree.get(row.owner)?.packageName) ?? row.name,
          connected: row.connected,
          status: row.status,
          phase: row.phase,
          managementCapabilities: row.managementCapabilities,
        });
      } finally {
        lease.release();
      }
    } catch {
      return null;
    }
  }

  async sendEndpointMessage(input: {
    readonly adapter: string;
    readonly endpointKey: string;
    readonly conversation: ConversationAddress;
    readonly content: unknown;
  }): Promise<{ messageId: string }> {
    const lease = this.#acquire();
    try {
      const index = requireAdapters(lease.value);
      const resolved = index.resolve(input.adapter, input.endpointKey);
      if (!resolved) throw new Error('endpoint not found');
      const requester = index.owner(resolved);
      const conversation: ConversationRef = {
        endpoint: { id: String(resolved), adapter: String(requester) },
        ...input.conversation,
      };
      const content = normalizeConsoleContent(input.content);
      const result = await this.#sendWithSnapshot({
        conversation,
        requester,
        content,
      }, lease.value);
      return { messageId: result.message?.id ?? '' };
    } finally {
      lease.release();
    }
  }

  /** Activity-feedback: add a message reaction when the live Endpoint supports it. */
  async addEndpointReaction(input: {
    readonly adapter: string;
    readonly endpointKey: string;
    readonly message: MessageRef;
    readonly emoji: string;
    readonly sceneType?: string;
    readonly channelId?: string;
  }): Promise<string | null> {
    return this.#withEndpointControl(input.adapter, input.endpointKey, (control) =>
      control.addReaction?.(input.message, input.emoji, {
        sceneType: input.sceneType,
        channelId: input.channelId,
      }) ?? null, null);
  }

  async removeEndpointReaction(input: {
    readonly adapter: string;
    readonly endpointKey: string;
    readonly message: MessageRef;
    readonly reactionId: string;
  }): Promise<void> {
    await this.#withEndpointControl(input.adapter, input.endpointKey, (control) =>
      control.removeReaction?.(
        input.message,
        input.reactionId,
      ), undefined);
  }

  /** Activity-feedback autoRemove: recall a previously sent status message. */
  async recallEndpointMessage(input: {
    readonly adapter: string;
    readonly endpointKey: string;
    readonly message: MessageRef;
  }): Promise<void> {
    await this.#withEndpointControl(input.adapter, input.endpointKey, (control) =>
      control.recall?.(input.message), undefined);
  }

  async editEndpointMessage(input: {
    readonly adapter: string;
    readonly endpointKey: string;
    readonly message: MessageRef;
    readonly content: unknown;
  }): Promise<string | null> {
    return this.#withEndpointControl(input.adapter, input.endpointKey, (control) =>
      control.edit?.(input.message, input.content) ?? null,
    null);
  }

  async setEndpointTyping(input: {
    readonly adapter: string;
    readonly endpointKey: string;
    readonly conversation: ConversationRef;
    readonly active?: boolean;
  }): Promise<void> {
    await this.#withEndpointControl(input.adapter, input.endpointKey, (control) =>
      control.typing?.(input.conversation, input.active), undefined);
  }

  async #withEndpointControl<T>(
    adapter: string,
    endpointKey: string,
    run: (control: EndpointControl) => T | Promise<T>,
    fallback: T,
  ): Promise<T> {
    let lease: SnapshotLease;
    try {
      lease = this.#acquire();
    } catch {
      return fallback;
    }
    try {
      const endpoint = requireAdapters(lease.value).instance(adapter, endpointKey);
      const control = endpointControlOf(endpoint);
      return control ? await run(control) : fallback;
    } finally {
      lease.release();
    }
  }

  /** Run one management operation while the Endpoint generation stays leased. */
  async withEndpointManagement<T>(
    adapter: string,
    endpointKey: string,
    run: (management: EndpointManagement) => T | Promise<T>,
  ): Promise<T | null> {
    let lease: SnapshotLease;
    try {
      lease = this.#acquire();
    } catch {
      return null;
    }
    try {
      const endpoint = requireAdapters(lease.value).instance(adapter, endpointKey);
      if (!endpoint) return null;
      return await run(resolveEndpointManagement(endpoint) ?? Object.freeze({}));
    } finally {
      lease.release();
    }
  }

  async #sendWithSnapshot(
    request: SendRequest,
    snapshot: RuntimeSnapshot,
  ): Promise<DeliveryReceipt> {
    const adapter = request.conversation.endpoint.id as CapabilityId;
    let initialPayload: unknown;
    try {
      const rendered = await this.#renderer.render(
        request.content, request.requester, snapshot,
        request.conversation, request.incoming,
      );
      initialPayload = await prepareOutboundPayload(rendered, request.conversation, snapshot);
    } catch {
      return rejectedReceipt('outbound_payload_rejected');
    }

    const envelope = createOutboundEnvelope({
      conversation: request.conversation,
      requester: request.requester,
      generation: snapshot.generation,
    }, initialPayload);
    let terminalEntered = false;
    let receipt: DeliveryReceipt | undefined;

    try {
      await runMiddleware<OutboundEnvelope>(
        snapshot,
        envelope,
        async () => {
          terminalEntered = true;
          let payload: unknown;
          try {
            payload = await prepareOutboundPayload(envelope.payload, request.conversation, snapshot, true);
          } catch {
            receipt = rejectedReceipt('outbound_payload_rejected');
            return;
          }

          try {
            const result = await requireAdapters(snapshot).send(adapter, {
              conversation: request.conversation,
              payload,
            });
            receipt = receiptFromEndpointResult(result, request.conversation);
          } catch (error) {
            receipt = receiptFromEndpointError(error);
          }

          if (receipt?.status === 'sent') {
            if (receipt.message?.id) {
              const segments = conversationSegmentsFromContent(request.content);
              await this.conversationEvents.append(Object.freeze({
                eventId: `message:${messageRefKey(receipt.message)}`,
                conversation: request.conversation,
                timestamp: Date.now(),
                type: 'message.created',
                message: Object.freeze({
                  ref: receipt.message,
                  segments,
                  timestamp: Date.now(),
                }),
              }));
            }
            this.#emitMessage({
              direction: 'outbound',
              conversation: request.conversation,
              requester: request.requester,
              contentPreview: previewText(payload),
              ...(receipt.message?.id
                ? { messageId: receipt.message.id }
                : {}),
              timestamp: Date.now(),
            });
          }
        },
        'outbound',
      );
    } catch {
      return receipt ?? failedReceipt('outbound_middleware_failed');
    }

    if (!terminalEntered) {
      logger.debug(formatCompact({
        op: 'replychain_runtime_send',
        status: 'suppressed',
        reason: 'middleware_stopped_before_terminal',
        conv: formatConversationLog(request.conversation),
      }));
      return suppressedReceipt();
    }
    logger.debug(formatCompact({
      op: 'replychain_runtime_send',
      status: receipt?.status ?? 'missing',
      code: receipt?.failure?.code,
      conv: formatConversationLog(request.conversation),
    }));
    return receipt ?? failedReceipt('outbound_delivery_incomplete');
  }

  #acquire() {
    if (!this.#snapshots) throw new Error('ImRuntime is not attached to a Root');
    return this.#snapshots.acquire();
  }

  /**
   * interactive 回跳分发（Command dispatch 之前）：action 段 / 中央 fallback
   * 数字回跳 / 指令预填 payload → prefix 最长匹配 handler。
   */
  async #dispatchInteractive(
    message: Message,
    requester: PluginId,
    admission?: GenerationAdmissionGate,
  ): Promise<MessageDispatchResult | undefined> {
    if (this.#interactiveHandlers.length === 0) return undefined;
    const payload = resolveRuntimeInteractivePayload(message);
    if (!payload) return undefined;
    const handler = findRuntimeInteractiveHandler(
      this.#interactiveHandlers.filter((entry) => !entry.admission || entry.admission === admission),
      payload,
    );
    if (!handler) return undefined;
    const handled = await handler(message);
    return handled
      ? Object.freeze({ matched: true, command: 'interactive', owner: requester })
      : undefined;
  }
}

function conversationEventFromNotice(notice: Notice): ConversationEvent | undefined {
  const sceneType = notice.$scene_type;
  const kind = sceneType === 'group' ? 'group' as const
    : sceneType === 'channel' ? 'channel' as const
      : sceneType === 'friend' || sceneType === 'private' ? 'private' as const
        : undefined;
  if (!kind || !notice.$scene_id || !notice.$id) return undefined;
  const conversation = Object.freeze({
    endpoint: Object.freeze({ adapter: String(notice.$adapter), id: String(notice.$endpoint) }),
    kind,
    id: String(notice.$scene_id),
  });
  const actor = notice.$actor?.id
    ? Object.freeze({ id: String(notice.$actor.id), ...(notice.$actor.name ? { displayName: notice.$actor.name } : {}) })
    : undefined;
  const target = notice.$target?.id
    ? Object.freeze({ id: String(notice.$target.id), ...(notice.$target.name ? { displayName: notice.$target.name } : {}) })
    : undefined;
  const base = Object.freeze({
    eventId: `notice:${conversationRefKey(conversation)}:${String(notice.$id)}`,
    conversation,
    timestamp: notice.$timestamp,
  });
  switch (notice.$sub_type) {
    case 'member_increase':
    case 'increase':
      return target ? Object.freeze({ ...base, type: 'member.joined', member: target, ...(actor ? { actor } : {}) }) : undefined;
    case 'member_decrease':
      return target ? Object.freeze({ ...base, type: 'member.left', member: target, ...(actor ? { actor } : {}), reason: actor ? 'removed' : 'left' }) : undefined;
    case 'ban':
      if (!target) return undefined;
      return notice.$duration_seconds === 0
        ? Object.freeze({ ...base, type: 'member.unmuted', member: target, ...(actor ? { actor } : {}) })
        : Object.freeze({ ...base, type: 'member.muted', member: target, ...(actor ? { actor } : {}), durationSeconds: notice.$duration_seconds ?? 0 });
    case 'admin_change':
      return target && notice.$role && typeof notice.$enabled === 'boolean'
        ? Object.freeze({ ...base, type: 'member.role_changed', member: target, ...(actor ? { actor } : {}), role: notice.$role, enabled: notice.$enabled })
        : undefined;
    case 'recall':
      return notice.$message_id
        ? Object.freeze({ ...base, type: 'message.recalled', message: Object.freeze({ conversation, id: notice.$message_id }), ...(actor ? { actor } : {}) })
        : undefined;
    case 'emoji_reaction':
      return notice.$message_id && notice.$reaction && notice.$operation
        ? Object.freeze({ ...base, type: 'message.reaction_changed', message: Object.freeze({ conversation, id: notice.$message_id }), ...(actor ? { actor } : {}), reaction: notice.$reaction, operation: notice.$operation })
        : undefined;
    case 'poke':
      return Object.freeze({ ...base, type: 'conversation.poked', ...(actor ? { actor } : {}), ...(target ? { target } : {}) });
    default:
      return undefined;
  }
}

function describeConversationEvent(event: ConversationEvent): string {
  const actor = 'actor' in event && event.actor ? `${event.actor.displayName ?? event.actor.id} (${event.actor.id})` : undefined;
  switch (event.type) {
    case 'message.recalled': return `${actor ?? 'Someone'} recalled message ${event.message.id}.`;
    case 'message.reaction_changed': return `${actor ?? 'Someone'} ${event.operation} reaction ${event.reaction} on message ${event.message.id}.`;
    case 'conversation.poked': return `${actor ?? 'Someone'} poked ${event.target ? `${event.target.displayName ?? event.target.id} (${event.target.id})` : 'someone'}.`;
    case 'member.joined': return `${event.member.displayName ?? event.member.id} (${event.member.id}) joined the conversation.`;
    case 'member.left': return `${event.member.displayName ?? event.member.id} (${event.member.id}) left the conversation (${event.reason ?? 'left'}).`;
    case 'member.muted': return `${event.member.displayName ?? event.member.id} (${event.member.id}) was muted for ${event.durationSeconds} seconds${actor ? ` by ${actor}` : ''}.`;
    case 'member.unmuted': return `${event.member.displayName ?? event.member.id} (${event.member.id}) was unmuted${actor ? ` by ${actor}` : ''}.`;
    case 'member.role_changed': return `${event.member.displayName ?? event.member.id} (${event.member.id}) role ${event.role} was ${event.enabled ? 'enabled' : 'disabled'}${actor ? ` by ${actor}` : ''}.`;
    case 'message.created': return '';
  }
}

function describeConversationMessage(message: ConversationMessage): string {
  const actor = message.actor
    ? `${message.actor.displayName ?? message.actor.id} (${message.actor.id})`
    : undefined;
  if (!actor) return '';
  const text = segmentsToPlainText(message.segments).trim();
  const attachmentTypes = [...new Set(message.segments
    .filter((segment) => segment.type !== 'text' && segment.type !== 'mention' && segment.type !== 'at')
    .map((segment) => segment.type))];
  const attachmentNote = attachmentTypes.length > 0
    ? ` [message also contains ${attachmentTypes.join(', ')} data; inspect its reference before relying on that content]`
    : '';
  return `${actor}: ${text || '(no plain-text content)'}${attachmentNote}`;
}

function aggregateConversationContext(
  events: readonly import('@zhin.js/im-contract').SequencedConversationEvent[],
  excludeMessageId?: string,
): readonly ConversationContextBlock[] {
  const ordinary: ConversationContextBlock[] = [];
  const noisy = new Map<string, { sequence: number; event: ConversationEvent; count: number }>();
  for (const { sequence, event } of events) {
    if (event.type === 'message.created') {
      if (event.message.ref.id === excludeMessageId) continue;
      const text = describeConversationMessage(event.message);
      if (!text) continue;
      ordinary.push(Object.freeze({
        kind: 'conversation_event',
        sequence,
        eventType: event.type,
        text,
      }));
      continue;
    }
    if (event.type === 'message.reaction_changed' || event.type === 'conversation.poked') {
      const key = event.type === 'message.reaction_changed'
        ? `${event.type}:${event.message.id}:${event.actor?.id ?? ''}:${event.reaction}:${event.operation}`
        : `${event.type}:${event.actor?.id ?? ''}:${event.target?.id ?? ''}`;
      const previous = noisy.get(key);
      noisy.set(key, { sequence, event, count: (previous?.count ?? 0) + 1 });
      continue;
    }
    ordinary.push(Object.freeze({
      kind: 'conversation_event',
      sequence,
      eventType: event.type,
      text: describeConversationEvent(event),
    }));
  }
  for (const { sequence, event, count } of noisy.values()) {
    ordinary.push(Object.freeze({
      kind: 'conversation_event',
      sequence,
      eventType: event.type,
      text: `${describeConversationEvent(event)}${count > 1 ? ` (${count} similar events.)` : ''}`,
    }));
  }
  ordinary.sort((left, right) => left.sequence - right.sequence);
  return Object.freeze(ordinary);
}

function resolveIngressRoute(snapshot: RuntimeSnapshot): IngressRoute | undefined {
  const candidate = snapshot.resources.get(snapshot.root)?.get(ingressRouteToken.id);
  return candidate
    && typeof candidate === 'object'
    && typeof (candidate as IngressRoute).route === 'function'
    ? candidate as IngressRoute
    : undefined;
}

function requireAdapters(snapshot: RuntimeSnapshot): AdapterIndex {
  const projection = snapshot.projections.get(adapterFeatureId);
  if (!isAdapterIndex(projection)) {
    throw new Error('Adapter Feature projection is not installed');
  }
  return projection;
}

/** Root resources 上的可选 html-renderer Host（未安装时降级为文本）。 */
function resolveHtmlRenderer(snapshot: RuntimeSnapshot): HtmlRendererHost | undefined {
  const host = snapshot.resources.get(snapshot.root)?.get(htmlRendererToken.id);
  return host && typeof (host as HtmlRendererHost).render === 'function'
    ? host as HtmlRendererHost
    : undefined;
}

/**
 * Sandbox（控制台 UI）按设计直接消费 html 段，不做 html→image/text 规范化。
 * 通过 adapter 能力 slot 的 owner 包名判断平台类型。
 */
function isDirectHtmlConsumer(snapshot: RuntimeSnapshot, adapter: CapabilityId): boolean {
  const owner = snapshot.capabilities.get(adapter)?.owner;
  return adapterTypeName(snapshot.tree.get(owner as PluginId)?.packageName) === 'sandbox';
}

async function prepareOutboundPayload(
  rendered: unknown,
  conversation: ConversationRef,
  snapshot: RuntimeSnapshot,
  finalizeInteractive = false,
): Promise<unknown> {
  const adapter = conversation.endpoint.id as CapabilityId;
  const directHtml = isDirectHtmlConsumer(snapshot, adapter);
  let payload = directHtml
    ? rendered
    : await normalizeOutboundPayload(rendered, resolveHtmlRenderer(snapshot), {
      mediaPolicy: resolveOutboundMediaPolicy(adapter, snapshot),
    });
  if (finalizeInteractive) {
    payload = applyOutboundInteractivePolicy(
      payload,
      resolveOutboundInteractivePolicy(adapter, snapshot),
      (map) => keyboardFallbackStore.remember(
        runtimeInteractiveConversationKey(conversation),
        map,
      ),
    );
  }
  if (!directHtml && Array.isArray(payload)) assertCanonicalSegments(payload);
  return payload;
}

function receiptFromEndpointResult(
  messageId: string,
  conversation: ConversationRef,
): DeliveryReceipt {
  return Object.freeze({
    status: 'sent' as const,
    message: Object.freeze({ conversation, id: messageId }),
  });
}

function receiptFromEndpointError(error: unknown): DeliveryReceipt {
  const message = error instanceof Error ? error.message : String(error);
  if (/Unknown Adapter Endpoint|does not support outbound/u.test(message)) {
    return unsupportedReceipt('outbound_unsupported');
  }
  if (/not active/u.test(message)) return failedReceipt('endpoint_inactive', true);
  return failedReceipt('endpoint_send_failed', true);
}

function suppressedReceipt(): DeliveryReceipt {
  return Object.freeze({ status: 'suppressed' as const });
}

function unsupportedReceipt(code: string): DeliveryReceipt {
  return Object.freeze({
    status: 'unsupported' as const,
    failure: Object.freeze({ code, message: 'Outbound delivery is not supported.' }),
  });
}

function rejectedReceipt(code: string): DeliveryReceipt {
  return Object.freeze({
    status: 'rejected' as const,
    failure: Object.freeze({ code, message: 'Outbound payload was rejected.' }),
  });
}

function failedReceipt(code: string, retryable = false): DeliveryReceipt {
  return Object.freeze({
    status: 'failed' as const,
    failure: Object.freeze({
      code,
      message: 'Outbound delivery failed.',
      ...(retryable ? { retryable: true } : {}),
    }),
  });
}

/** `@zhin.js/adapter-icqq` → `icqq`；非 adapter 包名原样返回。 */
function adapterTypeName(packageName: string | undefined): string | undefined {
  if (!packageName) return undefined;
  return packageName.replace(/^@[^/]+\/adapter-/, '');
}

function middleware(snapshot: RuntimeSnapshot): MiddlewareIndex | undefined {
  const projection = snapshot.projections.get(middlewareFeatureId);
  return isMiddlewareIndex(projection) ? projection : undefined;
}

async function runMiddleware<TInput>(
  snapshot: RuntimeSnapshot,
  input: TInput,
  terminal: () => Promise<void>,
  target: 'inbound' | 'outbound',
): Promise<void> {
  const index = middleware(snapshot);
  if (index) await index.run(input, terminal, target);
  else await terminal();
}

function handlers(snapshot: RuntimeSnapshot): HandlerIndex | undefined {
  const projection = snapshot.projections.get(handlerFeatureId);
  return isHandlerIndex(projection) ? projection : undefined;
}

function normalizeConsoleContent(content: unknown): SendContent {
  if (typeof content === 'string') return content;
  // Array content passes through untouched, matching the legacy console RPC
  // contract (element arrays must not be stringified to '[object Object]').
  if (Array.isArray(content)) return content as SendContent;
  return String(content);
}

/** 日志用会话摘要（`kind:id@parentKind:parentId#threadId`），不拼 legacy target。 */
function formatConversationLog(conversation: ConversationRef): string {
  const base = `${conversation.kind}:${conversation.id}`;
  const parent = conversation.parent
    ? `@${conversation.parent.kind}:${conversation.parent.id}`
    : '';
  const thread = conversation.threadId ? `#${conversation.threadId}` : '';
  return `${base}${parent}${thread}`;
}

/** 消息内容 → 预览文本（截断 200 字）；wire 段取 `data.text`，其余段记 `[type]`。 */
function previewText(content: unknown): string {
  const text = flattenContent(content);
  return text.length > messagePreviewLimit
    ? `${text.slice(0, messagePreviewLimit)}…`
    : text;
}

function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (Array.isArray(content)) {
    return content.map((item) => flattenContent(item)).join('');
  }
  if (typeof content === 'object') {
    const record = content as Record<string, unknown>;
    const data = record.data as Record<string, unknown> | undefined;
    if (typeof record.type === 'string') {
      if (data && typeof data.text === 'string') return data.text;
      return `[${record.type}]`;
    }
    if (typeof record.text === 'string') return record.text;
    try {
      return JSON.stringify(content) ?? '';
    } catch {
      return String(content);
    }
  }
  return String(content);
}

function conversationSegmentsFromContent(content: unknown): readonly import('@zhin.js/im-contract').Segment[] {
  if (Array.isArray(content)) {
    try {
      assertCanonicalSegments(content);
      return Object.freeze([...content]);
    } catch {
      // Fall through to a truthful text projection of non-canonical output.
    }
  }
  return Object.freeze([{ type: 'text', data: Object.freeze({ text: flattenContent(content) }) }]);
}

function abortError(signal: AbortSignal | undefined, fallback: string): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return new Error(fallback);
}
