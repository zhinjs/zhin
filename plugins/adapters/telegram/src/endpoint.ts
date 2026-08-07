/**
 * TelegramEndpoint — lifecycle, outbound, admit, Bot API helpers for agent tools.
 */
import { readFile } from 'node:fs/promises';
import type { EndpointControl, EndpointInstance, EndpointSendRequest } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import {
  formatLegacyMessageRef,
  nativeConversationId,
  parseLegacyMessageReference,
  type ConversationRef,
} from '@zhin.js/im-contract';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { runTelegramPollLoop } from './polling.js';
import { normalizeTelegramChatMember } from './platform-permit.js';
import {
  botApiUrl,
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
import { registerTelegramAgentEndpoint } from './telegram-agent-deps.js';
import { registerTelegramWebhookRoutes } from './webhook.js';

const CHAT_MEMBER_CACHE_TTL_MS = 60_000;
const CHAT_MEMBER_CACHE_MAX = 2_000;

interface ChatMemberPermit {
  readonly at: number;
  readonly role?: string;
  readonly permissions: string[];
}

export type TelegramFetch = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string | FormData;
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

export interface TelegramEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly config: ResolvedTelegramConfig;
  readonly http?: HttpHost;
  readonly fetch?: TelegramFetch;
}

interface TelegramApiOk<T> {
  readonly ok: true;
  readonly result: T;
}

interface TelegramApiErr {
  readonly ok: false;
  readonly description?: string;
  readonly error_code?: number;
}

/**
 * Telegram Bot API 无列表类接口（无 getMyChats/getChatMembers），
 * 仅 getChat/getChatMember 按已知 id 单查，不构成列表能力；
 * 因此本 endpoint 不暴露 EndpointManagement（Console 社交面 RPC 对该平台保持未接线）。
 */
export class TelegramEndpoint implements EndpointInstance {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: TelegramEndpointOptions;
  readonly #fetch: TelegramFetch;
  #pollAbort?: AbortController;
  #pollPromise?: Promise<void>;
  #routeReleases: HttpRouteRegistration[] = [];
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;
  #updateOffset = 0;
  #botUserId?: number;
  #botUsername?: string;
  readonly #chatMemberCache = new Map<string, ChatMemberPermit>();
  readonly control: EndpointControl = Object.freeze({
    recall: (messageId: string) => this.recallMessage(messageId),
  });

  constructor(options: TelegramEndpointOptions) {
    this.#logger = getAdapterLogger('telegram', options.config.name);
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  /** Used by webhook handler. */
  get isOpen(): boolean {
    return this.#open;
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

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      this.#unregisterAgent = registerTelegramAgentEndpoint(this.#options.config.name, this);
      const me = await this.callApi<{ id?: number; username?: string; first_name?: string }>('getMe');
      this.#botUserId = me.id;
      this.#botUsername = me.username;

      if (this.#options.config.mode === 'webhook') {
        if (!this.#options.http) {
          throw new TypeError('Telegram webhook mode requires httpHostToken');
        }
        this.#routeReleases.push(...registerTelegramWebhookRoutes(this.#options.http, this));
        const webhook = this.#options.config.webhook!;
        if (!webhook.secretToken) {
          // 未配 secretToken 时 webhook 无鉴权：任何人知道 path 即可注入假 update。
          this.#logger.warn(formatCompact({
            op: 'webhook_no_secret',
            endpoint: this.#options.config.name,
            path: webhook.path,
            hint: 'set webhook.secretToken to authenticate Telegram callbacks',
          }));
        }
        const url = buildWebhookUrl(webhook);
        await this.callApi('setWebhook', {
          url,
          allowed_updates: this.#options.config.allowedUpdates,
          ...(webhook.secretToken ? { secret_token: webhook.secretToken } : {}),
        });
        this.#logger.info(formatCompact({
          op: 'connect',
          endpoint: this.#options.config.name,
          mode: 'webhook',
          path: webhook.path,
          username: me.username,
        }));
        return;
      }

      await this.callApi('deleteWebhook', { drop_pending_updates: false });
      this.#pollAbort = new AbortController();
      this.#pollPromise = runTelegramPollLoop(this, this.#pollAbort.signal);
      this.#logger.info(formatCompact({
        op: 'connect',
        endpoint: this.#options.config.name,
        mode: 'polling',
        username: me.username,
      }));
    } catch (error) {
      await this.stop();
      this.#logger.error('Failed to connect Telegram bot:', error);
      throw error;
    }
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  async stop(): Promise<void> {
    this.#open = false;
    this.#pollAbort?.abort();
    try {
      await this.#pollPromise;
    } catch {
      /* poll loop exit */
    }
    for (const release of this.#routeReleases.splice(0)) release();
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
    this.#chatMemberCache.clear();
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const plan = formatOutboundPlan(conversation.id, payload);
    let lastId = '';
    for (const action of plan.actions) {
      const form = await this.#buildUploadForm(action.params, plan.uploads);
      const result = form
        ? await this.callApiForm<{ message_id?: number }>(action.method, form)
        : await this.callApi<{ message_id?: number }>(action.method, action.params);
      if (result.message_id != null) lastId = String(result.message_id);
    }
    if (!lastId) return `telegram-${Date.now()}`;
    return formatLegacyMessageRef({ conversation, id: lastId });
  }

  async recallMessage(messageId: string): Promise<void> {
    if (!messageId || messageId.startsWith('telegram-')) return;
    const reference = parseLegacyMessageReference(messageId);
    if (!reference) return;
    const chatId = nativeConversationId(reference.target);
    const msgId = reference.messageId;
    await this.callApi('deleteMessage', { chat_id: chatId, message_id: Number(msgId) });
  }

  /**
   * 含 `attach://` 占位的媒体参数 → multipart/form-data：
   * 标量参数原样、对象参数 JSON 序列化、attach 占位替换为文件 part
   * （base64 直接解码，本地路径读盘）。无上传时返回 undefined（走 JSON 调用）。
   */
  async #buildUploadForm(
    params: Record<string, unknown>,
    uploads: readonly TelegramOutboundUpload[],
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
          : await readFile(upload.source.path);
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
    if (!this.#open) return;
    const conversation = telegramInboundConversation(String(this.#options.id), msg.chat);
    void this.#admitWithSenderRole(msg, conversation).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'telegram_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async #admitWithSenderRole(msg: TelegramMessage, conversation: ConversationRef): Promise<void> {
    const permit = await this.#resolveGroupSenderPermit(msg);
    // 新 Runtime Message.content 为纯文本：@ 本机只能经 metadata 传递
    const mentioned = this.#isBotMentioned(msg);
    await this.#options.gateway.receive({
      conversation,
      message: { conversation, id: String(msg.message_id) },
      content: formatInboundContent(msg),
      segments: formatInboundSegments(msg),
      sender: senderDisplayName(msg.from),
      metadata: Object.freeze({
        endpoint: this.#options.config.name,
        // Preserve Telegram's native value below, but publish the canonical
        // scene kind so every Runtime consumer sees the same conversation type.
        channelType: resolveTelegramChannelType(msg.chat.type),
        chatType: msg.chat.type,
        userId: msg.from?.id,
        date: msg.date,
        ...(permit?.role ? { senderRole: permit.role } : {}),
        ...(permit?.permissions.length ? { senderPermissions: [...permit.permissions] } : {}),
        ...(mentioned ? { mentioned: true } : {}),
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
  async #resolveGroupSenderPermit(msg: TelegramMessage): Promise<ChatMemberPermit | undefined> {
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
      });
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
    if (!this.#open) return;
    const endpointId = String(this.#options.id);
    const msg = query.message;
    // 无挂载消息的 callback（如 inline 模式）退化为 sender 私聊会话
    const conversation = msg
      ? telegramInboundConversation(endpointId, msg.chat)
      : telegramInboundConversation(endpointId, { id: query.from.id, type: 'private' });
    void this.#options.gateway.receive({
      conversation,
      message: { conversation, id: query.id },
      content: formatCallbackContent(query),
      segments: formatCallbackSegments(query),
      sender: senderDisplayName(query.from),
      metadata: Object.freeze({
        endpoint: this.#options.config.name,
        eventType: 'callback_query',
        payload: query.data,
        sourceMessageId: msg ? String(msg.message_id) : undefined,
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'telegram_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  /** Used by webhook / polling handlers. */
  handleUpdate(update: TelegramUpdate): void {
    if (update.message) {
      this.admit(update.message);
      return;
    }
    if (update.callback_query) {
      const query = update.callback_query;
      if (query.data) {
        void this.callApi('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {
          /* already answered */
        });
      }
      this.admitCallback(query);
    }
  }

  async callApi<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const url = botApiUrl(this.#options.config, method);
    const response = await this.#fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal,
    });
    return this.#parseApiResponse<T>(method, response);
  }

  /** multipart/form-data 变体（attach:// 媒体上传；Content-Type 边界由 FormData 自带）。 */
  async callApiForm<T = unknown>(
    method: string,
    form: FormData,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = botApiUrl(this.#options.config, method);
    const response = await this.#fetch(url, {
      method: 'POST',
      body: form,
      signal,
    });
    return this.#parseApiResponse<T>(method, response);
  }

  async #parseApiResponse<T>(
    method: string,
    response: { readonly status: number; text(): Promise<string> },
  ): Promise<T> {
    const text = await response.text();
    let body: TelegramApiOk<T> | TelegramApiErr;
    try {
      body = JSON.parse(text) as TelegramApiOk<T> | TelegramApiErr;
    } catch {
      throw new Error(`Telegram API ${method} invalid JSON (${response.status}): ${text.slice(0, 200)}`);
    }
    if (!body.ok) {
      throw new Error(
        `Telegram API ${method} failed (${body.error_code ?? response.status}): ${body.description ?? text}`,
      );
    }
    return body.result;
  }

  // ── Agent tool surface ──────────────────────────────────────────────

  async pinMessage(chatId: number, messageId: number): Promise<boolean> {
    await this.callApi('pinChatMessage', { chat_id: chatId, message_id: messageId });
    return true;
  }

  async unpinMessage(chatId: number, messageId?: number): Promise<boolean> {
    if (messageId != null) {
      await this.callApi('unpinChatMessage', { chat_id: chatId, message_id: messageId });
    } else {
      await this.callApi('unpinAllChatMessages', { chat_id: chatId });
    }
    return true;
  }

  async setChatDescription(chatId: number, description: string): Promise<boolean> {
    await this.callApi('setChatDescription', { chat_id: chatId, description });
    return true;
  }

  async setMessageReaction(chatId: number, messageId: number, reaction: string): Promise<boolean> {
    await this.callApi('setMessageReaction', {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: 'emoji', emoji: reaction }],
    });
    return true;
  }

  async getChatMemberCount(chatId: number): Promise<number> {
    return this.callApi<number>('getChatMemberCount', { chat_id: chatId });
  }

  async getChatAdmins(chatId: number): Promise<TelegramChatMember[]> {
    return this.callApi<TelegramChatMember[]>('getChatAdministrators', { chat_id: chatId });
  }

  async sendStickerMessage(chatId: number, sticker: string): Promise<{ message_id: number }> {
    return this.callApi<{ message_id: number }>('sendSticker', { chat_id: chatId, sticker });
  }

  async setChatPermissionsAll(
    chatId: number,
    permissions: Record<string, boolean | undefined>,
  ): Promise<boolean> {
    await this.callApi('setChatPermissions', { chat_id: chatId, permissions });
    return true;
  }

  async createInviteLink(chatId: number): Promise<string> {
    const link = await this.callApi<{ invite_link: string }>('createChatInviteLink', { chat_id: chatId });
    return link.invite_link;
  }

  async sendPoll(
    chatId: number,
    question: string,
    options: string[],
    isAnonymous = true,
    allowsMultipleAnswers = false,
  ): Promise<{ message_id: number }> {
    return this.callApi<{ message_id: number }>('sendPoll', {
      chat_id: chatId,
      question,
      options,
      is_anonymous: isAnonymous,
      allows_multiple_answers: allowsMultipleAnswers,
    });
  }
}
