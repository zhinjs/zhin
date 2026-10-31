import { TelegramClient, type TelegramFetch } from './telegram-client.js';
import {
  createEndpointSpecification, endpointSpec, type Endpoint, type EndpointSpecification, createEndpointLifecycle,
  type EndpointLifecycle, type EndpointContentPort, type EndpointContentResolveContext,
  type EndpointControl, type EndpointSendRequest, type EndpointTransportState,
} from 'zhin.js/adapter';
/**
 * TelegramEndpoint — lifecycle, outbound, admit, Bot API helpers for agent tools.
 */
import { readFile } from 'node:fs/promises';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import {
  EndpointDeliveryError,
  type ConversationRef,
  type ConversationReference,
  type ConversationResolution,
  type MessageRef,
} from '@zhin.js/im-contract';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import { runTelegramPollLoop } from './polling.js';
import { TelegramApiError } from './api-error.js';
export { TelegramApiError } from './api-error.js';
import { normalizeTelegramChatMember } from './platform-permit.js';
import {
  buildWebhookUrl,
  formatCallbackContent,
  formatCallbackSegments,
  formatInboundContent,
  formatInboundSegments,
  formatOutboundPlan,
  resolveTelegramChannelType,
  senderDisplayName,
  telegramInboundConversation,
  type ResolvedTelegramConfig,
  type TelegramCallbackQuery,
  type TelegramChatMember,
  type TelegramMessage,
  type TelegramOutboundUpload,
  type TelegramUpdate,
} from './protocol.js';
import { registerTelegramWebhookRoutes } from './webhook.js';

const CHAT_MEMBER_CACHE_TTL_MS = 60_000;
const CHAT_MEMBER_CACHE_MAX = 2_000;
const ADMITTED_UPDATE_LIMIT = 2_048;
const INFLIGHT_UPDATE_LIMIT = 256;

interface ChatMemberPermit {
  readonly at: number;
  readonly role?: string;
  readonly permissions: string[];
}

/** One admitted platform message and its original framework lifetime. */
interface TelegramMessageAdmission {
  readonly message: TelegramMessage;
  readonly conversation: ConversationRef;
  readonly signal: AbortSignal;
  readonly event?: unknown;
}

export interface TelegramEndpointOptions {
  readonly id: CapabilityId;
  readonly config: ResolvedTelegramConfig;
  readonly http?: HttpHost;
  readonly fetch?: TelegramFetch;
  /** Internal transport deadline override; long polling always allows its server timeout. */
  readonly requestTimeoutMs?: number;
}

export { TelegramClient, type TelegramClientApi, type TelegramFetch } from './telegram-client.js';

/**
 * Telegram Bot API 无列表类接口（无 getMyChats/getChatMembers），
 * 仅 getChat/getChatMember 按已知 id 单查，不构成列表能力；
 * 因此本 endpoint 不暴露 EndpointManagement（Console 社交面 RPC 对该平台保持未接线）。
 */
export class TelegramEndpoint extends TelegramClient implements Endpoint {
  readonly [endpointSpec]: EndpointSpecification;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: TelegramEndpointOptions;
  #pollAbort?: AbortController;
  #pollPromise?: Promise<void>;
  readonly #lifecycle: EndpointLifecycle;
  #open = false;
  #admission?: AbortController;
  #executionSignal?: AbortSignal;
  #updateOffset = 0;
  #pollingHealthy = true;
  readonly #admittedUpdates = new Set<number>();
  readonly #inflightUpdates = new Map<number, Promise<void>>();
  #botUserId?: number;
  #botUsername?: string;
  readonly #chatMemberCache = new Map<string, ChatMemberPermit>();
  readonly #control: EndpointControl = Object.freeze<EndpointControl>({
    recall: ({ message, signal }) => this.recallMessage(message, signal),
  });
  readonly #content: EndpointContentPort = Object.freeze({
    resolve: (reference: ConversationReference, context: EndpointContentResolveContext) => this.#resolveContent(reference, context.signal),
  });

  constructor(options: TelegramEndpointOptions) {
    super(options);
    this.#logger = getAdapterLogger('telegram', options.config.id);
    this.#lifecycle = createEndpointLifecycle({ name: options.config.id, reconnect: false });
    this.#options = options;
    const endpoint = this;
    this[endpointSpec] = createEndpointSpecification(this, {
      start: signal => this.#startFramework(signal), open: () => this.#openFramework(), close: () => this.#closeFramework(),
      stop: () => this.#stopFramework(), send: request => this.#sendFramework(request),
      get name() { return options.config.id; }, get transportState() { return endpoint.#transportState; },
      control: this.#control, content: this.#content,
    });
  }

  /** Used by webhook handler. */
  get isOpen(): boolean {
    return this.#open;
  }

  get #transportState(): EndpointTransportState {
    const state = this.#lifecycle.state;
    return state === 'open' && this.#options.config.mode === 'polling' && !this.#pollingHealthy
      ? 'reconnecting' : state;
  }

  setPollingHealthy(healthy: boolean): void {
    this.#pollingHealthy = healthy;
  }

  get config(): ResolvedTelegramConfig {
    return this.#options.config;
  }

  get allowedUpdates(): readonly string[] {
    return this.#options.config.allowedUpdates;
  }

  getUpdateOffset(): number {
    return this.#updateOffset;
  }

  setUpdateOffset(offset: number): void {
    this.#updateOffset = offset;
  }

  async #startFramework(signal: AbortSignal): Promise<void> {
    this.#executionSignal = signal;
    this.restartRequests();
    await this.#lifecycle.start(async (handle) => {
      const abort = new AbortController();
      const routes: HttpRouteRegistration[] = [];
      this.#pollAbort = abort;
      this.requestSignal = AbortSignal.any([abort.signal, signal]);
      const cleanup = () => {
        abort.abort();
        for (const release of routes.splice(0)) release();
        if (this.#pollAbort === abort) {
          this.#botUserId = undefined;
          this.#botUsername = undefined;
        }
      };
      handle.onForceClose(cleanup);
      try {
        const me = await this.callApi<{ id?: number; username?: string; first_name?: string }>('getMe', {}, abort.signal);
        if (abort.signal.aborted) return;
        this.#botUserId = me.id;
        this.#botUsername = me.username;

        if (this.#options.config.mode === 'webhook') {
          if (!this.#options.http) {
            throw new TypeError('Telegram webhook mode requires httpHostToken');
          }
          routes.push(...registerTelegramWebhookRoutes(this.#options.http, this));
          const webhook = this.#options.config.webhook!;
          if (!webhook.secretToken) {
            // 未配 secretToken 时 webhook 无鉴权：任何人知道 path 即可注入假 update。
            this.#logger.warn(formatCompact({
              op: 'webhook_no_secret',
              endpoint: this.#options.config.id,
              path: webhook.path,
              hint: 'set webhook.secretToken to authenticate Telegram callbacks',
            }));
          }
          const url = buildWebhookUrl(webhook);
          await this.callApi('setWebhook', {
            url,
            allowed_updates: this.#options.config.allowedUpdates,
            ...(webhook.secretToken ? { secret_token: webhook.secretToken } : {}),
          }, abort.signal);
          if (abort.signal.aborted) return;
          this.#logger.info(formatCompact({
            op: 'connect',
            endpoint: this.#options.config.id,
            mode: 'webhook',
            path: webhook.path,
            username: me.username,
          }));
          return;
        }

        await this.callApi('deleteWebhook', { drop_pending_updates: false }, abort.signal);
        if (abort.signal.aborted) return;
        this.#pollPromise = runTelegramPollLoop(this, abort.signal);
        this.#logger.info(formatCompact({
          op: 'connect',
          endpoint: this.#options.config.id,
          mode: 'polling',
          username: me.username,
        }));
      } catch (error) {
        const cancelled = abort.signal.aborted;
        cleanup();
        if (cancelled) return;
        this.#logger.error('Failed to connect Telegram bot:', error);
        throw error;
      }
    });
  }

  #openFramework(): void {
    if (this.#open) return;
    this.#admission = new AbortController();
    this.#chatMemberCache.clear();
    this.#open = true;
  }

  #closeFramework(): void {
    this.#open = false;
    this.#chatMemberCache.clear();
  }

  async #stopFramework(): Promise<void> {
    this.#admission?.abort();
    this.#closeFramework();
    this.cancelRequests();
    const polling = this.#pollPromise;
    this.#pollPromise = undefined;
    await this.#lifecycle.stop();
    try {
      await polling;
    } catch {
      /* poll loop exit */
    }
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async #sendFramework({ conversation, payload, signal }: EndpointSendRequest): Promise<string> {
    let lastId = '';
    let completedActions = 0;
    try {
      const plan = formatOutboundPlan(conversation.id, payload);
      for (const action of plan.actions) {
        signal?.throwIfAborted();
        const form = await this.#buildUploadForm(action.params, plan.uploads, signal);
        signal?.throwIfAborted();
        const result = form
          ? await this.callApiForm<{ message_id?: number }>(action.method, form, signal)
          : await this.callApi<{ message_id?: number }>(action.method, action.params, signal);
        if (!result || !Number.isSafeInteger(result.message_id) || result.message_id! <= 0) {
          throw new EndpointDeliveryError('delivery_unconfirmed',
            `Telegram API ${action.method} returned no valid message_id; delivery is unconfirmed`, 'unknown');
        }
        lastId = String(result.message_id);
        completedActions += 1;
      }
      if (!lastId) throw new EndpointDeliveryError('empty_message', 'Telegram message contains no sendable actions', 'not_sent');
      return lastId;
    } catch (error) {
      if (completedActions > 0) {
        throw new EndpointDeliveryError('partial_delivery',
          `Telegram message failed after ${completedActions} confirmed action(s); complete delivery is unconfirmed`,
          'unknown', { cause: error });
      }
      if (error instanceof EndpointDeliveryError) throw error;
      throw new EndpointDeliveryError('invalid_payload', 'Telegram message could not be prepared', 'not_sent', { cause: error });
    }
  }

  async recallMessage(message: MessageRef, signal?: AbortSignal): Promise<void> {
    if (!message.id || message.id.startsWith('telegram-')) return;
    await this.callApi('deleteMessage', {
      chat_id: message.conversation.id,
      message_id: Number(message.id),
    }, signal);
  }

  async #resolveContent(
    reference: Parameters<EndpointContentPort['resolve']>[0],
    signal: AbortSignal,
  ): Promise<ConversationResolution> {
    if (reference.kind !== 'media') {
      return Object.freeze({ status: 'unsupported', code: 'telegram_message_lookup_unavailable' });
    }
    if (reference.media.kind !== 'file') {
      return Object.freeze({ status: 'resolved', reference, value: reference.media });
    }
    try {
      signal.throwIfAborted();
      const file = await this.callApi<{ file_path?: string; file_size?: number }>('getFile', {
        file_id: reference.media.value,
      }, signal);
      if (!file.file_path) return Object.freeze({ status: 'not_found', code: 'telegram_file_not_found' });
      if ((file.file_size ?? 0) > 26_214_400) return Object.freeze({ status: 'forbidden', code: 'media_size_limit' });
      return await this.withRequestDeadline<ConversationResolution>({ method: 'downloadFile', run: async (downloadSignal) => {
        const response = await this.fetchTransport(
          `${this.#options.config.apiBaseUrl}/file/bot${this.#options.config.token}/${file.file_path}`,
          { signal: downloadSignal },
        );
        if (!response.ok) return Object.freeze({ status: 'failed', code: 'telegram_file_download_failed' });
        if (!response.arrayBuffer) return Object.freeze({ status: 'failed', code: 'telegram_binary_transport_unavailable' });
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength > 26_214_400) return Object.freeze({ status: 'forbidden', code: 'media_size_limit' });
        return Object.freeze({
          status: 'resolved',
          reference,
          value: Object.freeze({
            kind: 'base64',
            value: bytes.toString('base64'),
            ...(response.headers?.get('content-type')?.split(';')[0] || reference.media.mime_type
              ? { mime_type: response.headers?.get('content-type')?.split(';')[0] ?? reference.media.mime_type }
              : {}),
            ...(reference.media.file_name ? { file_name: reference.media.file_name } : {}),
            size: bytes.byteLength,
          }),
        });
      }, signal });
    } catch {
      if (signal.aborted) return Object.freeze({ status: 'expired', code: 'turn_aborted' });
      return Object.freeze({ status: 'failed', code: 'telegram_file_resolution_failed', message: 'Telegram file resolution failed' });
    }
  }

  /**
   * 含 `attach://` 占位的媒体参数 → multipart/form-data：
   * 标量参数原样、对象参数 JSON 序列化、attach 占位替换为文件 part
   * （base64 直接解码，本地路径读盘）。无上传时返回 undefined（走 JSON 调用）。
   */
  async #buildUploadForm(
    params: Record<string, unknown>,
    uploads: readonly TelegramOutboundUpload[],
    signal?: AbortSignal,
  ): Promise<FormData | undefined> {
    const values = Object.values(params);
    if (!values.some((v) => typeof v === 'string' && v.startsWith('attach://'))) return undefined;
    const form = new FormData();
    for (const [key, value] of Object.entries(params)) {
      if (value == null) continue;
      if (typeof value === 'string' && value.startsWith('attach://')) {
        const upload = uploads.find((item) => `attach://${item.attachName}` === value);
        if (!upload) throw new Error(`Telegram upload 未登记: ${value}`);
        const data = upload.source.kind === 'base64'
          ? Buffer.from(upload.source.data, 'base64')
          : await readFile(upload.source.path, { signal });
        form.append(
          key,
          new Blob([data], upload.mimeType ? { type: upload.mimeType } : undefined),
          upload.filename,
        );
        continue;
      }
      form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    return form;
  }

  /** Test / internal: admit a message when open. */
  admit(msg: TelegramMessage): void {
    void this[endpointSpec].events.run(() => {
      if (!this.#admission) return;
      const conversation = telegramInboundConversation(String(this.#options.id), msg.chat);
      return this.#admitWithSenderRole({ message: msg, conversation, signal: AbortSignal.any([this.#admission.signal, this.#executionSignal!]) }).catch((err) => {
        this.#logger.warn(formatCompact({
          op: 'telegram_gateway_receive_failed',
          target: `${conversation.kind}:${conversation.id}`,
          error: err instanceof Error ? err.message : String(err),
        }));
      });
    }).catch(() => this.#logger.debug('Inbound callback was not admitted'));
  }

  async #admitWithSenderRole({ message: msg, conversation, signal, event = msg }: TelegramMessageAdmission): Promise<void> {
    const permit = await this.#resolveGroupSenderPermit(msg, signal);
    signal.throwIfAborted();
    // 新 Runtime Message.content 为纯文本：@ 本机只能经 metadata 传递
    const mentioned = this.#isBotMentioned(msg);
    await this[endpointSpec].events.emitAccepted('message.receive', {
      event,
      ...(typeof msg.date === 'number' ? { platformSentAt: msg.date * 1_000 } : {}),
      conversation,
      message: { conversation, id: String(msg.message_id) },
      content: formatInboundContent(msg),
      segments: formatInboundSegments(msg),
      sender: {
        id: String(msg.from?.id ?? ''),
        name: senderDisplayName(msg.from) || undefined,
        ...(permit?.role ? { roles: [permit.role] } : {}),
      },
      endpointId: this.#options.config.id,
      ...(mentioned ? { mentioned: true } : {}),
      metadata: Object.freeze({
        channelType: resolveTelegramChannelType(msg.chat.type),
        chatType: msg.chat.type,
        userId: msg.from?.id,
        date: msg.date,
        ...(permit?.role ? { senderRole: permit.role } : {}),
        ...(permit?.permissions.length ? { senderPermissions: [...permit.permissions] } : {}),
      }),
    });
  }

  /** entities 里 mention 文本命中 bot username（getMe 缓存），或 text_mention 指向 bot 用户。 */
  #isBotMentioned(msg: TelegramMessage): boolean {
    if (!msg.entities?.length) return false;
    for (const entity of msg.entities) {
      if (entity.type === 'text_mention') {
        if (this.#botUserId != null && entity.user?.id === this.#botUserId) return true;
        continue;
      }
      if (entity.type !== 'mention' || !this.#botUsername) continue;
      const slice = (msg.text ?? '').slice(entity.offset, entity.offset + entity.length);
      if (slice.toLowerCase() === `@${this.#botUsername.toLowerCase()}`) return true;
    }
    return false;
  }

  /** 群消息 sender role 解析：getChatMember + 60s 缓存（对齐旧 enrichGroupSender）。 */
  async #resolveGroupSenderPermit(msg: TelegramMessage, signal: AbortSignal): Promise<ChatMemberPermit | undefined> {
    if (msg.chat.type === 'private' || !msg.from?.id) return undefined;
    const chatId = Number(msg.chat.id);
    const userId = msg.from.id;
    const key = `${chatId}:${userId}`;
    const now = Date.now();
    this.#sweepChatMemberCache(now);
    const cached = this.#chatMemberCache.get(key);
    if (cached && now - cached.at < CHAT_MEMBER_CACHE_TTL_MS) return cached;
    try {
      const member = await this.callApi<TelegramChatMember>('getChatMember', {
        chat_id: chatId,
        user_id: userId,
      }, signal);
      if (signal.aborted) return undefined;
      const normalized = normalizeTelegramChatMember(member);
      const entry: ChatMemberPermit = { at: now, ...normalized };
      this.#chatMemberCache.set(key, entry);
      return entry;
    } catch {
      // 保守拒绝：无角色快照
      return undefined;
    }
  }

  #sweepChatMemberCache(now: number): void {
    for (const [key, entry] of this.#chatMemberCache) {
      if (now - entry.at >= CHAT_MEMBER_CACHE_TTL_MS) this.#chatMemberCache.delete(key);
    }
    if (this.#chatMemberCache.size > CHAT_MEMBER_CACHE_MAX) {
      const excess = this.#chatMemberCache.size - CHAT_MEMBER_CACHE_MAX;
      let removed = 0;
      for (const [key] of this.#chatMemberCache) {
        if (removed >= excess) break;
        this.#chatMemberCache.delete(key);
        removed++;
      }
    }
  }

  /** Test / internal: admit a callback query when open. */
  admitCallback(query: TelegramCallbackQuery): void {
    void this[endpointSpec].events.run(() => {
      return this.#admitCallback(query).catch((err) => {
        this.#logger.warn(formatCompact({
          op: 'telegram_gateway_receive_failed',
          error: err instanceof Error ? err.message : String(err),
        }));
      });
    }).catch(() => this.#logger.debug('Inbound callback was not admitted'));
  }

  async #admitCallback(query: TelegramCallbackQuery, event: unknown = query): Promise<void> {
    const endpointKey = String(this.#options.id);
    const msg = query.message;
    // 无挂载消息的 callback（如 inline 模式）退化为 sender 私聊会话
    const conversation = msg
      ? telegramInboundConversation(endpointKey, msg.chat)
      : telegramInboundConversation(endpointKey, { id: query.from.id, type: 'private' });
    await this[endpointSpec].events.emitAccepted('message.receive', {
      event,
      conversation,
      message: { conversation, id: query.id },
      content: formatCallbackContent(query),
      segments: formatCallbackSegments(query),
      sender: { id: String(query.from?.id ?? ''), name: senderDisplayName(query.from) || undefined },
      endpointId: this.#options.config.id,
      metadata: Object.freeze({
        eventType: 'callback_query',
        payload: query.data,
        sourceMessageId: msg ? String(msg.message_id) : undefined,
      }),
    });
  }

  /** Used by webhook / polling handlers. */
  async handleUpdate(update: TelegramUpdate): Promise<void> {
    return this[endpointSpec].events.run(async () => {
      if (!this.#admission) throw new Error('Telegram endpoint is not accepting updates');
      if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) {
        throw new TypeError('Telegram update_id must be a non-negative safe integer');
      }
      if (this.#admittedUpdates.has(update.update_id)) return;
      const pending = this.#inflightUpdates.get(update.update_id);
      if (pending) return pending;
      if (this.#inflightUpdates.size >= INFLIGHT_UPDATE_LIMIT) {
        throw new Error('Telegram update admission capacity exhausted');
      }
      const admission = this.#admission;
      const receiving = (async () => {
        // Once canonical dispatch enters Core, its generation lease drains the work.
        // Closing the transport cannot turn successful business processing into a retry.
        await this.#receiveUpdate(update, AbortSignal.any([admission.signal, this.#executionSignal!]));
        this.#admittedUpdates.add(update.update_id);
        if (this.#admittedUpdates.size > ADMITTED_UPDATE_LIMIT) {
          this.#admittedUpdates.delete(this.#admittedUpdates.values().next().value!);
        }
      })();
      this.#inflightUpdates.set(update.update_id, receiving);
      try {
        await receiving;
      } finally {
        this.#inflightUpdates.delete(update.update_id);
      }
    });
  }

  async #receiveUpdate(update: TelegramUpdate, signal: AbortSignal): Promise<void> {
    const eventName = update.message
      ? 'message'
      : update.callback_query
        ? 'callback_query'
        : 'update';
    if (update.message || update.callback_query) {
      await this[endpointSpec].events.platform(eventName, update);
    } else {
      await this[endpointSpec].events.emitAccepted('platform.receive', Object.freeze({ name: eventName, event: update }));
      return;
    }
    signal.throwIfAborted();
    if (update.message) {
      const conversation = telegramInboundConversation(String(this.#options.id), update.message.chat);
      await this.#admitWithSenderRole({ message: update.message, conversation, signal, event: update });
      return;
    }
    if (update.callback_query) {
      const query = update.callback_query;
      if (query.data) {
        void this.callApi('answerCallbackQuery', { callback_query_id: query.id }, signal).catch(() => {
          /* already answered */
        });
      }
      await this.#admitCallback(query, update);
    }
  }

}
