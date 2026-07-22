import { Endpoint } from "./endpoint.js";
import {
  assertOutbound,
  DEFAULT_ENDPOINT_CAPABILITIES,
  hasInbound,
  type EndpointCapability,
} from "./endpoint-capabilities.js";
import { connectEndpointInstance, disconnectEndpointInstance } from "./built/connect-endpoint-instance.js";
import type { EndpointManager } from "./built/endpoint-manager.js";
import { Plugin } from "./plugin.js";
import { EventEmitter } from "node:events";
import { Message } from "./message.js";
import { Notice } from "./notice.js";
import { Request } from "./request.js";
import { BeforeSendHandler, EditMessageOptions, SendOptions } from "./types.js";
import { getOutboundReplyStore } from "./built/dispatcher.js";
import {
  DEFAULT_OUTBOUND_RICH_SEGMENT_POLICY,
  resolveRichSegments,
  type OutboundRichSegmentPolicy,
} from "./built/rich-segments/index.js";
import {
  DEFAULT_INTERACTIVE_POLICY,
  resolveInteractiveSegments,
  type InteractivePolicy,
} from "./built/interactive-segments/index.js";
import {
  DEFAULT_AI_OUTBOUND_CAPABILITIES,
  type AiOutboundCapabilities,
  type AiOutboundExtensionDefinition,
} from "./built/ai-outbound/index.js";
import { createRichSegmentRenderContext } from "./built/rich-segments/capabilities.js";
import { collectOutboundMediaKinds } from "./built/outbound-media-utils.js";
import { segment } from "./utils.js";
import { InboundMessagePipeline } from "./built/inbound-pipeline.js";
import { formatCompact, truncatePreview, formatContentChainLog, CONTENT_CHAIN_STAGE } from '@zhin.js/logger';
import type { Schema } from '@zhin.js/schema';
/**
 * Adapter类：适配器抽象，管理多平台Bot实例。
 * 负责根据配置启动/关闭各平台机器人，统一异常处理。
 * 
 * 适配器可以提供 AI 工具，供 AI 服务调用。
 */
export abstract class Adapter<
  R extends Endpoint = Endpoint,
  const Caps extends readonly EndpointCapability[] = typeof DEFAULT_ENDPOINT_CAPABILITIES,
> extends EventEmitter<Adapter.Lifecycle> {
  public endpoints: Map<string, R> = new Map<string, R>();
  private recallMessageHandler: (...args: any[]) => Promise<void>;

  /** Adapter 支持的能力上限（子类覆盖） */
  static readonly capabilities: readonly EndpointCapability[] = DEFAULT_ENDPOINT_CAPABILITIES;

  /** 出站富媒体段渲染策略（子类 override static） */
  static outboundRichSegmentPolicy: OutboundRichSegmentPolicy = DEFAULT_OUTBOUND_RICH_SEGMENT_POLICY;

  /** 交互段出站策略：native 保留按钮段，text 降级为编号文本 */
  static interactivePolicy: InteractivePolicy = DEFAULT_INTERACTIVE_POLICY;

  /** AI 结构化出站能力声明（mentions / richSegments / interactive） */
  static aiOutboundCapabilities: AiOutboundCapabilities = DEFAULT_AI_OUTBOUND_CAPABILITIES;

  /** 平台特有 extensions schema + 解析（对齐各 SDK 文档子集） */
  static aiOutboundExtensions?: readonly AiOutboundExtensionDefinition[];

  protected getInteractivePolicy(): InteractivePolicy {
    return (this.constructor as typeof Adapter).interactivePolicy;
  }

  /** 入站消息并发计数 */
  #pendingMessages = 0;
  /** 并发上限，0 表示不限制（默认） */
  static DEFAULT_MAX_CONCURRENT_MESSAGES = 0;

  get maxConcurrentMessages(): number {
    try {
      const configService = this.plugin?.root?.inject('config');
      const appConfig = configService?.getPrimary?.<Record<string, unknown>>();
      return (appConfig?.max_concurrent_messages as number | undefined) ?? Adapter.DEFAULT_MAX_CONCURRENT_MESSAGES;
    } catch {
      return Adapter.DEFAULT_MAX_CONCURRENT_MESSAGES;
    }
  }

  /** 当前正在处理的消息数 */
  get pendingMessages(): number {
    return this.#pendingMessages;
  }

  /**
   * 构造函数
   * @param name 适配器名称（如 'process'、'qq' 等）
   * @param endpointFactory Bot工厂函数或构造器
   */
  constructor(
    public plugin: Plugin,
    public name: keyof Plugin.Contexts,
    public config: Adapter.EndpointConfig<R>[]
  ) {
    super();
    this.recallMessageHandler = async(endpoint_id: string, id: string) => {
      const endpoint = this.endpoints.get(endpoint_id);
      if(!endpoint) throw new Error(`Endpoint ${endpoint_id} not found`);
      assertOutbound(endpoint);
      this.logger.debug(formatCompact( { recall: id, endpoint: endpoint_id }));
      await endpoint.$recallMessage(id);
    };
    this.on('call.recallMessage', this.recallMessageHandler);
    this.inboundPipeline = new InboundMessagePipeline({
      getPlugin: () => this.plugin,
      logger: this.logger,
      getMaxConcurrentMessages: () => this.maxConcurrentMessages,
      getPendingMessages: () => this.#pendingMessages,
      decrementPending: () => {
        // stop() may zero the counter while in-flight receives still finish;
        // never let the budget go negative.
        this.#pendingMessages = Math.max(0, this.#pendingMessages - 1);
      },
    });
  }

  /** 入站消息管线（替代 emit override 的隐式管线） */
  private inboundPipeline!: InboundMessagePipeline;

  /**
   * 重写 emit：拦截 message.receive/notice.receive/request.receive 事件，
   * 将入站处理委托给 InboundMessagePipeline。
   */
  override emit: EventEmitter<Adapter.Lifecycle>['emit'] = ((
    event: string | symbol,
    ...args: unknown[]
  ): boolean => {
    if (event === 'notice.receive' || event === 'request.receive') {
      return this.inboundPipeline.bridgeNoticeOrRequest(
        event as string,
        args,
        () => EventEmitter.prototype.emit.call(this, event, ...args),
      );
    }

    if (event !== 'message.receive') {
      return EventEmitter.prototype.emit.call(this, event, ...args);
    }
    const message = args[0] as Message;

    // 背压控制：同步返回 false 表示丢弃
    if (this.inboundPipeline.shouldDropDueToBackpressure()) {
      this.logger.warn(formatCompact( { drop: 'concurrency', limit: this.maxConcurrentMessages }));
      return false;
    }

    // 同步计数，保证背压判断的准确性
    this.#pendingMessages++;

    // 异步入站管线（middleware → dispatcher → 生命周期 → 观察者）
    this.inboundPipeline.receive(message, () => {
      EventEmitter.prototype.emit.call(this, event, ...args);
    });
    return true;
  }) as EventEmitter<Adapter.Lifecycle>['emit'];
  abstract createEndpoint(config: Adapter.EndpointConfig<R>): R;
  get logger() {
    if(!this.plugin) throw new Error("Adapter is not associated with any plugin");
    return this.plugin.logger;
  }
  binding(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * 同步等待入站管线结束（middleware → dispatcher → 生命周期 → 观察者）。
   * 用于 QQ 等需在被动回复完成后再 ack 交互的平台事件。
   */
  async receiveMessageAwait(message: Message): Promise<boolean> {
    if (this.inboundPipeline.shouldDropDueToBackpressure()) {
      this.logger.warn(formatCompact({ drop: 'concurrency', limit: this.maxConcurrentMessages }));
      return false;
    }
    this.#pendingMessages++;
    await this.inboundPipeline.receive(message, () => {
      EventEmitter.prototype.emit.call(this, 'message.receive', message);
    });
    return true;
  }

  /** 运行时 Endpoint 管理（add/remove/edit/start/stop）；未实现则 core 尝试 endpointConfigSchema 通用向导 */
  getEndpointManager?(): EndpointManager | null;

  /** 通用 schema 驱动 add/edit 时的字段定义 */
  getEndpointConfigSchema?(): Schema | undefined;

  /** 热连接失败时是否建议重启进程 */
  getEndpointNeedsRestart?(): boolean;

  /**
   * 出站富媒体能力（Publisher 按此过滤/降级；各 adapter 可覆盖）。
   */
  getOutboundMediaCapabilities(): {
    image?: boolean;
    audio?: boolean;
    video?: boolean;
    file?: boolean;
    maxAttachmentBytes?: number;
  } {
    return {
      image: true,
      audio: true,
      video: true,
      file: true,
      maxAttachmentBytes: 26_214_400,
    };
  }

  protected getOutboundRichSegmentPolicy(): OutboundRichSegmentPolicy {
    return (this.constructor as typeof Adapter).outboundRichSegmentPolicy;
  }

  /**
   * 出站两阶段：
   * 1. resolveRichSegments — 语义段 → 标准 IM 段（image/audio/text）
   * 2. Endpoint materializeOutboundMedia — base64/本地路径 → 平台 URL（各 adapter 可选）
   * @see docs/essentials/rich-segment-adapters.md
   */
  protected async renderSendMessage(options: SendOptions): Promise<SendOptions> {
    if (options.content != null) {
      options = {
        ...options,
        content: await resolveRichSegments(
          options.content,
          this.getOutboundRichSegmentPolicy(),
          createRichSegmentRenderContext({
            getConfig: () => {
              const cfg = this.plugin.root.inject('config')?.getPrimary<{
                htmlRenderer?: Record<string, unknown>;
                speech?: Record<string, unknown>;
              }>();
              return cfg;
            },
            warn: (msg) => this.logger.warn(msg),
            logContentChain: (fields) => {
              this.logger.debug(formatContentChainLog({ ...fields, adapter: this.name }));
            },
          }),
        ),
      };
      options = {
        ...options,
        content: resolveInteractiveSegments(
          options.content,
          this.getInteractivePolicy(),
        ),
      };
      const mediaKinds = collectOutboundMediaKinds(options.content);
      if (mediaKinds.length > 0) {
        this.logger.debug(formatContentChainLog({
          stage: CONTENT_CHAIN_STAGE.OUTBOUND,
          adapter: this.name,
          endpoint: options.endpoint,
          media: mediaKinds.join(','),
        }));
      }
    }
    const fns = this.plugin.root.listeners('before.sendMessage') as BeforeSendHandler[];
    for (const fn of fns) {
      const result = await fn(options);
      if (result) options = result;
    }
    return options;
  }
  async sendMessage(options:SendOptions):Promise<string>{
    options=await this.renderSendMessage(options);
    const endpoint = this.endpoints.get(options.endpoint);
    if(!endpoint) throw new Error(`Endpoint ${options.endpoint} not found`);
    assertOutbound(endpoint);
    this.logger.debug(formatCompact( {
      send: `${options.type}(${options.id})`,
      endpoint: options.endpoint,
      preview: truncatePreview(segment.raw(options.content)),
    }));
    const messageId = await endpoint.$sendMessage(options);
    const replyStore = getOutboundReplyStore();
    this.plugin.root.dispatch('message.send', {
      adapter: this.name,
      options,
      messageId,
      replySource: replyStore?.source,
      replyMessage: replyStore?.message,
    });
    return messageId;
  }

  /**
   * 编辑已发送的消息。
   * - 如果 Endpoint 实现了 $editMessage，调用平台编辑 API
   * - 否则 fallback 到发送新消息
   * @returns 消息 ID（编辑时返回原 ID，fallback 时返回新消息 ID）
   */
  async editMessage(options: EditMessageOptions): Promise<string> {
    const endpoint = this.endpoints.get(options.endpoint);
    if (!endpoint) throw new Error(`Endpoint ${options.endpoint} not found`);
    assertOutbound(endpoint);

    const editable = endpoint as { $editMessage?: (opts: EditMessageOptions) => Promise<void> };

    if (editable.$editMessage) {
      const rendered = await this.renderSendMessage({
        context: options.context,
        endpoint: options.endpoint,
        id: options.id,
        type: options.type,
        content: options.content,
      });
      await editable.$editMessage({ ...options, content: rendered.content });
      this.logger.debug(formatCompact({
        edit: `${options.type}(${options.id})`,
        endpoint: options.endpoint,
        messageId: options.messageId,
      }));
      return options.messageId;
    }

    this.logger.debug(formatCompact({
      editFallback: 'sendMessage',
      endpoint: options.endpoint,
      reason: '$editMessage not implemented',
    }));
    return this.sendMessage({
      context: options.context,
      endpoint: options.endpoint,
      id: options.id,
      type: options.type,
      content: options.content,
    });
  }

  async start() {
    if (this.endpoints.size > 0) {
      await this.stop();
    }
    const rootAdapters = this.plugin.root.adapters;
    if (!rootAdapters.some((n) => String(n) === String(this.name))) {
      rootAdapters.push(this.name);
    }
    if (!this.config?.length) return;

    for (const config of this.config) {
      const endpoint = await connectEndpointInstance({
        plugin: this.plugin,
        adapter: this,
        config: config as Record<string, unknown>,
      });
      this.logger.debug(formatCompact( { connect: endpoint.$id, adapter: this.name }));
      this.endpoints.set(endpoint.$id, endpoint as R);
    }
    this.logger.debug(formatCompact( { adapter: this.name }));
  }
  /**
   * 停止适配器，断开并移除所有 Endpoint 实例
   */
  async stop() {
    const errors: Error[] = [];
    for (const [id, endpoint] of this.endpoints) {
      try {
        if (hasInbound(endpoint)) {
          await disconnectEndpointInstance(this.plugin, this, endpoint);
        }
        this.logger.debug(formatCompact( { disconnect: id, adapter: this.name }));
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
        this.logger.error(`endpoint ${id} of adapter ${this.name} disconnect failed:`, error);
      }
    }
    // 无论是否有错误，始终完成清理
    this.endpoints.clear();
    // Drop in-flight concurrency counter so a subsequent start() does not
    // inherit a stale backpressure budget from the previous generation.
    this.#pendingMessages = 0;

    // 从 adapters 数组中移除（可能因重复 start 出现多条同名，需全部删掉）
    const rootAdapters = this.plugin.root.adapters;
    for (let i = rootAdapters.length - 1; i >= 0; i--) {
      if (rootAdapters[i] === this.name) rootAdapters.splice(i, 1);
    }

    // 移除所有事件监听器
    this.removeAllListeners();
    this.recallMessageHandler = async(endpoint_id: string, id: string) => {
      const endpoint = this.endpoints.get(endpoint_id);
      if(!endpoint) throw new Error(`Endpoint ${endpoint_id} not found`);
      assertOutbound(endpoint);
      this.logger.debug(formatCompact( { recall: id, endpoint: endpoint_id }));
      await endpoint.$recallMessage(id);
    };
    this.on('call.recallMessage', this.recallMessageHandler);

    this.logger.debug(formatCompact( { stop: this.name }));

    if (errors.length) {
      throw new AggregateError(errors, `adapter ${this.name}: ${errors.length} endpoint(s) failed to disconnect`);
    }
  }
}
export interface Adapters {}
export namespace Adapter {
  export type Factory<R extends Adapter = Adapter> = {
    new (
    plugin: Plugin,
    name: string,
    config: Adapter.EndpointConfig<Adapter.InferEndpoint<R>>[]
  ):R
  };
  export interface Lifecycle {
    'message.receive': [Message];
    'message.private.receive': [Message];
    'message.group.receive': [Message];
    'message.channel.receive': [Message];
    'notice.receive': [Notice];
    'request.receive': [Request];
    'call.recallMessage': [string, string];
  }
  /**
   * 适配器工厂注册表
   * 灵感来源于 zhinjs/next 的 Adapter.Registry
   */
  export const Registry = new Map<string, Factory>();
  export type InferEndpoint<R extends Adapter=Adapter> = R extends Adapter<infer T>
    ? T
    : never;
  export type EndpointConfig<T extends Endpoint> = T extends Endpoint<infer R> ? R : never;
  export type EndpointMessage<T extends Endpoint> = T extends Endpoint<infer _L, infer R>
    ? R
    : never;
  /**
   * 注册适配器工厂
   *
   * @param name 适配器名称
   * @param factory 适配器工厂函数
   * @example
   * ```typescript
   * Adapter.register('icqq', IcqqAdapter);
   * ```
   */
  export function register(name: string, factory: Factory) {
    Registry.set(name, factory);
  }
}
