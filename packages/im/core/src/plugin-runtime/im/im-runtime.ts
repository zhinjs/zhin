import {
  Scope,
  createToken,
  htmlRendererToken,
  type CapabilityId,
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
  resolveEndpointControl,
  resolveEndpointManagement,
  type EndpointControl,
  type EndpointManagement,
  type EndpointManagementCapability,
} from '@zhin.js/adapter';
import {
  formatLegacyMessageRef,
  isDeliveryReceipt,
  type ConversationRef,
  type DeliveryReceipt,
  type MessageRef,
} from '@zhin.js/im-contract';
import { MiddlewareIndex, isMiddlewareIndex, middlewareFeatureId } from '@zhin.js/middleware';
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

export class ImRuntime implements MessageGateway {
  readonly #dispatcher: MessageDispatcher;
  readonly #renderer: OutboundRenderer;
  readonly #messageListeners = new Set<(event: RuntimeMessageEvent) => void>();
  readonly #interactiveHandlers: RegisteredRuntimeInteractiveHandler[] = [];
  #snapshots?: SnapshotReader;
  readonly #inboundClaim?: ImRuntimeOptions['inboundClaim'];
  readonly #enrichSender?: ImRuntimeOptions['enrichSender'];

  constructor(options: ImRuntimeOptions = {}) {
    this.#dispatcher = new MessageDispatcher(
      options.commandPrefix === undefined
        ? defaultCommandPrefixResolver
        : () => options.commandPrefix ?? '',
    );
    this.#renderer = options.renderer ?? new OutboundRenderer();
    this.#inboundClaim = options.inboundClaim;
    this.#enrichSender = options.enrichSender;
  }

  attach(snapshots: SnapshotReader): void {
    if (this.#snapshots && this.#snapshots !== snapshots) {
      throw new Error('ImRuntime is already attached to another Root');
    }
    this.#snapshots = snapshots;
  }

  readonly permissionHost = createPermissionHost();
  readonly messageBus = new MessageBus();

  install(resources: Scope): void {
    resources.provide(messageGatewayToken, this);
    resources.provide(permissionHostToken, this.permissionHost);
    resources.provide(messageBusToken, this.messageBus);
  }

  /**
   * 注册 interactive action 回跳 handler（prefix 最长匹配；返回注销函数）。
   * 在 Command dispatch 之前路由：action 段 / 数字回跳 / 指令预填 payload。
   */
  registerInteractiveHandler(prefix: string, handler: RuntimeInteractiveHandler): () => void {
    const entry: RegisteredRuntimeInteractiveHandler = Object.freeze({ prefix, handler });
    this.#interactiveHandlers.push(entry);
    return () => {
      const index = this.#interactiveHandlers.indexOf(entry);
      if (index >= 0) this.#interactiveHandlers.splice(index, 1);
    };
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
      let result: MessageDispatchResult = Object.freeze({ matched: false });
      const claimed = await this.#inboundClaim?.(message) === true;
      if (claimed) {
        result = Object.freeze({ matched: true, command: 'interaction', owner: requester });
      } else {
        await runMiddleware(
          lease.value,
          message,
          async () => {
            result = await this.#dispatchInteractive(message, requester)
              ?? await this.#dispatcher.dispatch(message, lease.value);
            const ingressRoute = resolveIngressRoute(lease.value);
            if (!result.matched && ingressRoute) {
              logger.debug(formatCompact({ op: 'unmatched', conv: formatConversationLog(conversation) }));
              const handled = await ingressRoute.route(message, lease, requester);
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

  /** Console `endpoint.list` — empty until Adapter Feature projection is ready. */
  listEndpoints(): readonly {
    readonly name: string;
    readonly adapter: string;
    readonly owner: string;
    readonly connected: boolean;
    readonly status: 'online' | 'offline';
    readonly phase: 'pending' | 'starting' | 'online' | 'failed' | 'unconfigured';
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
    readonly phase: 'pending' | 'starting' | 'online' | 'failed' | 'unconfigured';
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
      return { messageId: result.message?.id ?? result.legacyMessageId ?? '' };
    } finally {
      lease.release();
    }
  }

  /** Activity-feedback: add a message reaction when the live Endpoint supports it. */
  async addEndpointReaction(input: {
    readonly adapter: string;
    readonly endpointKey: string;
    readonly message?: MessageRef;
    readonly messageId?: string;
    readonly emoji: string;
    readonly sceneType?: string;
    readonly channelId?: string;
  }): Promise<string | null> {
    const control = this.#liveEndpointControl(input.adapter, input.endpointKey);
    return control?.addReaction?.(legacyMessageTarget(input.message, input.messageId), input.emoji, {
      sceneType: input.sceneType,
      channelId: input.channelId,
    }) ?? null;
  }

  async removeEndpointReaction(input: {
    readonly adapter: string;
    readonly endpointKey: string;
    readonly message?: MessageRef;
    readonly messageId?: string;
    readonly reactionId: string;
  }): Promise<void> {
    await this.#liveEndpointControl(input.adapter, input.endpointKey)
      ?.removeReaction?.(legacyMessageTarget(input.message, input.messageId), input.reactionId);
  }

  /** Activity-feedback autoRemove: recall a previously sent status message. */
  async recallEndpointMessage(input: {
    readonly adapter: string;
    readonly endpointKey: string;
    readonly message?: MessageRef;
    readonly messageId?: string;
  }): Promise<void> {
    await this.#liveEndpointControl(input.adapter, input.endpointKey)
      ?.recall?.(legacyMessageTarget(input.message, input.messageId));
  }

  async editEndpointMessage(input: {
    readonly adapter: string;
    readonly endpointKey: string;
    readonly message?: MessageRef;
    readonly messageId?: string;
    readonly content: unknown;
  }): Promise<string | null> {
    return this.#liveEndpointControl(input.adapter, input.endpointKey)
      ?.edit?.(legacyMessageTarget(input.message, input.messageId), input.content) ?? null;
  }

  async setEndpointTyping(input: {
    readonly adapter: string;
    readonly endpointKey: string;
    readonly conversation: ConversationRef;
    readonly active?: boolean;
  }): Promise<void> {
    await this.#liveEndpointControl(input.adapter, input.endpointKey)
      ?.typing?.(input.conversation, input.active);
  }

  #liveEndpoint(adapter: string, endpointKey: string): unknown | null {
    try {
      const lease = this.#acquire();
      try {
        const endpoint = requireAdapters(lease.value).instance(adapter, endpointKey);
        return endpoint ?? null;
      } finally {
        lease.release();
      }
    } catch {
      return null;
    }
  }

  #liveEndpointControl(adapter: string, endpointKey: string): EndpointControl | null {
    const endpoint = this.#liveEndpoint(adapter, endpointKey);
    return resolveEndpointControl(endpoint) ?? null;
  }

  /**
   * Narrow Host seam for Console social/group management. An empty object means
   * the Endpoint exists but implements no management operations; null means it
   * cannot be resolved.
   */
  getEndpointManagement(adapter: string, endpointKey: string): EndpointManagement | null {
    const endpoint = this.#liveEndpoint(adapter, endpointKey);
    if (!endpoint) return null;
    return resolveEndpointManagement(endpoint) ?? Object.freeze({});
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
            receipt = receiptFromEndpointResult(result);
          } catch (error) {
            receipt = receiptFromEndpointError(error);
          }

          if (receipt?.status === 'sent') {
            this.#emitMessage({
              direction: 'outbound',
              conversation: request.conversation,
              requester: request.requester,
              contentPreview: previewText(payload),
              ...(receipt.message?.id || receipt.legacyMessageId
                ? { messageId: receipt.message?.id ?? receipt.legacyMessageId }
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

    if (!terminalEntered) return suppressedReceipt();
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
  ): Promise<MessageDispatchResult | undefined> {
    if (this.#interactiveHandlers.length === 0) return undefined;
    const payload = resolveRuntimeInteractivePayload(message);
    if (!payload) return undefined;
    const handler = findRuntimeInteractiveHandler(this.#interactiveHandlers, payload);
    if (!handler) return undefined;
    const handled = await handler(message);
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

function legacyMessageTarget(message?: MessageRef, messageId?: string): string {
  if (message) return formatLegacyMessageRef(message);
  if (messageId) return messageId;
  throw new TypeError('message or messageId is required');
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

function receiptFromEndpointResult(result: unknown): DeliveryReceipt {
  if (isDeliveryReceipt(result)) return result;
  const legacyMessageId = legacyMessageIdOf(result);
  return Object.freeze({
    status: 'sent' as const,
    ...(legacyMessageId ? { legacyMessageId } : {}),
  });
}

function legacyMessageIdOf(result: unknown): string | undefined {
  if (typeof result === 'string' || typeof result === 'number') return String(result);
  if (!result || typeof result !== 'object') return undefined;
  const id = (result as { id?: unknown }).id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined;
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
