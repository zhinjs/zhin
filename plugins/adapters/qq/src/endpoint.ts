import { Bot, ReceiverMode } from 'qq-official-bot';
import { installQqUploadDiagnostics } from './upload-diagnostics.js';
import { projectQqGuildSenderRoles } from './platform-permit.js';
import { qqDeliveryFailure } from './delivery-error.js';
import { normalizeQqInteraction } from './interaction.js';
import { awaitQqStartup } from './start-deadline.js';
import { EndpointDeliveryError, type MessageRef } from '@zhin.js/im-contract';
import {
  inspectQqGroupMember,
  inspectQqGroupMemberProfile,
  inspectQqGroupScene,
  kickQqGroupMember,
  moderateQqGroupMember,
  muteQqGroupMember,
  qqGroupService,
} from './group-admin.js';
/**
 * QQ endpoints — lifecycle, outbound, admit, agent tool surface.
 */
import {
  createEndpointSpecification, endpointSpec, type Endpoint, type EndpointSpecification, createEndpointLifecycle, type EndpointLifecycle,
  type EndpointControl,
  type EndpointChannel,
  type EndpointManagement,
  type EndpointSendRequest,
  type EndpointTransportState,
  type AdapterOutageNotifier,
} from 'zhin.js/adapter';
import type { HttpHost } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger, truncatePreview } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import { collectOutboundImageSizes, formatOutboundMessages } from './outbound.js';
import { QqActiveMessageGate, QqPassiveReplyLedger } from './passive-reply.js';
import { sendQqMessages } from './qq-send.js';
import {
  formatInboundContent,
  parseCompoundMessageId,
  qqInboundConversation,
  qqOutboundKind,
  resolveOutboundMessageId,
  senderDisplayName,
  type QqInboundMessage,
  type ResolvedQqHttpConfig,
  type ResolvedQqWebsocketConfig,
} from './protocol.js';
import {
  qqHttpBotOptions,
  registerQqWebhookRoutes,
  type QqHttpBotTransport,
} from './webhook.js';
import {
  bindQqBotInboundEvents,
  qqWebsocketBotOptions, configureQqWebsocketReceiver, disposeQqAuthorization,
  normalizeQqMessage,
  type QqBotTransport,
} from './ws.js';
import {
  bindQqBotSideEvents,
  receiveQqSideEvent,
  type QqSideEventCaller,
} from './side-event-dispatch.js';

export type { QqBotTransport, QqOfficialApi } from './ws.js';
export type { QqHttpBotTransport } from './webhook.js';

export interface QqEndpointOptions {
  readonly id: CapabilityId;
  readonly config: ResolvedQqWebsocketConfig;
  /** Out-of-band outage notifier; absent in tests/hosts without outbound. */
  readonly notifier?: AdapterOutageNotifier;
}

export class QqWebsocketEndpoint extends Bot<ReceiverMode.WEBSOCKET> implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  readonly #receiverResources: ReturnType<typeof configureQqWebsocketReceiver>;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: QqEndpointOptions;
  #connection?: AbortController;
  #stopping?: Promise<void>;
  #open = false;
  #executionSignal?: AbortSignal;
  #offlineNoticeAt = 0;
  readonly #seenInteractions = new Map<string, number>();
  /** Recent msg_id / event_id per conversation, so replies go out as passive messages. */
  readonly #passiveReplies = new QqPassiveReplyLedger();
  readonly #activeGate = new QqActiveMessageGate();
  readonly #lifecycle: EndpointLifecycle;
  #cleanup?: () => Promise<void>;
  readonly #management: EndpointManagement = createQqEndpointManagement(() => this.#requireBot(), () => this.#open && this.#connection !== undefined);
  readonly #control: EndpointControl = createQqEndpointControl(() => this.#requireBot(), (id) => this.recallMessage(id));

  constructor(options: QqEndpointOptions) {
    super(qqWebsocketBotOptions(options.config));
    this.#logger = getAdapterLogger('qq', options.config.id);
    this.#lifecycle = createEndpointLifecycle({ name: options.config.id });
    this.#options = options;
    this.#receiverResources = configureQqWebsocketReceiver(this, options.config);
    const endpoint = this;
    this[endpointSpec] = createEndpointSpecification(this, {
      start: signal => this.#startFramework(signal), open: () => this.#openFramework(), close: () => this.#closeFramework(),
      stop: () => this.#stopFramework(), send: request => this.#sendFramework(request), name: options.config.id,
      get transportState() { return endpoint.#transportState; }, management: this.#management, control: this.#control,
    });
    this.#bindBot(this);
  }

  /** Live endpoint 名（Console/AdapterIndex 展示用，如 bot appid 别名）。 */
  get name(): string {
    return this.#options.config.id;
  }

  get #transportState(): EndpointTransportState {
    if (this.#lifecycle.state !== 'open') return this.#lifecycle.state;
    return this.#receiverResources.state();
  }

  async #startFramework(executionSignal: AbortSignal): Promise<void> {
    this.#executionSignal = executionSignal;
    await this.#lifecycle.start(async (handle) => {
      const bot = this;
      const previousCleanup = this.#cleanup;
      await previousCleanup?.();
      const releaseUploadDiagnostics = installQqUploadDiagnostics(bot, metadata => this.#logger.debug(formatCompact(metadata)));
      let cancelled = false;
      const startupAbort = new AbortController();
      this.#connection = startupAbort;
      let nativeStart: Promise<unknown> | undefined;
      let stopping: Promise<void> | undefined;
      let transportClose: (() => void) | undefined;
      const stopBot = async () => {
        await super.stop();
        await nativeStart?.catch(() => undefined);
      };
      const cleanup = () => {
        cancelled = true;
        releaseUploadDiagnostics();
        startupAbort.abort();
        if (transportClose) this.receiver.off('close', transportClose);
        if (this.#connection === startupAbort) this.#connection = undefined;
        return stopping ??= stopBot();
      };
      this.#cleanup = cleanup;
      handle.onForceClose(() => { void cleanup().catch(() => undefined); });
      try {
        transportClose = () => {
          if (cancelled || this.#connection === undefined) return;
          this.#notifyOffline('transport_close');
          void cleanup().catch(() => undefined);
          handle.notifyClosed();
        };
        this.receiver.on('close', transportClose);
        nativeStart = super.start();
        await awaitQqStartup(nativeStart.then(() => undefined), startupAbort.signal);
        if (cancelled) {
          // SDK startup may create resources after stop; close this exact old client again.
          await stopping;
          return;
        }
        this.#offlineNoticeAt = 0;
        this.#logger.info(`connected (websocket) | appid: ${this.#options.config.appid}`);
      } catch (error) {
        const wasCancelled = cancelled;
        await cleanup();
        if (wasCancelled) return;
        this.#notifyOffline('start_failed');
        const raw = error instanceof Error ? error.message : String(error);
        throw new Error(
          `QQ WebSocket 连接失败：请检查 appid/secret 是否配对、网关地址（gatewayUrl/accessTokenUrl）是否可达（原始错误：${raw}）`,
          { cause: error },
        );
      }
    });
  }

  #openFramework(): void {
    this.#open = true;
  }

  #closeFramework(): void {
    this.#open = false;
  }

  async #stopFramework(): Promise<void> {
    this.#stopping ??= Promise.resolve().then(async () => {
      this.#open = false;
      const cleanup = this.#cleanup;
      this.#cleanup = undefined;
      try { await this.#lifecycle.stop(); await cleanup?.(); }
      finally { this.removeAllListeners(undefined as never); this.#receiverResources.dispose(); disposeQqAuthorization(this); }
    });
    await this.#stopping;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async #sendFramework({ conversation, payload }: EndpointSendRequest): Promise<string> {
    // 媒体与 markdown/按钮不能同条发送（msg_type 7 与 2 互斥）：公网图片嵌入 markdown，
    // 拿不到 URL/尺寸的媒体降级为独立消息先发
    const messages = formatOutboundMessages(payload, { imageSizes: await collectOutboundImageSizes(payload) });
    const body = messages[messages.length - 1]!;
    const kind = qqOutboundKind(conversation);
    const bot = this.#requireBot();
    let result: unknown;
    try {
      result = await sendQqMessages({
        bot,
        ledger: this.#passiveReplies,
        activeGate: this.#activeGate,
        log: fields => this.#logger.warn(formatCompact(fields)),
      }, conversation, messages);
    } catch (error) {
      const { failure, diagnostic } = qqDeliveryFailure(error);
      this.#logger.warn(formatCompact(diagnostic));
      throw failure;
    }
    const messageId = `${kind}-${conversation.id}:${resolveOutboundMessageId(result)}`;
    this.#logger.info(
      `send ${kind}:${conversation.id}`
      + ` | id: ${messageId}`
      + ` | ${truncatePreview(typeof body === 'string' ? body : String(body), 80)}`,
    );
    return messageId;
  }

  async recallMessage(messageId: string): Promise<void> {
    const { kind, channelId, qqMsgId } = parseCompoundMessageId(messageId);
    const bot = this.#requireBot();
    await recallQqMessage(bot, kind, channelId, qqMsgId);
    this.#logger.debug(formatCompact({
      op: 'qq_recall',
      endpoint: this.#options.config.id,
      kind,
      messageId,
    }));
  }

  /** Test / internal: admit a message when open. */
  admit(msg: QqInboundMessage): void {
    if (!this.#open) return;
    const conversation = qqInboundConversation(String(this.#options.id), msg);
    const content = formatInboundContent(msg);
    this.#logger.info(
      `recv ${conversation.kind}:${conversation.id}`
      + (msg.authorId ? ` from ${msg.authorId}` : '')
      + (msg.mentioned ? ' (mentioned)' : '')
      + ` | ${truncatePreview(content, 80)}`,
    );
    const roleProjection = projectQqGuildSenderRoles(msg.authorRoles);
    if (msg.id) this.#passiveReplies.record(qqOutboundKind(conversation), conversation.id, { id: msg.id });
    void this[endpointSpec].events.emit('message.receive', {
      conversation,
      event: msg.event,
      platformSentAt: msg.platformSentAt,
      message: { conversation, id: msg.id },
      content,
      ...(msg.segments?.length ? { segments: msg.segments } : {}),
      sender: {
        id: msg.authorId,
        name: senderDisplayName(msg) || undefined,
        ...(roleProjection.role ? { roles: [roleProjection.role] } : {}),
        ...(roleProjection.permissions.length ? { permissions: roleProjection.permissions } : {}),
      },
      endpointId: this.#options.config.id,
      ...(msg.mentioned ? { mentioned: true } : {}),
      metadata: Object.freeze({
        channelKind: msg.channelKind,
        userId: msg.authorId,
        guildId: msg.guildId,
        authorRoleIds: msg.authorRoles,
        ...(roleProjection.role ? { senderRole: roleProjection.role } : {}),
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'qq_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  /** Native click only; C2C/group have no platform source message ID. */
  admitInteraction(raw: unknown): boolean {
    if (!this.#open) return false;
    const action = normalizeQqInteraction(raw);
    if (!action) return false;
    const now = Date.now();
    for (const [id, time] of this.#seenInteractions) if (now - time > 300_000) this.#seenInteractions.delete(id);
    if (this.#seenInteractions.has(action.message.id)) return true;
    this.#seenInteractions.set(action.message.id, now);
    if (this.#seenInteractions.size > 10_000) this.#seenInteractions.delete(this.#seenInteractions.keys().next().value!);
    // ACK owns only platform loading state, never implies business acceptance.
    void this[endpointSpec].events.run(() => awaitOwnedAck(action.ack(), this.#executionSignal)).then(
      ok => { if (ok === false) this.#logger.warn('qq_interaction_ack_failed'); },
      () => { if (this.#executionSignal?.aborted) this.#logger.debug('QQ ACK wait cancelled'); else this.#logger.warn('qq_interaction_ack_failed'); },
    );
    const conversation = qqInboundConversation(String(this.#options.id), action.message);
    // INTERACTION_CREATE's id is an event_id the reply may answer passively.
    this.#passiveReplies.record(qqOutboundKind(conversation), conversation.id, { event_id: action.message.id });
    void this[endpointSpec].events.emit('message.receive', {
      event: action.message.event, conversation, message: { conversation, id: action.message.id }, content: '',
      segments: action.message.segments, sender: { id: action.message.authorId }, endpointId: this.#options.config.id,
      metadata: Object.freeze({ eventType: 'INTERACTION_CREATE', sourceMessageIdAvailable: action.sourceMessageId !== undefined,
        ...(action.sourceMessageId ? { sourceMessageId: action.sourceMessageId } : {}),
        callbackAssociation: action.sourceMessageId ? 'source-message' : 'payload-conversation-actor' }),
    }).catch(() => this.#logger.warn('qq_interaction_receive_failed'));
    return true;
  }

  #notifyOffline(reason: string): void {
    const notifier = this.#options.notifier;
    if (!notifier?.configured) return;
    const now = Date.now();
    if (now - this.#offlineNoticeAt < 60_000) return;
    this.#offlineNoticeAt = now;
    const text = `[Zhin] QQ 机器人 ${this.#options.config.id} 掉线（${reason}）。正在自动重连。\n`
      + '恢复：在 QQ 回复 `qq endpoint add` 重新扫码绑定，或打开 Console 的 QQ 页面。';
    void notifier.send(text).then((sent) => {
      if (sent) return;
      this.#logger.warn(formatCompact({
        op: 'qq_notify_failed',
        endpoint: this.#options.config.id,
        reason,
      }));
    });
  }

  #bindBot(bot: QqBotTransport): void {
    bindQqBotInboundEvents(bot, (raw) => {
      void this[endpointSpec].events.run(() => {
        if (this.#connection === undefined) return;
        this.#emitPlatformEvent('message', raw);
        const msg = normalizeQqMessage(raw);
        if (msg) this.admit(msg);
      }).catch(() => this.#logger.debug('Native callback was not admitted'));
    });
    bindQqBotSideEvents(bot, (eventName, raw) => {
      void this[endpointSpec].events.run(() => {
        if (this.#connection === undefined) return;
        this.#emitPlatformEvent(eventName, raw);
        if (this.admitInteraction(raw)) return;
        receiveQqSideEvent(
          (name, payload) => this[endpointSpec].events.emit(name, payload),
          this.#options.config.id,
          bot,
          eventName,
          raw,
          this.#logger,
        );
      }).catch(() => this.#logger.debug('Native callback was not admitted'));
    });
  }

  #emitPlatformEvent(name: string, event: unknown): void {
    void this[endpointSpec].events.platform(name, event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'qq_platform_event_failed',
        event: name,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }

  #requireBot(): QqBotTransport {
    if (!this.#connection) throw new EndpointDeliveryError('endpoint_disconnected', 'QQ bot not connected', 'not_sent');
    return this;
  }
}

export interface QqHttpEndpointOptions {
  readonly id: CapabilityId;
  readonly http: HttpHost;
  readonly config: ResolvedQqHttpConfig;
  /** Out-of-band outage notifier; absent in tests/hosts without outbound. */
  readonly notifier?: AdapterOutageNotifier;
}

/** Webhook / middleware inbound via httpHostToken POST (qq-official-bot Middleware receiver). */
export class QqHttpEndpoint extends Bot<ReceiverMode.MIDDLEWARE, 'koa'> implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: QqHttpEndpointOptions;
  #connection?: AbortController;
  #stopping?: Promise<void>;
  #open = false;
  #executionSignal?: AbortSignal;
  #offlineNoticeAt = 0;
  readonly #seenInteractions = new Map<string, number>();
  /** Recent msg_id / event_id per conversation, so replies go out as passive messages. */
  readonly #passiveReplies = new QqPassiveReplyLedger();
  readonly #activeGate = new QqActiveMessageGate();
  readonly #lifecycle: EndpointLifecycle;
  #cleanup?: () => Promise<void>;
  readonly #management: EndpointManagement = createQqEndpointManagement(() => this.#requireBot(), () => this.#open && this.#connection !== undefined);
  readonly #control: EndpointControl = createQqEndpointControl(() => this.#requireBot(), (id) => this.recallMessage(id));

  constructor(options: QqHttpEndpointOptions) {
    super(qqHttpBotOptions(options.config));
    this.#logger = getAdapterLogger('qq', options.config.id);
    this.#lifecycle = createEndpointLifecycle({ name: options.config.id, reconnect: false });
    this.#options = options;
    const endpoint = this;
    this[endpointSpec] = createEndpointSpecification(this, {
      start: signal => this.#startFramework(signal), open: () => this.#openFramework(), close: () => this.#closeFramework(),
      stop: () => this.#stopFramework(), send: request => this.#sendFramework(request), name: options.config.id,
      get transportState() { return endpoint.#transportState; },
      management: this.#management, control: this.#control,
    });
    this.#bindBot(this);
  }

  /** Live endpoint 名（Console/AdapterIndex 展示用）。 */
  get name(): string {
    return this.#options.config.id;
  }

  get #transportState(): EndpointTransportState {
    return this.#lifecycle.state;
  }

  async #startFramework(executionSignal: AbortSignal): Promise<void> {
    this.#executionSignal = executionSignal;
    await this.#lifecycle.start(async (handle) => {
      const bot = this;
      const previousCleanup = this.#cleanup;
      await previousCleanup?.();
      const releaseUploadDiagnostics = installQqUploadDiagnostics(bot, metadata => this.#logger.debug(formatCompact(metadata)));
      let cancelled = false;
      const startupAbort = new AbortController();
      this.#connection = startupAbort;
      let nativeStart: Promise<unknown> | undefined;
      let stopping: Promise<void> | undefined;
      const routes: Array<() => void> = [];
      const stopBot = async () => {
        await super.stop();
        await nativeStart?.catch(() => undefined);
      };
      const cleanup = () => {
        cancelled = true;
        releaseUploadDiagnostics();
        startupAbort.abort();
        if (this.#connection === startupAbort) this.#connection = undefined;
        for (const release of routes.splice(0)) release();
        return stopping ??= stopBot();
      };
      this.#cleanup = cleanup;
      handle.onForceClose(() => { void cleanup().catch(() => undefined); });
      try {
        routes.push(...registerQqWebhookRoutes(this.#options.http, {
          config: this.#options.config,
          getBot: () => cancelled ? null : bot,
        }));
        nativeStart = super.start();
        await awaitQqStartup(nativeStart.then(() => undefined), startupAbort.signal);
        if (cancelled) {
          // SDK startup may create resources after stop; close this exact old client again.
          await stopping;
          return;
        }
        this.#offlineNoticeAt = 0;
        this.#logger.info(`connected (${this.#options.config.mode}) | path: ${this.#options.config.webhookPath}`);
      } catch (error) {
        const wasCancelled = cancelled;
        await cleanup();
        if (wasCancelled) return;
        this.#notifyOffline('start_failed');
        throw error;
      }
    });
  }

  #openFramework(): void {
    this.#open = true;
  }

  #closeFramework(): void {
    this.#open = false;
  }

  async #stopFramework(): Promise<void> {
    this.#stopping ??= Promise.resolve().then(async () => {
      this.#open = false;
      const cleanup = this.#cleanup;
      this.#cleanup = undefined;
      try { await this.#lifecycle.stop(); await cleanup?.(); }
      finally { this.removeAllListeners(undefined as never); disposeQqAuthorization(this); }
      this.#logger.debug(formatCompact({ op: 'disconnect' }));
    });
    await this.#stopping;
  }

  async #sendFramework({ conversation, payload }: EndpointSendRequest): Promise<string> {
    // 媒体与 markdown/按钮不能同条发送（msg_type 7 与 2 互斥）：公网图片嵌入 markdown，
    // 拿不到 URL/尺寸的媒体降级为独立消息先发
    const messages = formatOutboundMessages(payload, { imageSizes: await collectOutboundImageSizes(payload) });
    const body = messages[messages.length - 1]!;
    const kind = qqOutboundKind(conversation);
    const bot = this.#requireBot();
    let result: unknown;
    try {
      result = await sendQqMessages({
        bot,
        ledger: this.#passiveReplies,
        activeGate: this.#activeGate,
        log: fields => this.#logger.warn(formatCompact(fields)),
      }, conversation, messages);
    } catch (error) {
      const { failure, diagnostic } = qqDeliveryFailure(error);
      this.#logger.warn(formatCompact(diagnostic));
      throw failure;
    }
    const messageId = `${kind}-${conversation.id}:${resolveOutboundMessageId(result)}`;
    this.#logger.info(
      `send ${kind}:${conversation.id}`
      + ` | id: ${messageId}`
      + ` | ${truncatePreview(typeof body === 'string' ? body : String(body), 80)}`,
    );
    return messageId;
  }

  async recallMessage(messageId: string): Promise<void> {
    const { kind, channelId, qqMsgId } = parseCompoundMessageId(messageId);
    const bot = this.#requireBot();
    await recallQqMessage(bot, kind, channelId, qqMsgId);
    this.#logger.debug(formatCompact({
      op: 'qq_recall',
      endpoint: this.#options.config.id,
      kind,
      messageId,
    }));
  }

  admit(msg: QqInboundMessage): void {
    if (!this.#open) return;
    const conversation = qqInboundConversation(String(this.#options.id), msg);
    const content = formatInboundContent(msg);
    this.#logger.info(
      `recv ${conversation.kind}:${conversation.id}`
      + (msg.authorId ? ` from ${msg.authorId}` : '')
      + (msg.mentioned ? ' (mentioned)' : '')
      + ` | ${truncatePreview(content, 80)}`,
    );
    const roleProjection = projectQqGuildSenderRoles(msg.authorRoles);
    if (msg.id) this.#passiveReplies.record(qqOutboundKind(conversation), conversation.id, { id: msg.id });
    void this[endpointSpec].events.emit('message.receive', {
      conversation,
      event: msg.event,
      platformSentAt: msg.platformSentAt,
      message: { conversation, id: msg.id },
      content,
      ...(msg.segments?.length ? { segments: msg.segments } : {}),
      sender: {
        id: msg.authorId,
        name: senderDisplayName(msg) || undefined,
        ...(roleProjection.role ? { roles: [roleProjection.role] } : {}),
        ...(roleProjection.permissions.length ? { permissions: roleProjection.permissions } : {}),
      },
      endpointId: this.#options.config.id,
      ...(msg.mentioned ? { mentioned: true } : {}),
      metadata: Object.freeze({
        channelKind: msg.channelKind,
        userId: msg.authorId,
        guildId: msg.guildId,
        authorRoleIds: msg.authorRoles,
        ...(roleProjection.role ? { senderRole: roleProjection.role } : {}),
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'qq_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  /** Native click only; C2C/group have no platform source message ID. */
  admitInteraction(raw: unknown): boolean {
    if (!this.#open) return false;
    const action = normalizeQqInteraction(raw);
    if (!action) return false;
    const now = Date.now();
    for (const [id, time] of this.#seenInteractions) if (now - time > 300_000) this.#seenInteractions.delete(id);
    if (this.#seenInteractions.has(action.message.id)) return true;
    this.#seenInteractions.set(action.message.id, now);
    if (this.#seenInteractions.size > 10_000) this.#seenInteractions.delete(this.#seenInteractions.keys().next().value!);
    // ACK owns only platform loading state, never implies business acceptance.
    void this[endpointSpec].events.run(() => awaitOwnedAck(action.ack(), this.#executionSignal)).then(
      ok => { if (ok === false) this.#logger.warn('qq_interaction_ack_failed'); },
      () => { if (this.#executionSignal?.aborted) this.#logger.debug('QQ ACK wait cancelled'); else this.#logger.warn('qq_interaction_ack_failed'); },
    );
    const conversation = qqInboundConversation(String(this.#options.id), action.message);
    // INTERACTION_CREATE's id is an event_id the reply may answer passively.
    this.#passiveReplies.record(qqOutboundKind(conversation), conversation.id, { event_id: action.message.id });
    void this[endpointSpec].events.emit('message.receive', {
      event: action.message.event, conversation, message: { conversation, id: action.message.id }, content: '',
      segments: action.message.segments, sender: { id: action.message.authorId }, endpointId: this.#options.config.id,
      metadata: Object.freeze({ eventType: 'INTERACTION_CREATE', sourceMessageIdAvailable: action.sourceMessageId !== undefined,
        ...(action.sourceMessageId ? { sourceMessageId: action.sourceMessageId } : {}),
        callbackAssociation: action.sourceMessageId ? 'source-message' : 'payload-conversation-actor' }),
    }).catch(() => this.#logger.warn('qq_interaction_receive_failed'));
    return true;
  }

  #notifyOffline(reason: string): void {
    const notifier = this.#options.notifier;
    if (!notifier?.configured) return;
    const now = Date.now();
    if (now - this.#offlineNoticeAt < 60_000) return;
    this.#offlineNoticeAt = now;
    const text = `[Zhin] QQ 机器人 ${this.#options.config.id} 掉线（${reason}）。正在自动重连。\n`
      + '恢复：在 QQ 回复 `qq endpoint add` 重新扫码绑定，或打开 Console 的 QQ 页面。';
    void notifier.send(text).then((sent) => {
      if (sent) return;
      this.#logger.warn(formatCompact({
        op: 'qq_notify_failed',
        endpoint: this.#options.config.id,
        reason,
      }));
    });
  }

  #bindBot(bot: QqBotTransport): void {
    bindQqBotInboundEvents(bot, (raw) => {
      void this[endpointSpec].events.run(() => {
        if (this.#connection === undefined) return;
        this.#emitPlatformEvent('message', raw);
        const msg = normalizeQqMessage(raw);
        if (msg) this.admit(msg);
      }).catch(() => this.#logger.debug('Native callback was not admitted'));
    });
    bindQqBotSideEvents(bot, (eventName, raw) => {
      void this[endpointSpec].events.run(() => {
        if (this.#connection === undefined) return;
        this.#emitPlatformEvent(eventName, raw);
        if (this.admitInteraction(raw)) return;
        receiveQqSideEvent(
          (name, payload) => this[endpointSpec].events.emit(name, payload),
          this.#options.config.id,
          bot,
          eventName,
          raw,
          this.#logger,
        );
      }).catch(() => this.#logger.debug('Native callback was not admitted'));
    });
  }

  #emitPlatformEvent(name: string, event: unknown): void {
    void this[endpointSpec].events.platform(name, event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'qq_platform_event_failed',
        event: name,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }

  #requireBot(): QqHttpBotTransport {
    if (!this.#connection) throw new EndpointDeliveryError('endpoint_disconnected', 'QQ bot not connected', 'not_sent');
    return this;
  }
}

function createQqEndpointManagement(
  requireClient: () => QqBotTransport,
  isActive: () => boolean,
): EndpointManagement {
  const api = () => requireClient();
  return Object.freeze<EndpointManagement>({
    // QQ 群（group_openid / member_openid）：官方 v2 群管理接口，部分为白名单能力（11253）。
    inspectGroupMember: (group, user, signal) => inspectQqGroupMember(api(), group, user, signal),
    inspectGroupScene: (group, signal) => inspectQqGroupScene(api(), group, signal),
    inspectGroupMemberProfile: (group, user, signal) => inspectQqGroupMemberProfile(api(), group, user, signal),
    moderateGroupMember: (group, user, action, signal) => moderateQqGroupMember(api(), group, user, action, signal, isActive),
    async listGroupMembers(groupId: string): Promise<readonly unknown[]> {
      return qqGroupService(api()).getMembers(groupId);
    },
    async kickGroupMember(groupId: string, userId: string): Promise<void> {
      await kickQqGroupMember(api(), groupId, userId);
    },
    async muteGroupMember(groupId: string, userId: string, durationSeconds: number): Promise<void> {
      await muteQqGroupMember(api(), groupId, userId, durationSeconds);
    },
    async listChannels(): Promise<readonly EndpointChannel[]> {
      const channels: EndpointChannel[] = [];
      const client = requireClient();
      const guilds = await client.guildService.getList();
      for (const guildValue of Array.isArray(guilds) ? guilds : []) {
        const guild = asRecord(guildValue);
        const guildId = String(guild.id ?? guild.guild_id ?? guildValue ?? '');
        if (!guildId) continue;
        const guildName = String(guild.name ?? guild.guild_name ?? guildId);
        const rows = await client.channelService.getList(guildId);
        for (const channelValue of Array.isArray(rows) ? rows : []) {
          const channel = asRecord(channelValue);
          const id = String(channel.id ?? channel.channel_id ?? channelValue ?? '');
          if (!id) continue;
          channels.push({
            id,
            name: String(channel.name ?? channel.channel_name ?? id),
            parent: { type: 'guild', id: guildId, name: guildName },
          });
        }
      }
      return channels;
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

/**
 * Recall + 频道表情回应。recall 同时接受 send() 的复合 ID 与入站原生消息 ID（目标取自 MessageRef.conversation），
 * 因此群管理员机器人可撤回普通成员 2 分钟内的消息（官方限制由平台执行）。
 * 表情回应只有频道子频道消息支持（官方无群 / 单聊表情回应接口）。
 */
function createQqEndpointControl(
  requireBot: () => QqBotTransport,
  recallById: (messageId: string) => Promise<void>,
): EndpointControl {
  return Object.freeze<EndpointControl>({
    recall: async (message: MessageRef) => {
      if (isCompoundMessageId(message.id)) return recallById(message.id);
      const kind = qqOutboundKind(message.conversation);
      await recallQqMessage(requireBot(), kind, message.conversation.id, message.id);
    },
    addReaction: async (message: MessageRef, emoji: string) => {
      const target = qqGuildReactionTarget(message, emoji);
      if (!target) return null;
      await requireBot().reactionService.addGuildMessageReaction(target.channelId, target.messageId, target.type, target.id);
      return `${target.type}:${target.id}`;
    },
    removeReaction: async (message: MessageRef, reactionId: string) => {
      const target = qqGuildReactionTarget(message, reactionId);
      if (!target) return;
      await requireBot().reactionService.deleteGuildMessageReaction(target.channelId, target.messageId, target.type, target.id);
    },
  });
}

function isCompoundMessageId(id: string): boolean {
  try { parseCompoundMessageId(id); return true; } catch { return false; }
}

/** `type:id`（1 系统表情 / 2 emoji）或单个 Unicode emoji（→ type 2 + 码点）。 */
export function parseQqEmoji(value: string): { type: 1 | 2; id: `${number}` } | null {
  const explicit = /^([12]):(\d+)$/.exec(value.trim());
  if (explicit) return { type: Number(explicit[1]) as 1 | 2, id: explicit[2] as `${number}` };
  const chars = [...value.trim().replace(/\uFE0F/g, '')];
  if (chars.length !== 1) return null;
  const code = chars[0]!.codePointAt(0)!;
  return code > 0x7f ? { type: 2, id: String(code) as `${number}` } : null;
}

function qqGuildReactionTarget(message: MessageRef, emoji: string) {
  let kind = qqOutboundKind(message.conversation);
  let channelId = message.conversation.id;
  let messageId = message.id;
  if (isCompoundMessageId(message.id)) ({ kind, channelId, qqMsgId: messageId } = parseCompoundMessageId(message.id));
  if (kind !== 'channel' || !channelId || !messageId) return null;
  const parsed = parseQqEmoji(emoji);
  return parsed ? { channelId, messageId, ...parsed } : null;
}

async function recallQqMessage(bot: QqBotTransport, kind: ReturnType<typeof qqOutboundKind>, channelId: string, messageId: string): Promise<void> {
  const recall = { private: bot.recallPrivateMessage, group: bot.recallGroupMessage,
    channel: bot.recallGuildMessage, direct: bot.recallDirectMessage }[kind];
  if (!recall) throw new EndpointDeliveryError('recall_unsupported', 'QQ transport does not support recall for this conversation', 'not_sent');
  if (!messageId) throw new EndpointDeliveryError('invalid_message_id', 'QQ recall requires a nonempty message ID', 'not_sent');
  await recall.call(bot, channelId, messageId);
}

/** Logical cancellation only; the native SDK still owns its already-started ACK. */
function awaitOwnedAck<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
