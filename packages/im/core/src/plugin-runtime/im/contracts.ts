import type { JSXElement } from '@zhin.js/jsx';
import { commandFeatureId, isCommandIndex, type CommandMenuPage } from '@zhin.js/command';
import { resolveLocale, type PluginId, type RuntimeSnapshot, type Locale } from '@zhin.js/plugin-runtime';
import { operationInputBinding, operationInputSignal, operationSession, type OperationSession } from '@zhin.js/feature-kit';
import type { ConversationRef, DeliveryReceipt, MessageRef } from '@zhin.js/im-contract';
import type { MessageOrigin } from './inbound-origin.js';
import type { OperationEndpointSource } from './operation-endpoint.js';
import type { MediaRef, Segment } from '../../built/segment-contract/types.js';
import { interactionOperationScope, type InteractionOperationScope } from './interaction-operation.js';
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
 * 惰性 JSXElement / ComponentCall / RawContent，可任意嵌套数组。
 */
export type SendContent = string | Segment | JSXElement | ComponentCall | RawContent | readonly SendContent[];

export function component<TProps>(name: string, props: TProps): ComponentCall<TProps> {
  if (!name.trim()) throw new TypeError('Component name cannot be empty');
  return Object.freeze({ $content: componentCallBrand, name, props });
}

export function raw<TPayload>(payload: TPayload): RawContent<TPayload> {
  return Object.freeze({ $content: rawContentBrand, payload });
}

export function isComponentCall(value: unknown): value is ComponentCall {
  return !Array.isArray(value)
    && typeof value === 'object'
    && value !== null
    && '$content' in value
    && value.$content === componentCallBrand;
}

export function isRawContent(value: unknown): value is RawContent {
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
  /** Original SDK message callback object; operation-only, not a persistence field. */
  readonly event?: unknown;
  readonly platformSentAt?: number;
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

export interface SendRequest extends OperationEndpointSource {
  /** Language captured by the sending operation; absent for explicit sends without a user. */
  readonly locale?: Locale;
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
  readonly status?: 'unmatched' | 'invalid' | 'denied' | 'limited' | 'executed';
  readonly limit?: import('@zhin.js/command').CommandExecutionLimit;
  readonly issues?: readonly Readonly<{ field: string; message: string }>[];
  readonly help?: string;
  readonly command?: string;
  readonly owner?: PluginId;
  readonly value?: unknown;
  readonly menu?: CommandMenuPage;
}

/** Canonical message value delivered to inbound middleware and handlers. */
export interface MessageBase extends Omit<IncomingMessage, 'event' | 'platformSentAt'> {
  /** Language resolved from the sender and project when this operation began. */
  readonly locale: Locale;
  /** Effective chat command environment; undefined means no resolved environment. */
  readonly commandPrefix?: string;
  readonly commandMenu?: string;
  /** Read-only reference to an installed command, using this operation's actual prefix. */
  formatCommand(localPath: string, owner?: PluginId): string | undefined;
  readonly generation: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly id?: string;
  readonly clientAdapter?: string;
  /**
   * 入站来源（self / member / peer_bot / human），仅由 InboundRuntime 可信判定写入；
   * 合成消息（Console / Sandbox / 定时任务）为 undefined。绝不从 metadata / 正文读取。
   */
  readonly origin?: MessageOrigin;
  readonly $client: unknown;
  readonly $reply: (content: SendContent) => Promise<DeliveryReceipt>;
  readonly $replyFrom: (requester: PluginId, content: SendContent) => Promise<DeliveryReceipt>;
  readonly $sendTo: (conversation: ConversationAddress, content: SendContent) => Promise<DeliveryReceipt>;
  readonly $replyToPrivate: (
    content: SendContent,
    from?: boolean | { readonly kind: 'group' | 'channel'; readonly id: string },
  ) => Promise<DeliveryReceipt>;
  readonly $replyToGroup: (groupId: string, content: SendContent) => Promise<DeliveryReceipt>;
  readonly $replyToChannel: (channelId: string, guildId: string, content: SendContent, threadId?: string) => Promise<DeliveryReceipt>;
}

/** Captured once from the actual inbound Endpoint operation, never from message metadata. */
export interface RuntimeMessageSessionBinding {
  readonly adapter: unknown;
  readonly endpoint: unknown;
  readonly adapterName: string;
  readonly event: unknown;
  readonly receivedAt: number;
  readonly platformSentAt?: number;
  readonly platformRoles?: readonly string[];
  readonly authorizationRoles?: readonly string[];
  readonly signal: AbortSignal;
}

/** Canonical runtime message with optional plugin-owned extensions. */
export type Message<T extends object = {}> = MessageBase & T;

/** @internal Generation-scoped implementation of the public Message contract. */
export class RuntimeMessage implements MessageBase {
  readonly locale: Locale;
  readonly commandPrefix?: string;
  readonly commandMenu?: string;
  readonly #resolveClient: () => unknown;
  readonly #reply: (content: SendContent, requester?: PluginId, targetConversation?: ConversationAddress) => Promise<DeliveryReceipt>;
  readonly #author?: PluginId;
  readonly #snapshot?: RuntimeSnapshot;
  readonly #assertActive?: () => void;
  readonly #retirementSignal?: AbortSignal;
  readonly #sessionBinding?: RuntimeMessageSessionBinding;
  readonly #session?: OperationSession<string>;
  readonly #registerOperationView?: (view: object, owner: PluginId) => void;
  readonly origin?: MessageOrigin;

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
    binding: Readonly<{
      locale?: Locale;
      commands?: Readonly<{ prefix: string; menu?: string }>;
      resolveCommands?: (message: RuntimeMessage) => Readonly<{ prefix: string; menu?: string }>;
      requester?: PluginId;
      snapshot?: RuntimeSnapshot;
      assertActive?: () => void;
      origin?: MessageOrigin;
      retirementSignal?: AbortSignal;
      session?: RuntimeMessageSessionBinding;
      registerOperationView?: (view: object, owner: PluginId) => void;
    }> = {},
  ) {
    this.locale = resolveLocale(binding.locale);
    this.origin = binding.origin;
    this.#resolveClient = client;
    this.#reply = reply;
    this.#author = binding.requester;
    this.#snapshot = binding.snapshot;
    this.#assertActive = binding.assertActive;
    this.#retirementSignal = binding.retirementSignal;
    this.#sessionBinding = binding.session;
    this.#registerOperationView = binding.registerOperationView;
    if (binding.snapshot) binding.registerOperationView?.(this, binding.requester ?? binding.snapshot.root);
    const requester = binding.requester;
    this.$reply = (content) => requester === undefined ? reply(content) : reply(content, requester);
    this.$replyFrom = (requester, content) => reply(content, requester);
    this.$sendTo = (target, content) => reply(content, requester, target);
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
      return reply(content, requester, {
        kind: 'private',
        id: sender.id,
        ...(parent ? { parent } : {}),
      });
    };
    this.$replyToGroup = (groupId, content) => {
      return reply(content, requester, { kind: 'group', id: groupId });
    };
    this.$replyToChannel = (channelId, guildId, content, threadId) => {
      return reply(content, requester, {
        kind: 'channel',
        id: channelId,
        parent: { kind: 'channel', id: guildId },
        ...(threadId ? { threadId } : {}),
      });
    };
    const commands = binding.commands ?? binding.resolveCommands?.(this);
    this.commandPrefix = commands?.prefix;
    this.commandMenu = commands?.menu;
    if (binding.session) {
      const captured = binding.session;
      const scene = Object.freeze({ ...conversation,
        endpoint: Object.freeze({ ...conversation.endpoint }),
        ...(conversation.parent ? { parent: Object.freeze({ ...conversation.parent }) } : {}),
      });
      this.#session = Object.freeze({
        adapterName: captured.adapterName, adapter: captured.adapter, endpoint: captured.endpoint,
        scene, event: captured.event, signal: captured.signal,
        ...(sender ? { sender: Object.freeze({ id: sender.id, ...(sender.name !== undefined ? { name: sender.name } : {}),
          ...(captured.platformRoles ? { platformRoles: Object.freeze([...captured.platformRoles]) } : {}),
          ...(captured.authorizationRoles ? { authorizationRoles: Object.freeze([...captured.authorizationRoles]) } : {}),
        }) } : {}),
        message: Object.freeze({ text: content, receivedAt: captured.receivedAt,
          ...(message ? { id: message.id, ref: Object.freeze({ conversation: scene, id: message.id }) } : {}),
          ...(segments ? { segments } : {}),
          ...(captured.platformSentAt !== undefined ? { platformSentAt: captured.platformSentAt } : {}),
          ...(mentioned !== undefined ? { mentioned } : {}),
          ...(replyTo ? { replyTo: Object.freeze({ ...replyTo }) } : {}),
        }),
        reply: (value: unknown) => this.$reply(value as SendContent),
      });
    }
    Object.freeze(this);
  }

  /** The same captured data, with reply authority rebound by operationInputBinding. */
  [operationSession](): OperationSession<string> | undefined {
    this.#assertActive?.();
    return this.#session;
  }

  /** @internal A frozen view whose sends retain the current author's exact operation. */
  [operationInputBinding](owner: PluginId, snapshot: RuntimeSnapshot): RuntimeMessage {
    this.#assertActive?.();
    if (snapshot.generation !== this.generation || (this.#snapshot && snapshot !== this.#snapshot)) {
      throw new Error('Message author binding belongs to another generation operation');
    }
    if (!snapshot.tree.has(owner)) throw new Error(`Unknown Message author: ${owner}`);
    if (this.#author === owner && this.#snapshot === snapshot) return this;
    return new RuntimeMessage(
      this.conversation, this.content, this.generation, this.#reply,
      this.sender, this.metadata, this.segments, this.message, this.endpointId,
      this.mentioned, this.replyTo, this.#resolveClient, this.clientAdapter,
      { requester: owner, snapshot, locale: this.locale,
        ...(this.commandPrefix !== undefined ? { commands: { prefix: this.commandPrefix, menu: this.commandMenu } } : {}),
        assertActive: this.#assertActive, origin: this.origin,
        retirementSignal: this.#retirementSignal, session: this.#sessionBinding, registerOperationView: this.#registerOperationView },
    );
  }

  /** @internal Retirement notification; ordinary leased sends may still drain. */
  [operationInputSignal](): AbortSignal | undefined {
    this.#assertActive?.();
    return this.#retirementSignal;
  }

  /** @internal The command/handler author's actual leased operation. */
  [interactionOperationScope](): InteractionOperationScope | undefined {
    this.#assertActive?.();
    return this.#snapshot ? {
      snapshot: this.#snapshot,
      owner: this.#author ?? this.#snapshot.root,
      retirementSignal: this.#retirementSignal,
    } : undefined;
  }

  /** 平台原生消息 id（`message` 未提供时为 undefined）。 */
  get id(): string | undefined {
    return this.message?.id;
  }

  formatCommand(localPath: string, owner?: PluginId): string | undefined {
    this.#assertActive?.();
    if (!this.#snapshot) return undefined;
    const commands = this.#snapshot.projections.get(commandFeatureId);
    return isCommandIndex(commands)
      ? commands.formatCommand(owner ?? this.#author ?? this.#snapshot.root, localPath, this.commandPrefix, this.locale)
      : undefined;
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

/** Constructor for canonical runtime Message values. */
export const Message = RuntimeMessage;

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
