import { EventEmitter } from 'node:events';
import { sendWeixinMediaFile } from './weixin-send-media.js';
/**
 * WeixinIlinkClient — lifecycle, long-poll inbound, outbound send.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  createEndpointOperation,
  type EndpointFriend,
  type EndpointControl,
  type EndpointManagement,
  type EndpointSendRequest,
  type EndpointManagementRequest,
  type EndpointOperationOptions,
} from 'zhin.js/adapter';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import { getUpdates, notifyStart, notifyStop, sendTyping, type WeixinApiOptions } from './ilink-api.js';
import { IlinkClientMetadata } from './ilink-meta.js';
import {
  type WeixinIlinkCredentials,
  WeixinIlinkStateStore,
} from './credentials.js';
import { resolveCredentials } from './login.js';
import {
  WeixinContextTokenStore,
} from './context-store.js';
import { WeixinConfigManager } from './ilink-config-cache.js';
import {
  IlinkSessionGuard,
  SESSION_EXPIRED_ERRCODE,
} from './ilink-session-guard.js';
import { downloadMediaFromItem, type SaveMediaRequest } from './media-download.js';
import { sendMessageWeixin } from './weixin-send.js';
import { materializeOutboundMedia } from './outbound-media.js';
import { MessageItemType, type WeixinMessage } from './ilink-types.js';
import { getExtensionFromMime, sniffMimeFromBuffer } from './mime.js';
import type { WeixinInboundMediaOpts } from './weixin-inbound.js';
import {
  formatInboundContent,
  weixinInboundSegments,
  weixinReplyTo,
  formatOutboundSegments,
  inboundMessageId,
  segmentLocalPath,
  sleep,
  weixinIlinkInboundConversation,
  type ResolvedWeixinIlinkConfig,
  type WeixinMessageWithMedia,
  type WeixinWireSegment,
} from './protocol.js';

const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 2_000;
const WEIXIN_MEDIA_MAX_BYTES = 100 * 1024 * 1024;
/** 入站媒体保留 24h，每小时清扫一次。 */
const INBOUND_MEDIA_TTL_MS = 24 * 60 * 60 * 1000;
const MEDIA_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export type WeixinIlinkSendText = typeof sendMessageWeixin;
export type WeixinIlinkNotifyStart = typeof notifyStart;
export type WeixinIlinkNotifyStop = typeof notifyStop;
export type WeixinIlinkGetUpdates = typeof getUpdates;

export interface WeixinIlinkEndpointOptions {
  readonly id: CapabilityId;
  readonly config: ResolvedWeixinIlinkConfig;
  readonly resolveCredentials?: (
    config: ResolvedWeixinIlinkConfig,
    metadata: IlinkClientMetadata,
    state: WeixinIlinkStateStore,
    signal?: AbortSignal,
  ) => Promise<WeixinIlinkCredentials>;
  /** Test / internal: override network side effects. */
  readonly notifyStart?: WeixinIlinkNotifyStart;
  readonly notifyStop?: WeixinIlinkNotifyStop;
  readonly getUpdates?: WeixinIlinkGetUpdates;
  readonly sendText?: WeixinIlinkSendText;
  readonly state?: WeixinIlinkStateStore;
  readonly contextTokens?: WeixinContextTokenStore;
  readonly sessionGuard?: IlinkSessionGuard;
}

interface IlinkRecipientRequest {
  readonly to: string;
  readonly signal?: AbortSignal;
}
interface IlinkTextRequest extends IlinkRecipientRequest { readonly text: string }
interface IlinkMediaRequest extends IlinkRecipientRequest { readonly filePath: string; readonly text?: string }
interface IlinkTypingRequest { readonly userId: string; readonly status: number; readonly signal?: AbortSignal }

export class WeixinIlinkClient extends EventEmitter {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: WeixinIlinkEndpointOptions;
  readonly #resolveCredentials: (
    config: ResolvedWeixinIlinkConfig,
    metadata: IlinkClientMetadata,
    state: WeixinIlinkStateStore,
    signal?: AbortSignal,
  ) => Promise<WeixinIlinkCredentials>;
  readonly #notifyStart: WeixinIlinkNotifyStart;
  readonly #notifyStop: WeixinIlinkNotifyStop;
  readonly #getUpdates: WeixinIlinkGetUpdates;
  readonly #sendText: WeixinIlinkSendText;
  readonly #state: WeixinIlinkStateStore;
  readonly #contextTokens: WeixinContextTokenStore;
  readonly #sessionGuard: IlinkSessionGuard;
  readonly #metadata: IlinkClientMetadata;
  #creds: WeixinIlinkCredentials | null = null;
  #pollAbort?: AbortController;
  #pollPromise?: Promise<void>;
  #loginAbort?: AbortController;
  #configManager?: WeixinConfigManager;
  #mediaSweepTimer?: ReturnType<typeof setInterval>;
  #open = false;
  #started = false;
  #disconnecting?: Promise<void>;
  protected readonly endpointManagement: EndpointManagement = createWeixinIlinkEndpointManagement(() => this);
  protected readonly endpointControl: EndpointControl = Object.freeze<EndpointControl>({
    typing: ({ conversation, active, signal }) => this.sendTyping(conversation.id, active === false ? 2 : 1, { signal }).then(() => undefined),
  });

  protected configName(): string { return this.#options.config.id; }
  get transportState(): import('zhin.js/adapter').EndpointTransportState | undefined { return undefined; }
  protected executionSignal?: AbortSignal;
  protected setExecutionSignal(signal: AbortSignal): void { this.executionSignal = signal; }
  /** Cancellation retires this receipt even if an optional codec cannot cancel its own work. */
  #awaitInbound<T>(operation: Promise<T>): Promise<T> {
    const signal = this.executionSignal;
    if (!signal) return operation;
    return new Promise<T>((resolve, reject) => {
      const cancel = () => { signal.removeEventListener('abort', cancel); reject(signal.reason); };
      operation.then(value => { signal.removeEventListener('abort', cancel); resolve(value); },
        error => { signal.removeEventListener('abort', cancel); reject(error); });
      if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
    });
  }
  /** Native protocol work runs here; Endpoint attaches the framework receipt without replacing SDK APIs. */
  protected receiveInboundCallback<T>(receive: () => T | Promise<T>): Promise<T> {
    try { return Promise.resolve(receive()); } catch (error) { return Promise.reject(error); }
  }
  protected publishEvent(name: string, payload: unknown): Promise<unknown> { this.emit(name, payload); return Promise.resolve(); }
  protected publishAccepted(name: string, payload: unknown): Promise<void> { return this.publishEvent(name, payload).then(() => undefined); }
  protected publishPlatform(name: string, event: unknown): Promise<unknown> { this.emit(name, event); return Promise.resolve(); }

  constructor(options: WeixinIlinkEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('weixin-ilink', options.config.id);
    this.#options = options;
    this.#resolveCredentials = options.resolveCredentials ?? resolveCredentials;
    this.#notifyStart = options.notifyStart ?? notifyStart;
    this.#notifyStop = options.notifyStop ?? notifyStop;
    this.#getUpdates = options.getUpdates ?? getUpdates;
    this.#sendText = options.sendText ?? sendMessageWeixin;
    this.#state = options.state
      ?? new WeixinIlinkStateStore(options.config.id, options.config.dataDir);
    this.#contextTokens = options.contextTokens ?? new WeixinContextTokenStore(this.#state);
    this.#sessionGuard = options.sessionGuard ?? new IlinkSessionGuard(options.config.id);
    this.#metadata = new IlinkClientMetadata({ botAgent: options.config.botAgent });

  }

  get credentials(): WeixinIlinkCredentials {
    const credentials = this.#creds;
    if (!credentials?.botToken) throw new Error('weixin-ilink client not authenticated');
    return credentials;
  }

  get authenticated(): boolean {
    return Boolean(this.#creds?.botToken);
  }

  get apiBaseUrl(): string {
    return this.#creds?.baseUrl ?? this.#options.config.baseUrl;
  }

  get cdnBaseUrl(): string {
    return this.#options.config.cdnBaseUrl;
  }

  contextToken(userId: string): string | undefined {
    return this.#contextTokens.get(userId);
  }

  reachableUserIds(): string[] {
    return this.#contextTokens.userIds();
  }

  sendText(to: string, text: string, options: EndpointOperationOptions = {}): Promise<{ messageId: string }> {
    return this.#sendTextRequest({ to, text, signal: options.signal });
  }

  sendMedia(to: string, filePath: string, text = ''): Promise<{ messageId: string }> {
    return this.#sendMediaRequest({ to, filePath, text });
  }

  sendTyping(userId: string, status: number, options: EndpointOperationOptions = {}): Promise<boolean> {
    return this.#sendTypingRequest({ userId, status, signal: options.signal });
  }

  #outboundOptions({ to, signal }: IlinkRecipientRequest): WeixinApiOptions & { contextToken: string } {
    const contextToken = this.contextToken(to);
    if (!contextToken) throw new Error(`missing context_token for peer ${to}`);
    const signals = [this.executionSignal, signal].filter((item): item is AbortSignal => !!item);
    const abortSignal = signals.length ? AbortSignal.any(signals) : undefined;
    abortSignal?.throwIfAborted();
    return { baseUrl: this.apiBaseUrl, metadata: this.#metadata, token: this.credentials.botToken,
      contextToken, abortSignal };
  }

  #sendTextRequest(request: IlinkTextRequest): Promise<{ messageId: string }> {
    return this.#sendText({ to: request.to, text: request.text, opts: this.#outboundOptions(request) });
  }

  #sendMediaRequest(request: IlinkMediaRequest): Promise<{ messageId: string }> {
    return sendWeixinMediaFile({ filePath: request.filePath, to: request.to, text: request.text ?? '',
      opts: this.#outboundOptions(request), cdnBaseUrl: this.cdnBaseUrl });
  }

  async #sendTypingRequest({ userId, status, signal }: IlinkTypingRequest): Promise<boolean> {
    const manager = this.#configManager;
    if (!this.authenticated || !manager) return false;
    const signals = [this.executionSignal, signal].filter((item): item is AbortSignal => !!item);
    const abortSignal = signals.length ? AbortSignal.any(signals) : undefined;
    const operation = createEndpointOperation({ signal: abortSignal });
    // Config lookup is shared by callers; cancel this waiter without cancelling the shared cache owner.
    const cfg = await operation.prepare(() => manager.getForUser(userId, this.contextToken(userId)));
    if (!cfg.typingTicket) return false;
    await operation.run(() => sendTyping({ baseUrl: this.apiBaseUrl, metadata: this.#metadata,
      token: this.credentials.botToken, abortSignal,
      body: { ilink_user_id: userId, typing_ticket: cfg.typingTicket!, status } }));
    return true;
  }

  get hasCredentials(): boolean {
    return this.authenticated;
  }

  protected async connectTransport(signal?: AbortSignal): Promise<void> {
    if (signal) { this.setExecutionSignal(signal); signal.throwIfAborted(); }
    if (this.#started) return;
    this.#started = true;
    try {
      // QR 登录最长 8 分钟：stop() 必须能打断
      this.#loginAbort = new AbortController();
      this.#creds = await this.#resolveCredentials(
        this.#options.config,
        this.#metadata,
        this.#state,
        this.#loginAbort.signal,
      );
      this.executionSignal?.throwIfAborted();
      this.#contextTokens.restore();

      await this.#notifyStart({
        baseUrl: this.apiBaseUrl,
        metadata: this.#metadata,
        token: this.#creds.botToken,
      });

      this.executionSignal?.throwIfAborted();
      this.#configManager = new WeixinConfigManager(
        {
          baseUrl: this.apiBaseUrl,
          metadata: this.#metadata,
          token: this.#creds.botToken,
          abortSignal: this.executionSignal,
        },
        (msg) => this.#logger.debug(msg),
      );

      this.#pollAbort = new AbortController();
      this.#startMediaSweep();
      this.#logger.info(formatCompact({
        op: 'connect',
        endpoint: this.#options.config.id,
      }));
      void this.#emitPlatformEvent('system.online', {
        account: this.#options.config.id,
      });
    } catch (error) {
      await this.disconnectTransport();
      this.#logger.error('Failed to connect weixin-ilink bot:', error);
      throw error;
    }
  }

  protected openInput(): void {
    this.#open = true;
    if (this.#pollAbort && !this.#pollPromise) this.#pollPromise = this.#pollLoop(this.#pollAbort.signal);
  }

  protected closeInput(): void {
    this.#open = false;
  }

  protected disconnectTransport(): Promise<void> { return this.#disconnecting ??= this.#disconnectNative(); }

  async #disconnectNative(): Promise<void> {
    this.#open = false;
    this.#loginAbort?.abort();
    this.#pollAbort?.abort();
    try {
      await this.#pollPromise;
    } catch {
      /* poll loop exit */
    }
    this.#stopMediaSweep();
    // 防抖中的 context token 落盘，避免 stop 丢尾部写入
    this.#contextTokens.flush();
    if (this.#creds?.botToken) {
      try {
        await this.#notifyStop({
          baseUrl: this.apiBaseUrl,
          metadata: this.#metadata,
          token: this.#creds.botToken,
        });
      } catch (err) {
        this.#logger.warn(formatCompact({
          op: 'notify_stop',
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }
    this.#started = false;
    void this.#emitPlatformEvent('system.offline', {
      account: this.#options.config.id,
    });
    this.#logger.debug(formatCompact({
          op: 'disconnect',
    }));
  }

  protected async sendPayload({ conversation, payload, signal }: EndpointSendRequest): Promise<string> {
    if (!this.#creds?.botToken) {
      throw new Error('weixin-ilink bot not authenticated');
    }
    // 个人微信仅 private 会话，对端 user_id 即 conversation.id
    const target = conversation.id;
    const contextToken = this.contextToken(target);
    if (!contextToken) {
      this.#logger.warn(formatCompact({
        op: 'send',
        ok: false,
        reason: 'missing_context_token',
        target,
      }));
      throw new Error(`missing context_token for peer ${target}`);
    }

    const outboundDir = this.#state.mediaDirectory('outbound');
    const wire = formatOutboundSegments(payload);
    const operation = createEndpointOperation({ signal });
    const materialized = await operation.prepare(() => materializeOutboundMedia(wire, outboundDir, signal));
    const segments = Array.isArray(materialized) ? materialized : [materialized];
    let lastId = '';
    let pendingText = '';

    for (const raw of segments) {
      if (typeof raw === 'string') {
        pendingText += raw;
        continue;
      }
      if (typeof raw !== 'object' || raw === null || !('type' in raw)) continue;
      const seg = raw as WeixinWireSegment;
      if (seg.type === 'text' || seg.type === 'markdown') {
        pendingText += String((seg.data as { text?: string } | undefined)?.text ?? '');
        continue;
      }

      const filePath = segmentLocalPath(seg);
      if (filePath && fs.existsSync(filePath)) {
        // 微信限制：单条消息不能图文混排 → 先单独发文本，再发纯媒体
        if (pendingText.trim()) {
          const textResult = await operation.run(() => this.sendText(target, pendingText, { signal }));
          pendingText = '';
          lastId = textResult.messageId;
        }
        const result = await operation.run(() => this.#sendMediaRequest({ to: target, filePath, signal }));
        lastId = result.messageId;
        continue;
      }

      if (seg.type === 'image' || seg.type === 'video' || seg.type === 'file' || seg.type === 'record') {
        this.#logger.warn(formatCompact({
          op: 'send',
          skip: 'no_local_file',
          type: seg.type,
        }));
      }
    }

    if (pendingText.trim()) {
      const result = await operation.run(() => this.sendText(target, pendingText, { signal }));
      lastId = result.messageId;
    }

    return lastId || `weixin-ilink-${Date.now()}`;
  }

  /** Test / internal: admit a parsed message when the endpoint is open. */
  async admit(msg: WeixinMessageWithMedia, nativeEvent: unknown = msg): Promise<boolean> {
    if (!this.#open) return false;
    return this.receiveInboundCallback(() => this.#admitAccepted(msg, nativeEvent));
  }

  async #admitAccepted(msg: WeixinMessageWithMedia, nativeEvent: unknown): Promise<boolean> {
    this.executionSignal?.throwIfAborted();
    const userId = msg.from_user_id ?? '';
    if (msg.context_token && userId) {
      this.#contextTokens.set(userId, msg.context_token);
    }
    const conversation = weixinIlinkInboundConversation(String(this.#options.id), userId);
    const replyTo = weixinReplyTo(msg);
    await this.publishAccepted('message.receive', {
      event: nativeEvent,
      conversation,
      message: { conversation, id: inboundMessageId(msg) },
      content: formatInboundContent(msg),
      segments: weixinInboundSegments(msg),
      ...(replyTo ? { replyTo } : {}),
      sender: { id: userId },
      endpointId: this.#options.config.id,
      metadata: Object.freeze({
        messageType: msg.message_type,
        createTimeMs: msg.create_time_ms,
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'weixin_ilink_gateway_receive_failed',
        target: userId,
        error: err instanceof Error ? err.message : String(err),
      }));
      throw err;
    });
    return this.#open;
  }

  async #pollLoop(abortSignal: AbortSignal): Promise<void> {
    if (!this.#creds?.botToken) return;

    let getUpdatesBuf = this.#state.loadSyncBuf();
    let nextTimeoutMs = this.#options.config.longPollTimeoutMs;
    let consecutiveFailures = 0;

    while (!abortSignal.aborted) {
      if (this.#sessionGuard.paused) {
        await sleep(this.#sessionGuard.remainingMs, abortSignal);
        continue;
      }

      try {
        const resp = await this.#getUpdates({
          baseUrl: this.apiBaseUrl,
          metadata: this.#metadata,
          token: this.#creds.botToken,
          get_updates_buf: getUpdatesBuf,
          timeoutMs: nextTimeoutMs,
          abortSignal,
        });

        abortSignal.throwIfAborted();
        if (resp.longpolling_timeout_ms != null && resp.longpolling_timeout_ms > 0) {
          nextTimeoutMs = resp.longpolling_timeout_ms;
        }

        const isApiError =
          (resp.ret !== undefined && resp.ret !== 0)
          || (resp.errcode !== undefined && resp.errcode !== 0);

        if (isApiError) {
          const sessionExpired =
            resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE;
          if (sessionExpired) {
            this.#sessionGuard.pause();
            consecutiveFailures = 0;
            await sleep(this.#sessionGuard.remainingMs, abortSignal);
            continue;
          }
          consecutiveFailures += 1;
          // 退避后不清零：对端持续挂时清零会让重试固定打满 RETRY_DELAY_MS。
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            await sleep(BACKOFF_DELAY_MS, abortSignal);
          } else {
            await sleep(RETRY_DELAY_MS, abortSignal);
          }
          continue;
        }

        consecutiveFailures = 0;
        // 先分发再推进 buf：分发途中崩溃时 buf 未推进，下一轮重拉不丢消息。
        const nextBuf = resp.get_updates_buf;
        for (const inbound of resp.msgs ?? []) {
          await this.#handleInboundMessage(inbound);
        }
        if (nextBuf) {
          getUpdatesBuf = nextBuf;
          this.#state.saveSyncBuf(getUpdatesBuf);
        }
      } catch (err) {
        if (abortSignal.aborted) return;
        consecutiveFailures += 1;
        this.#logger.error(formatCompact({
          op: 'poll',
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }));
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          await sleep(BACKOFF_DELAY_MS, abortSignal);
        } else {
          await sleep(RETRY_DELAY_MS, abortSignal);
        }
      }
    }
  }

  async #handleInboundMessage(full: WeixinMessage): Promise<void> {
    if (!this.#open) throw new Error('iLink input closed before admission');
    await this.receiveInboundCallback(async () => {
      void this.#emitPlatformEvent(`message.${full.message_type ?? 'unknown'}`, full);
      const fromUserId = full.from_user_id ?? '';
      const mediaOpts = await this.#awaitInbound(this.#downloadInboundMedia(full));
      // Close may drain this accepted message, but retirement must not mutate context tokens or ACK.
      this.executionSignal?.throwIfAborted();
      if (!await this.#admitAccepted({ ...full, _media: mediaOpts }, full)) throw new Error('iLink input closed before admission');
      this.#logger.debug(formatCompact({ op: 'recv', endpoint: this.#options.config.id, target: fromUserId,
        preview: formatInboundContent({ ...full, _media: mediaOpts }).slice(0, 80) }));
    });
  }

  async #emitPlatformEvent(name: string, event: unknown): Promise<void> {
    await this.publishPlatform(name, event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'weixin_ilink_platform_event_failed',
        event: name,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }

  async #downloadInboundMedia(full: WeixinMessage): Promise<WeixinInboundMediaOpts> {
    const hasDownloadableMedia = (m?: { encrypt_query_param?: string; full_url?: string }) =>
      Boolean(m?.encrypt_query_param || m?.full_url);

    const mediaItem =
      full.item_list?.find(
        (i) => i.type === MessageItemType.IMAGE && hasDownloadableMedia(i.image_item?.media),
      )
      ?? full.item_list?.find(
        (i) => i.type === MessageItemType.VIDEO && hasDownloadableMedia(i.video_item?.media),
      )
      ?? full.item_list?.find(
        (i) => i.type === MessageItemType.FILE && hasDownloadableMedia(i.file_item?.media),
      )
      ?? full.item_list?.find(
        (i) => i.type === MessageItemType.VOICE && hasDownloadableMedia(i.voice_item?.media),
      );

    if (!mediaItem) return {};

    return downloadMediaFromItem(mediaItem, {
      cdnBaseUrl: this.cdnBaseUrl, signal: this.executionSignal,
      saveMedia: request => this.#saveInboundMedia(request),
      log: (msg) => this.#logger.debug(msg),
      errLog: (msg) => this.#logger.warn(msg),
      label: `inbound:${full.from_user_id ?? 'unknown'}`,
    });
  }

  async #saveInboundMedia({ buffer, contentType, subdir = 'inbound', maxBytes = WEIXIN_MEDIA_MAX_BYTES,
    originalFilename }: SaveMediaRequest): Promise<{ path: string }> {
    if (buffer.length > maxBytes) {
      throw new Error(`media exceeds max size ${maxBytes}`);
    }
    const dir = this.#state.mediaDirectory(subdir);
    fs.mkdirSync(dir, { recursive: true });
    const resolvedMime = contentType ?? sniffMimeFromBuffer(buffer);
    const ext = originalFilename
      ? path.extname(originalFilename)
      : resolvedMime
        ? getExtensionFromMime(resolvedMime)
        : '.bin';
    const base = originalFilename
      ? path.basename(originalFilename, ext)
      : 'media';
    const fileName = `${base}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, buffer);
    return { path: filePath };
  }

  /** 入站媒体 TTL 清扫：start 时立即扫一次，之后每小时扫一次。 */
  #startMediaSweep(): void {
    this.#stopMediaSweep();
    const sweep = () => this.#sweepInboundMedia();
    sweep();
    this.#mediaSweepTimer = setInterval(sweep, MEDIA_SWEEP_INTERVAL_MS);
    (this.#mediaSweepTimer as { unref?: () => void }).unref?.();
  }

  #stopMediaSweep(): void {
    if (this.#mediaSweepTimer) {
      clearInterval(this.#mediaSweepTimer);
      this.#mediaSweepTimer = undefined;
    }
  }

  #sweepInboundMedia(): void {
    const dir = this.#state.mediaDirectory('inbound');
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(dir, entry.name);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs <= INBOUND_MEDIA_TTL_MS) continue;
        fs.unlinkSync(filePath);
        this.#logger.debug(formatCompact({
          op: 'media_sweep',
          endpoint: this.#options.config.id,
          file: entry.name,
        }));
      } catch {
        /* 单个文件失败不阻塞整体清扫 */
      }
    }
  }
}

function createWeixinIlinkEndpointManagement(
  requireClient: () => WeixinIlinkClient,
): EndpointManagement {
  return Object.freeze<EndpointManagement>({
    // 个人微信无群概念（listGroups/listGroupMembers 不接），也没有通讯录/资料接口。
    // "好友"只能从会话推导：凡持有 context_token 的对端（来过消息，含重启后从磁盘恢复的）
    // 即为可达私聊对端；昵称不可得，用 user_id 占位并在 remark 注明来源。
    async listFriends(request: EndpointManagementRequest = {}): Promise<readonly EndpointFriend[]> {
      return createEndpointOperation(request).run(() => requireClient().reachableUserIds().map((userId) => ({
        user_id: userId,
        nickname: userId,
        remark: 'ilink: 从会话 context_token 推导，非通讯录',
      })));
    },
  });
}

export type WeixinIlinkClientEventMap = Record<string, unknown>;
