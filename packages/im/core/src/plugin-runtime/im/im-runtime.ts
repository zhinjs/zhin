import {
  Scope,
  createToken,
  htmlRendererToken,
  type CapabilityId,
  type HtmlRendererHost,
  type PluginId,
  type RuntimeSnapshot,
  type SnapshotStore,
} from '@zhin.js/plugin-runtime';
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
  formatLegacyConversationRef,
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
  type ChannelParent,
  type DeliveryMessageGateway,
  type IncomingMessage,
  type MessageDispatchResult,
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
  runtimeInteractiveChannelKey,
  type RegisteredRuntimeInteractiveHandler,
  type RuntimeInteractiveHandler,
} from './interactive.js';

const logger = getLogger('im');

export const messageGatewayToken = createToken<DeliveryMessageGateway>('zhin.im.message-gateway');

/** Console 实时消息事件（SSE 推送源；content 仅为截断预览，不含完整原始段）。 */
export interface RuntimeMessageEvent {
  readonly direction: 'inbound' | 'outbound';
  readonly adapter: CapabilityId;
  readonly target: string;
  /** inbound：发送者 id。 */
  readonly sender?: string;
  /** outbound：发起方插件。 */
  readonly requester?: PluginId;
  /** inbound：从 target 前缀解析的场景（`group:xx` → `group`）。 */
  readonly channelType?: string;
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
}

export class ImRuntime implements DeliveryMessageGateway {
  readonly #dispatcher: MessageDispatcher;
  readonly #renderer: OutboundRenderer;
  readonly #messageListeners = new Set<(event: RuntimeMessageEvent) => void>();
  readonly #interactiveHandlers: RegisteredRuntimeInteractiveHandler[] = [];
  #snapshots?: SnapshotStore;
  #unmatchedHandler?: (
    message: Message,
    snapshot: RuntimeSnapshot,
    requester: PluginId,
  ) => Promise<boolean>;

  constructor(options: ImRuntimeOptions = {}) {
    this.#dispatcher = new MessageDispatcher(
      options.commandPrefix === undefined
        ? defaultCommandPrefixResolver
        : () => options.commandPrefix ?? '',
    );
    this.#renderer = options.renderer ?? new OutboundRenderer();
  }

  attach(snapshots: SnapshotStore): void {
    if (this.#snapshots && this.#snapshots !== snapshots) {
      throw new Error('ImRuntime is already attached to another Root');
    }
    this.#snapshots = snapshots;
  }

  /**
   * Optional Host AI / fallback path after Command miss (or non-prefixed text).
   * Return true when the message was handled (reply already sent).
   * `requester` is the Adapter Endpoint owner (for CapabilityIngress inheritance).
   */
  setUnmatchedHandler(
    handler: (
      message: Message,
      snapshot: RuntimeSnapshot,
      requester: PluginId,
    ) => Promise<boolean>,
  ): void {
    this.#unmatchedHandler = handler;
  }

  install(resources: Scope): void {
    resources.provide(messageGatewayToken, this);
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
      const requester = requireAdapters(lease.value).owner(input.adapter);
      logger.debug(formatCompact({
        op: 'im_inbound_receive',
        adapter: String(input.adapter).split('\0').pop() ?? String(input.adapter),
        target: input.target,
        sender: input.sender,
        id: input.id,
        preview: truncatePreview(input.content),
        segments: input.segments?.length,
        generation: lease.value.generation,
      }));
      const message = new Message(
        input.adapter,
        input.target,
        input.content,
        lease.value.generation,
        (content, replyRequester = requester) => {
          if (!active) throw new Error('Message reply scope has ended');
          return this.#sendWithSnapshot({
            adapter: input.adapter,
            ...(input.conversation ? { conversation: input.conversation } : {}),
            target: input.target,
            requester: replyRequester,
            content,
          }, lease.value);
        },
        input.id ?? input.message?.id,
        input.sender,
        Object.freeze({ ...input.metadata }),
        input.segments ? Object.freeze([...input.segments]) : undefined,
        input.conversation,
        input.message,
      );
      let result: MessageDispatchResult = Object.freeze({ matched: false });
      await runMiddleware(
        lease.value,
        message,
        async () => {
          result = await this.#dispatchInteractive(message, requester)
            ?? await this.#dispatcher.dispatch(message, lease.value);
          if (!result.matched && this.#unmatchedHandler) {
            logger.debug(formatCompact({
              op: 'im_inbound_unmatched_handler',
              target: input.target,
              id: input.id,
            }));
            const handled = await this.#unmatchedHandler(message, lease.value, requester);
            if (handled) {
              result = Object.freeze({ matched: true, command: 'ai', owner: requester });
            }
          }
        },
        'inbound',
      );
      logger.debug(formatCompact({
        op: 'im_inbound_done',
        target: input.target,
        id: input.id,
        matched: result.matched,
        command: result.command,
        owner: result.owner,
      }));
      this.#emitMessage({
        direction: 'inbound',
        adapter: input.adapter,
        target: input.target,
        ...(input.sender !== undefined ? { sender: input.sender } : {}),
        ...(channelTypeOf(input.target)
          ? { channelType: channelTypeOf(input.target) }
          : {}),
        contentPreview: previewText(input.content),
        ...(input.id ?? input.message?.id
          ? { messageId: input.id ?? input.message?.id }
          : {}),
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

  getEndpoint(adapter: string, endpointId: string): {
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
        const id = index.resolve(adapter, endpointId);
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
    readonly endpointId: string;
    readonly conversation?: ConversationRef;
    readonly channelId?: string;
    readonly channelType?: string;
    readonly content: unknown;
    readonly parent?: ChannelParent;
  }): Promise<{ messageId: string }> {
    const lease = this.#acquire();
    try {
      const index = requireAdapters(lease.value);
      const capabilityId = index.resolve(input.adapter, input.endpointId);
      if (!capabilityId) throw new Error('endpoint not found');
      const target = input.conversation
        ? formatLegacyConversationRef(input.conversation)
        : composeSendTarget(input.channelType ?? '', input.channelId ?? '');
      if (!target) throw new TypeError('conversation or channelId is required');
      const content = normalizeConsoleContent(input.content);
      const result = await this.#sendWithSnapshot({
        adapter: capabilityId,
        ...(input.conversation ? { conversation: input.conversation } : {}),
        target,
        requester: index.owner(capabilityId),
        content,
        ...(input.parent ? { parent: input.parent } : {}),
      }, lease.value);
      return { messageId: result.message?.id ?? result.legacyMessageId ?? '' };
    } finally {
      lease.release();
    }
  }

  /** Activity-feedback: add a message reaction when the live Endpoint supports it. */
  async addEndpointReaction(input: {
    readonly adapter: string;
    readonly endpointId: string;
    readonly message?: MessageRef;
    readonly messageId?: string;
    readonly emoji: string;
    readonly sceneType?: string;
    readonly channelId?: string;
  }): Promise<string | null> {
    const control = this.#liveEndpointControl(input.adapter, input.endpointId);
    return control?.addReaction?.(legacyMessageTarget(input.message, input.messageId), input.emoji, {
      sceneType: input.sceneType,
      channelId: input.channelId,
    }) ?? null;
  }

  async removeEndpointReaction(input: {
    readonly adapter: string;
    readonly endpointId: string;
    readonly message?: MessageRef;
    readonly messageId?: string;
    readonly reactionId: string;
  }): Promise<void> {
    await this.#liveEndpointControl(input.adapter, input.endpointId)
      ?.removeReaction?.(legacyMessageTarget(input.message, input.messageId), input.reactionId);
  }

  /** Activity-feedback autoRemove: recall a previously sent status message. */
  async recallEndpointMessage(input: {
    readonly adapter: string;
    readonly endpointId: string;
    readonly message?: MessageRef;
    readonly messageId?: string;
  }): Promise<void> {
    await this.#liveEndpointControl(input.adapter, input.endpointId)
      ?.recall?.(legacyMessageTarget(input.message, input.messageId));
  }

  async editEndpointMessage(input: {
    readonly adapter: string;
    readonly endpointId: string;
    readonly message?: MessageRef;
    readonly messageId?: string;
    readonly content: unknown;
  }): Promise<string | null> {
    return this.#liveEndpointControl(input.adapter, input.endpointId)
      ?.edit?.(legacyMessageTarget(input.message, input.messageId), input.content) ?? null;
  }

  async setEndpointTyping(input: {
    readonly adapter: string;
    readonly endpointId: string;
    readonly conversation?: ConversationRef;
    readonly target?: string;
    readonly active?: boolean;
  }): Promise<void> {
    const target = input.conversation
      ? formatLegacyConversationRef(input.conversation)
      : input.target;
    if (!target) throw new TypeError('conversation or target is required');
    await this.#liveEndpointControl(input.adapter, input.endpointId)
      ?.typing?.(target, input.active);
  }

  #liveEndpoint(adapter: string, endpointId: string): unknown | null {
    try {
      const lease = this.#acquire();
      try {
        const endpoint = requireAdapters(lease.value).instance(adapter, endpointId);
        return endpoint ?? null;
      } finally {
        lease.release();
      }
    } catch {
      return null;
    }
  }

  #liveEndpointControl(adapter: string, endpointId: string): EndpointControl | null {
    const endpoint = this.#liveEndpoint(adapter, endpointId);
    return resolveEndpointControl(endpoint) ?? null;
  }

  /**
   * Console endpoint 社交/群管 RPC：解析 live Endpoint 实例（无则 null）。
   * @deprecated Host callers should use `getEndpointManagement()`.
   */
  getLiveEndpoint(adapter: string, endpointId: string): unknown | null {
    return this.#liveEndpoint(adapter, endpointId);
  }

  /**
   * Narrow Host seam for Console social/group management. An empty object means
   * the Endpoint exists but implements no management operations; null means it
   * cannot be resolved.
   */
  getEndpointManagement(adapter: string, endpointId: string): EndpointManagement | null {
    const endpoint = this.#liveEndpoint(adapter, endpointId);
    if (!endpoint) return null;
    return resolveEndpointManagement(endpoint) ?? Object.freeze({});
  }

  async #sendWithSnapshot(
    request: SendRequest,
    snapshot: RuntimeSnapshot,
  ): Promise<DeliveryReceipt> {
    let initialPayload: unknown;
    try {
      const rendered = await this.#renderer.render(request.content, request.requester, snapshot);
      initialPayload = await prepareOutboundPayload(rendered, request, snapshot);
    } catch {
      return rejectedReceipt('outbound_payload_rejected');
    }

    const envelope = createOutboundEnvelope({
      adapter: request.adapter,
      ...(request.conversation ? { conversation: request.conversation } : {}),
      target: request.target,
      requester: request.requester,
      generation: snapshot.generation,
      ...(request.parent ? { parent: request.parent } : {}),
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
            // Middleware may replace a payload with legacy/wire segments. Normalize
            // again at the transport boundary so it cannot bypass core policy.
            payload = await prepareOutboundPayload(envelope.payload, request, snapshot, true);
          } catch {
            receipt = rejectedReceipt('outbound_payload_rejected');
            return;
          }

          try {
            const result = await requireAdapters(snapshot).send(request.adapter, {
              target: request.target,
              ...(request.conversation ? { conversation: request.conversation } : {}),
              payload,
              ...(request.parent ? { parent: request.parent } : {}),
            });
            receipt = receiptFromEndpointResult(result);
          } catch (error) {
            receipt = receiptFromEndpointError(error);
          }

          if (receipt?.status === 'sent') {
            this.#emitMessage({
              direction: 'outbound',
              adapter: request.adapter,
              target: request.target,
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
      // If a middleware fails after the terminal, the endpoint has already
      // produced its receipt (and, for a real send, its event). Keep that fact.
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
  request: SendRequest,
  snapshot: RuntimeSnapshot,
  finalizeInteractive = false,
): Promise<unknown> {
  const directHtml = isDirectHtmlConsumer(snapshot, request.adapter);
  let payload = directHtml
    ? rendered
    : await normalizeOutboundPayload(rendered, resolveHtmlRenderer(snapshot), {
      mediaPolicy: resolveOutboundMediaPolicy(request.adapter, snapshot),
    });
  if (finalizeInteractive) {
    payload = applyOutboundInteractivePolicy(
      payload,
      resolveOutboundInteractivePolicy(request.adapter, snapshot),
      (map) => keyboardFallbackStore.remember(
        runtimeInteractiveChannelKey(String(request.adapter), request.target),
        map,
      ),
    );
  }
  // Segment arrays crossing the adapter boundary are canonical after every
  // middleware transform. Direct html consumers retain their explicit wire API.
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

/**
 * Build Adapter send target. If channelId already carries a scene prefix
 * (`private:uid` / `group:gid`), do not double-prefix.
 */
function composeSendTarget(channelType: string, channelId: string): string {
  const id = channelId.trim();
  if (!id) return channelType || '';
  if (/^(private|group|channel|direct|c2c|temp):/iu.test(id)) return id;
  return channelType ? `${channelType}:${id}` : id;
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

/** target 前缀场景：`group:123` → `group`；无前缀返回 undefined。 */
function channelTypeOf(target: string): string | undefined {
  const match = /^([a-z0-9-]+):/iu.exec(target);
  return match?.[1];
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
