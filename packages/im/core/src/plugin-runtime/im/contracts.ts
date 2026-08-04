import type { CapabilityId, PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { ConversationRef, DeliveryReceipt, MessageRef } from '@zhin.js/im-contract';
import type { MediaRef, Segment } from '../../built/segment-contract/types.js';
// 入站段统一使用 canonical Segment SSOT（built/segment-contract）；
// 经 plugin-runtime/im/index.ts re-export，供 runtime 消费者直接引用。
export type { MediaRef, Segment };

const componentCallBrand = 'zhin.component-call/1' as const;
const rawContentBrand = 'zhin.raw-content/1' as const;

export interface ComponentCall<TProps = unknown> {
  readonly $content: typeof componentCallBrand;
  readonly name: string;
  readonly props: TProps;
}

export interface RawContent<TPayload = unknown> {
  readonly $content: typeof rawContentBrand;
  readonly payload: TPayload;
}

/**
 * 出站内容：纯文本 / canonical Segment（一等公民，媒体与富文本的统一表达）/
 * ComponentCall / RawContent，可任意嵌套数组。
 */
export type SendContent = string | Segment | ComponentCall | RawContent | readonly SendContent[];

export function component<TProps>(name: string, props: TProps): ComponentCall<TProps> {
  if (!name.trim()) throw new TypeError('Component name cannot be empty');
  return Object.freeze({ $content: componentCallBrand, name, props });
}

export function raw<TPayload>(payload: TPayload): RawContent<TPayload> {
  return Object.freeze({ $content: rawContentBrand, payload });
}

export function isComponentCall(value: SendContent): value is ComponentCall {
  return !Array.isArray(value)
    && typeof value === 'object'
    && value !== null
    && '$content' in value
    && value.$content === componentCallBrand;
}

export function isRawContent(value: SendContent): value is RawContent {
  return !Array.isArray(value)
    && typeof value === 'object'
    && value !== null
    && '$content' in value
    && value.$content === rawContentBrand;
}

/** canonical Segment 一等公民判定（与 ComponentCall/RawContent 的 $content brand 互斥）。 */
export function isSegmentContent(value: unknown): value is Segment {
  return !Array.isArray(value)
    && typeof value === 'object'
    && value !== null
    && !('$content' in value)
    && typeof (value as { type?: unknown }).type === 'string'
    && typeof (value as { data?: unknown }).data === 'object'
    && (value as { data?: unknown }).data !== null;
}

export interface IncomingMessage {
  readonly adapter: CapabilityId;
  /** Structured identity supplied by migrated adapters; target remains the bridge. */
  readonly conversation?: ConversationRef;
  /** Structured native message identity supplied by migrated adapters. */
  readonly message?: MessageRef;
  readonly target: string;
  /**
   * 纯文本视图：与 `segments` 同源（adapter 从同一份入站载荷派生二者）。
   * 触发判定与 Console 预览读取此字段；命令匹配在有 segments 时优先使用结构化视图。
   */
  readonly content: string;
  /**
   * 结构化段视图（canonical Segment SSOT，见 built/segment-contract）。
   * 与 `content` 同源：segments 承载纯文本无法表达的媒体（image/audio/video/file
   * 的 MediaRef）、mention、reply 等信息。旧 adapter 未迁移时可缺省，
   * 读取方必须容忍 undefined。
   */
  readonly segments?: readonly Segment[];
  readonly id?: string;
  readonly sender?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SendRequest {
  readonly adapter: CapabilityId;
  /** Structured destination supplied to Adapter endpoints in parallel with target. */
  readonly conversation?: ConversationRef;
  readonly target: string;
  readonly requester: PluginId;
  readonly content: SendContent;
  readonly parent?: ChannelParent;
}

/** Console 通道的来源场景（群临时会话 parent.group / QQ 子频道 parent.guild）。 */
export interface ChannelParent {
  readonly type?: string;
  readonly id?: string;
  readonly name?: string;
}

export interface OutboundEnvelope {
  readonly adapter: CapabilityId;
  readonly conversation?: ConversationRef;
  readonly target: string;
  readonly requester: PluginId;
  readonly generation: number;
  readonly payload: unknown;
  readonly parent?: ChannelParent;
  replace(payload: unknown): void;
}

export interface MessageGateway {
  receive(input: IncomingMessage): Promise<MessageDispatchResult>;
  /**
   * Compatibility surface for existing Adapter-facing gateway consumers.
   * Runtime callers that need an outcome use DeliveryMessageGateway instead.
   */
  send(request: SendRequest): Promise<unknown>;
  /**
   * 注册 interactive action 回跳 handler（prefix 最长匹配；返回注销函数）。
   * 平台 callback 的 action 段、'text' 端点的数字回跳与指令预填直出
   * payload 都会路由到这里。
   */
  registerInteractiveHandler(
    prefix: string,
    handler: (message: Message) => Promise<boolean> | boolean,
  ): () => void;
  /**
   * Command miss（或非前缀文本）后的回退处理：Host AI 对话、单文件 bot 用。
   * 返回 true 表示已处理（回复已发送）；后注册者覆盖前者。
   * `requester` 是消息所属 Adapter Endpoint 的 owner（用于 CapabilityIngress 继承）。
   */
  setUnmatchedHandler(
    handler: (
      message: Message,
      snapshot: RuntimeSnapshot,
      requester: PluginId,
    ) => Promise<boolean>,
  ): void;
}

/** Structured outbound gateway exposed by the Plugin Runtime. */
export interface DeliveryMessageGateway extends MessageGateway {
  send(request: SendRequest): Promise<DeliveryReceipt>;
}

export interface MessageDispatchResult {
  readonly matched: boolean;
  readonly command?: string;
  readonly owner?: PluginId;
  readonly value?: unknown;
}

export class Message {
  constructor(
    readonly adapter: CapabilityId,
    readonly target: string,
    readonly content: string,
    readonly generation: number,
    // Compatibility at the construction boundary: legacy tests and embedders
    // may still supply an untyped reply callback. ImRuntime always supplies a
    // DeliveryReceipt-producing implementation.
    reply: (content: SendContent, requester?: PluginId) => Promise<unknown>,
    readonly id?: string,
    readonly sender?: string,
    readonly metadata: Readonly<Record<string, unknown>> = Object.freeze({}),
    /**
     * 结构化段视图（与 `content` 纯文本视图同源，见 IncomingMessage.segments）。
     * Command dispatcher 优先使用此字段，以支持 mention、image 等结构化参数。
     */
    readonly segments?: readonly Segment[],
    /** Structured inbound conversation when supplied by a migrated adapter. */
    readonly conversation?: ConversationRef,
    /** Structured inbound message identity when supplied by a migrated adapter. */
    readonly message?: MessageRef,
  ) {
    this.$reply = (content) => reply(content) as Promise<DeliveryReceipt>;
    this.$replyFrom = (requester, content) => reply(content, requester) as Promise<DeliveryReceipt>;
    Object.freeze(this);
  }

  readonly $reply: (content: SendContent) => Promise<DeliveryReceipt>;
  readonly $replyFrom: (requester: PluginId, content: SendContent) => Promise<DeliveryReceipt>;
}

export function createOutboundEnvelope(
  request: Omit<OutboundEnvelope, 'payload' | 'replace'>,
  initialPayload: unknown,
): OutboundEnvelope {
  let payload = initialPayload;
  return Object.freeze({
    ...request,
    get payload() { return payload; },
    replace(next: unknown) { payload = next; },
  });
}
