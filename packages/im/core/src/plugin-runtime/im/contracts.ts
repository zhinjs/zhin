import type { PluginId } from '@zhin.js/plugin-runtime';
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

export interface MessageSenderRef {
  readonly id: string;
  readonly name?: string;
  readonly roles?: readonly string[];
}

export interface IncomingMessage {
  readonly conversation: ConversationRef;
  readonly message?: MessageRef;
  readonly content: string;
  readonly segments?: readonly Segment[];
  readonly sender?: MessageSenderRef;
  /** Endpoint 实例名（如 ICQQ uin、sandbox bot name），区别于 conversation.endpoint.id（CapabilityId）。 */
  readonly endpointId?: string;
  /** 消息是否 @了机器人。 */
  readonly mentioned?: boolean;
  /** 引用/回复的原始消息。 */
  readonly replyTo?: { readonly id: string };
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * 入站消息上下文快照 — 由 reply 闭包捕获，沿出站链路传递到模板编译。
 * 定时任务 / 跨通道发送时整个 incoming 为 undefined。
 */
export interface IncomingContext {
  readonly sender?: MessageSenderRef;
  /** 收到的消息纯文本内容。 */
  readonly content: string;
  /** 结构化消息段（图片、@、引用等）。 */
  readonly segments?: readonly Segment[];
  /** 平台原生消息 ID。 */
  readonly messageId?: string;
  /** 消息到达时间戳（ms）。 */
  readonly timestamp: number;
  /** Endpoint 实例名（如 ICQQ uin、sandbox bot name）。 */
  readonly endpointId?: string;
  /** 消息是否 @了机器人。 */
  readonly mentioned?: boolean;
}

export interface SendRequest {
  readonly conversation: ConversationRef;
  readonly requester: PluginId;
  readonly content: SendContent;
  /** Incoming message context (absent for scheduled / cross-channel sends). */
  readonly incoming?: IncomingContext;
}

/**
 * Host 侧未锚定 endpoint 的会话地址（Console RPC / OutboundHost 入参）；
 * ImRuntime 解析 adapter/endpointKey 后锚定为完整 ConversationRef。
 */
export type ConversationAddress = Omit<ConversationRef, 'endpoint'>;

export interface OutboundEnvelope {
  readonly conversation: ConversationRef;
  readonly requester: PluginId;
  readonly generation: number;
  readonly payload: unknown;
  /** Native platform Client for the Endpoint selected by `conversation`. */
  readonly $client: unknown;
  /** Literal adapter name used to validate adapter-bound middleware. */
  readonly clientAdapter?: string;
  replace(payload: unknown): void;
}

/** @public Stable IM gateway contract resolved through `outboundMessageToken`. */
export interface OutboundMessageService {
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
}


export interface MessageDispatchResult {
  readonly matched: boolean;
  readonly command?: string;
  readonly owner?: PluginId;
  readonly value?: unknown;
}

export class Message {
  readonly #resolveClient: () => unknown;

  /** @internal Constructed only by the generation-owned IM Runtime. */
  constructor(
    readonly conversation: ConversationRef,
    readonly content: string,
    readonly generation: number,
    reply: (content: SendContent, requester?: PluginId, targetConversation?: ConversationAddress) => Promise<DeliveryReceipt>,
    readonly sender?: MessageSenderRef,
    readonly metadata: Readonly<Record<string, unknown>> = Object.freeze({}),
    /**
     * 结构化段视图（与 `content` 纯文本视图同源，见 IncomingMessage.segments）。
     * Command dispatcher 优先使用此字段，以支持 mention、image 等结构化参数。
     */
    readonly segments?: readonly Segment[],
    /** 结构化入站消息身份（平台原生 message id 经 MessageRef 传递）。 */
    readonly message?: MessageRef,
    readonly endpointId?: string,
    readonly mentioned?: boolean,
    readonly replyTo?: { readonly id: string },
    client: () => unknown = () => {
      throw new Error('Message has no Endpoint Client context');
    },
    readonly clientAdapter?: string,
  ) {
    this.#resolveClient = client;
    this.$reply = (content) => reply(content);
    this.$replyFrom = (requester, content) => reply(content, requester);
    this.$sendTo = (target, content) => reply(content, undefined, target);
    this.$replyToPrivate = (content, from) => {
      if (!sender) throw new Error('Cannot $replyToPrivate: message has no sender');
      let parent: ConversationAddress['parent'] | undefined;
      if (from === true) {
        if (conversation.kind !== 'group' && conversation.kind !== 'channel') {
          throw new Error('Cannot $replyToPrivate with from=true: current conversation must be a group or channel');
        }
        parent = { kind: conversation.kind, id: conversation.id };
      } else if (from != null && typeof from === 'object') {
        parent = from;
      }
      return reply(content, undefined, {
        kind: 'private',
        id: sender.id,
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
  /**
   * Platform-native Client that received this message. The getter is
   * generation-scoped; retaining the returned Client after dispatch is invalid.
   */
  get $client(): unknown {
    return this.#resolveClient();
  }
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
  request: Omit<OutboundEnvelope, 'payload' | '$client' | 'replace'>,
  initialPayload: unknown,
  resolveClient: () => unknown = () => undefined,
): OutboundEnvelope {
  let payload = initialPayload;
  return Object.freeze({
    ...request,
    get payload() { return payload; },
    get $client() { return resolveClient(); },
    replace(next: unknown) { payload = next; },
  });
}
