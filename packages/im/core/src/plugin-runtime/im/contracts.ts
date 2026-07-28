import type { CapabilityId, PluginId } from '@zhin.js/plugin-runtime';
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

export type SendContent = string | ComponentCall | RawContent | readonly SendContent[];

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

export interface IncomingMessage {
  readonly adapter: CapabilityId;
  readonly target: string;
  /**
   * 纯文本视图：与 `segments` 同源（adapter 从同一份入站载荷派生二者）。
   * 命令匹配、触发判定、Console 预览只读此字段，无需感知段。
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
  readonly target: string;
  readonly requester: PluginId;
  readonly generation: number;
  readonly payload: unknown;
  readonly parent?: ChannelParent;
  replace(payload: unknown): void;
}

export interface MessageGateway {
  receive(input: IncomingMessage): Promise<MessageDispatchResult>;
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
    reply: (content: SendContent, requester?: PluginId) => Promise<unknown>,
    readonly id?: string,
    readonly sender?: string,
    readonly metadata: Readonly<Record<string, unknown>> = Object.freeze({}),
    /**
     * 结构化段视图（与 `content` 纯文本视图同源，见 IncomingMessage.segments）。
     * middleware / CommandIndex / dispatcher 不读此字段，零改动兼容。
     */
    readonly segments?: readonly Segment[],
  ) {
    this.$reply = (content) => reply(content);
    this.$replyFrom = (requester, content) => reply(content, requester);
    Object.freeze(this);
  }

  readonly $reply: (content: SendContent) => Promise<unknown>;
  readonly $replyFrom: (requester: PluginId, content: SendContent) => Promise<unknown>;
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
