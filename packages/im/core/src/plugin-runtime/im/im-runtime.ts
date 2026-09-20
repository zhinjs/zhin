import {
  Scope,
  createToken,
  generationAdmissionBinder,
  type CapabilityId,
  type GenerationAdmissionGate,
  type RuntimeSnapshot,
  type SnapshotLease,
  type SnapshotReader,
} from '@zhin.js/plugin-runtime';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PermissionHost, permissionHostToken } from '@zhin.js/permission';
import { MessageBus, messageBusToken } from './message-bus.js';
import {
  type EndpointContentResolveContext,
  endpointEventGatewayToken,
  type EndpointEvent,
  type EndpointEventGateway,
} from '@zhin.js/adapter';
import {
  type ConversationEventStore,
  type ConversationEventReader,
  type ConversationContextBlock,
  type ConversationReference,
  type ConversationResolution,
  type ConversationRef,
  type DeliveryReceipt,
} from '@zhin.js/im-contract';
import {
  Message,
  type IncomingMessage,
  type OutboundMessageService,
  type MessageSenderRef,
  type SendRequest,
} from './contracts.js';
import { loginAssistToken } from './login-assist-host.js';
import { LoginAssist } from '../../built/login-assist.js';
import type { UserInteraction } from '@zhin.js/interaction';
import type { OutboundRenderer } from './outbound-renderer.js';
import { RuntimeInteractionCoordinator } from './interaction-runtime.js';
import { ConversationRuntime } from './conversation-runtime.js';
import {
  EndpointRuntime,
  requireAdapters,
} from './endpoint-runtime.js';
import {
  RuntimeMessageEventStream,
  type RuntimeMessageEvent,
  type RuntimeMessageEventSource,
} from './message-events.js';
import {
  OutboundDeliveryRuntime,
  failedDeliveryReceipt,
} from './outbound-delivery-runtime.js';
import { InboundRuntime } from './inbound-runtime.js';

/** @public Stable inbound and outbound IM gateway token for Adapter integrations. */
export const outboundMessageToken = createToken<OutboundMessageService>('zhin.im.outbound-message');

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

export class ImRuntime implements OutboundMessageService {
  readonly #messageEventStream = new RuntimeMessageEventStream();
  readonly messageEvents: RuntimeMessageEventSource = Object.freeze({
    subscribe: (listener: (event: RuntimeMessageEvent) => void) =>
      this.#messageEventStream.subscribe(listener),
  });
  readonly #interactions = new RuntimeInteractionCoordinator<GenerationAdmissionGate>();
  readonly #conversations: ConversationRuntime;
  readonly #outbound: OutboundDeliveryRuntime;
  readonly #inbound: InboundRuntime;
  readonly endpoints: EndpointRuntime;
  readonly #operationSnapshot = new AsyncLocalStorage<SnapshotLease>();
  #snapshots?: SnapshotReader;

  constructor(options: ImRuntimeOptions = {}) {
    this.#conversations = new ConversationRuntime(options.conversationEvents);
    this.#outbound = new OutboundDeliveryRuntime({
      record: (request, receipt) => this.#conversations.recordOutbound(request, receipt),
      rememberFallback: (conversation, generation, map) =>
        this.#interactions.rememberFallback(conversation, generation, map),
      publish: (event) => this.#messageEventStream.publish(event),
    }, options.renderer);
    this.#inbound = new InboundRuntime({
      interactions: this.#interactions,
      inboundClaim: options.inboundClaim,
      enrichSender: options.enrichSender,
      acquire: () => this.#acquire(),
      release: (lease) => this.#release(lease),
      deliver: (request, snapshot) => this.#outbound.deliver(request, snapshot),
      recordIncoming: (input, sender) => this.#conversations.recordIncoming(input, sender),
      recordNotice: (notice) => this.#conversations.recordNotice(notice),
      publish: (event) => this.#messageEventStream.publish(event),
    }, options.commandPrefix);
    this.endpoints = new EndpointRuntime({
      acquire: () => this.#acquire(),
      release: (lease) => this.#release(lease),
      send: (request, snapshot) => this.#outbound.deliver(request, snapshot),
    });
  }

  /** Process composition replaces the bootstrap memory store after required DB activation. */
  replaceConversationEventStore(store: ConversationEventStore): void {
    this.#conversations.replaceStore(store);
  }

  get conversationEventReader(): ConversationEventReader {
    return this.#conversations.reader;
  }

  /** Pins all nested IM operations to the snapshot current at operation ingress. */
  async runWithSnapshotView<T>(operation: () => Promise<T>): Promise<T> {
    const inherited = this.#operationSnapshot.getStore();
    if (inherited?.active) return operation();
    if (!this.#snapshots) throw new Error('ImRuntime is not attached to a Root');
    const lease = this.#snapshots.acquire();
    try {
      return await this.#operationSnapshot.run(lease, operation);
    } finally {
      lease.release();
    }
  }

  async resolveConversationReference(
    lease: SnapshotLease,
    reference: ConversationReference,
    context: EndpointContentResolveContext,
  ): Promise<ConversationResolution> {
    if (!this.#snapshots?.owns(lease) || !lease.active) {
      return Object.freeze({ status: 'expired', code: 'generation_lease_expired' });
    }
    const local = await this.#conversations.resolveLocal(reference);
    if (local) return local;
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
    return this.#conversations.readContext(
      conversation,
      consumer,
      throughSequence,
      limit,
      excludeMessageId,
    );
  }

  async commitConversationContext(
    conversation: ConversationRef,
    consumer: string,
    cursor: number,
  ): Promise<void> {
    await this.#conversations.commitContext(conversation, consumer, cursor);
  }

  attach(snapshots: SnapshotReader): void {
    if (this.#snapshots && this.#snapshots !== snapshots) {
      throw new Error('ImRuntime is already attached to another Root');
    }
    this.#snapshots = snapshots;
  }

  readonly permissionHost = new PermissionHost();
  readonly messageBus = new MessageBus();
  readonly loginAssist = new LoginAssist();

  install(resources: Scope): void {
    resources.provide(outboundMessageToken, this);
    resources.provide(endpointEventGatewayToken, this.endpointEvents);
    resources.provide(loginAssistToken, this.loginAssist);
    resources.provide(permissionHostToken, this.permissionHost);
    resources.provide(messageBusToken, this.messageBus);
  }

  /** The sole Adapter ingress, also installed as endpointEventGatewayToken. */
  readonly endpointEvents: EndpointEventGateway & {
    [generationAdmissionBinder](gate: GenerationAdmissionGate): EndpointEventGateway;
  } = (() => {
    const self = this;
    const gateway: EndpointEventGateway & {
      [generationAdmissionBinder](gate: GenerationAdmissionGate): EndpointEventGateway;
    } = {
      receive: (event) => self.#inbound.receive(event),
      [generationAdmissionBinder](gate: GenerationAdmissionGate): EndpointEventGateway {
        return Object.freeze({
          receive: async (event: EndpointEvent) => gate.enter(
            () => self.#inbound.receive(event, gate),
          ),
        });
      },
    };
    return gateway;
  })();

  [generationAdmissionBinder](gate: GenerationAdmissionGate): OutboundMessageService {
    const gateway: OutboundMessageService = {
      send: async (request: SendRequest) => gate.enter(() => this.send(request))
        ?? failedDeliveryReceipt('generation_not_admitted'),
      registerInteractiveHandler: (prefix, handler) =>
        this.#interactions.register(prefix, handler, gate),
    };
    return Object.freeze(gateway);
  }

  /**
   * 注册 interactive action 回跳 handler（prefix 最长匹配；返回注销函数）。
   * 在 Command dispatch 之前路由：action 段 / 数字回跳 / 指令预填 payload。
   */
  registerInteractiveHandler(
    prefix: string,
    handler: (message: Message) => Promise<boolean> | boolean,
  ): () => void {
    return this.#interactions.register(prefix, handler);
  }

  /**
   * User interaction bound to this conversation.
   * `bind.subjectId` waits for that user (e.g. master) instead of the message sender.
   */
  createInteraction(
    message: Message,
    bind?: { readonly subjectId: string },
  ): UserInteraction | undefined {
    return this.#inbound.createInteraction(message, bind);
  }

  async send(request: SendRequest): Promise<DeliveryReceipt> {
    const lease = this.#acquire();
    try {
      return await this.#outbound.deliver(request, lease.value);
    } finally {
      this.#release(lease);
    }
  }

  /** Sends through the exact generation lease that admitted the current operation. */
  async sendWithSnapshotLease(
    lease: SnapshotLease,
    request: SendRequest,
  ): Promise<DeliveryReceipt> {
    if (!this.#snapshots?.owns(lease) || !lease.active) {
      throw new Error('Outbound message generation lease expired');
    }
    return this.#outbound.deliver(request, lease.value);
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
        this.#release(lease);
      }
    } catch {
      return Object.freeze({
        plugins: 0,
        endpoints: Object.freeze({ total: 0, online: 0 }),
      });
    }
  }

  #acquire(): SnapshotLease {
    const inherited = this.#operationSnapshot.getStore();
    if (inherited?.active) return inherited;
    if (!this.#snapshots) throw new Error('ImRuntime is not attached to a Root');
    return this.#snapshots.acquire();
  }

  #release(lease: SnapshotLease): void {
    if (this.#operationSnapshot.getStore() === lease) return;
    lease.release();
  }
}
