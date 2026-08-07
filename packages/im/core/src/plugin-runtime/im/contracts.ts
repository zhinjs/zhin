import type { PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
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
  readonly conversation: ConversationRef;
  readonly message?: MessageRef;
  readonly content: string;
  readonly segments?: readonly Segment[];
  readonly sender?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SendRequest {
  readonly conversation: ConversationRef;
  readonly requester: PluginId;
  readonly content: SendContent;
}

/**
 * Host 侧未锚定 endpoint 的会话地址（Console RPC / OutboundHost 入参）；
 * ImRuntime 解析 adapter/endpointId 后锚定为完整 ConversationRef。
 */
export type ConversationAddress = Omit<ConversationRef, 'endpoint'>;

export interface OutboundEnvelope {
  readonly conversation: ConversationRef;
  readonly requester: PluginId;
  readonly generation: number;
  readonly payload: unknown;
  replace(payload: unknown): void;
}

export interface MessageGateway {
  receive(input: IncomingMessage): Promise<MessageDispatchResult>;
  send(request: SendRequest): Promise<DeliveryReceipt>;
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


export interface MessageDispatchResult {
  readonly matched: boolean;
  readonly command?: string;
  readonly owner?: PluginId;
  readonly value?: unknown;
}

export class Message {
  constructor(
    readonly conversation: ConversationRef,
    readonly content: string,
    readonly generation: number,
    reply: (content: SendContent, requester?: PluginId, targetConversation?: ConversationAddress) => Promise<DeliveryReceipt>,
    readonly sender?: string,
    readonly metadata: Readonly<Record<string, unknown>> = Object.freeze({}),
    /**
     * 结构化段视图（与 `content` 纯文本视图同源，见 IncomingMessage.segments）。
     * Command dispatcher 优先使用此字段，以支持 mention、image 等结构化参数。
     */
    readonly segments?: readonly Segment[],
    /** 结构化入站消息身份（平台原生 message id 经 MessageRef 传递）。 */
    readonly message?: MessageRef,
  ) {
    this.$reply = (content) => reply(content);
    this.$replyFrom = (requester, content) => reply(content, requester);
    this.$sendTo = (target, content) => reply(content, undefined, target);
    Object.freeze(this);
  }

  /** 平台原生消息 id（`message` 未提供时为 undefined）。 */
  get id(): string | undefined {
    return this.message?.id;
  }

  readonly $reply: (content: SendContent) => Promise<DeliveryReceipt>;
  readonly $replyFrom: (requester: PluginId, content: SendContent) => Promise<DeliveryReceipt>;
  /**
   * 向同 Endpoint 的另一个通道发送消息。
   *
   * ```ts
   * await message.$sendTo({ kind: 'group', id: '67890' }, '通知内容');
   * await message.$sendTo({ kind: 'private', id: '12345' }, '私信提醒');
   * ```
   */
  readonly $sendTo: (conversation: ConversationAddress, content: SendContent) => Promise<DeliveryReceipt>;
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
