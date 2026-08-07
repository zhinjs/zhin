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
    this.$replyToPrivate = (content, from) => {
      if (!sender) throw new Error('Cannot $replyToPrivate: message has no sender');
      let parent: ConversationAddress['parent'] | undefined;
      if (from === true) {
        if (conversation.kind === 'private') throw new Error('$replyToPrivate(content, true) requires a group or channel conversation');
        parent = { kind: conversation.kind, id: conversation.id };
      } else if (from != null && typeof from === 'object') {
        parent = from;
      }
      return reply(content, undefined, {
        kind: 'private',
        id: sender,
        ...(parent ? { parent } : {}),
      });
    };
    this.$replyToGroup = (groupId, content) => {
      return reply(content, undefined, { kind: 'group', id: groupId });
    };
    this.$replyToChannel = (channelId, guildId, content, threadId) => {
      return reply(content, undefined, {
        kind: 'channel',
        id: channelId,
        parent: { kind: 'channel', id: guildId },
        ...(threadId ? { threadId } : {}),
      });
    };
    Object.freeze(this);
  }

  /** 平台原生消息 id（`message` 未提供时为 undefined）。 */
  get id(): string | undefined {
    return this.message?.id;
  }

  readonly $reply: (content: SendContent) => Promise<DeliveryReceipt>;
  readonly $replyFrom: (requester: PluginId, content: SendContent) => Promise<DeliveryReceipt>;
  /**
   * 向同 Endpoint 的另一个通道发送消息（通用）。
   *
   * ```ts
   * await message.$sendTo({ kind: 'channel', id: 'ch-1', parent: { kind: 'channel', id: 'guild-1' } }, '频道通知');
   * ```
   */
  readonly $sendTo: (conversation: ConversationAddress, content: SendContent) => Promise<DeliveryReceipt>;
  /**
   * 私信当前消息的发送者（同 Endpoint）。
   *
   * @param content 消息内容
   * @param from 会话上下文：
   *   - `true` — 用当前群/频道作为 parent（要求当前不在私聊中）
   *   - `{ kind, id }` — 显式指定 parent（群或子频道）
   *   - 省略 — 直接私信
   *
   * ```ts
   * await message.$replyToPrivate('直接私信');
   * await message.$replyToPrivate('群临时私信', true);
   * await message.$replyToPrivate('频道私信', { kind: 'channel', id: '子频道ID' });
   * ```
   */
  readonly $replyToPrivate: (
    content: SendContent,
    from?: boolean | { readonly kind: 'group' | 'channel'; readonly id: string },
  ) => Promise<DeliveryReceipt>;
  /**
   * 向指定群发送消息（同 Endpoint）。
   *
   * ```ts
   * await message.$replyToGroup('67890', '群通知');
   * ```
   */
  readonly $replyToGroup: (groupId: string, content: SendContent) => Promise<DeliveryReceipt>;
  /**
   * 向指定频道/子频道发送消息（同 Endpoint）。
   *
   * ```ts
   * await message.$replyToChannel('channel-1', 'guild-1', '频道通知');
   * await message.$replyToChannel('channel-1', 'guild-1', '话题回复', 'thread-1');
   * ```
   */
  readonly $replyToChannel: (channelId: string, guildId: string, content: SendContent, threadId?: string) => Promise<DeliveryReceipt>;
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
