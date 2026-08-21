/**
 * WeixinIlinkEndpoint — lifecycle, long-poll inbound, outbound send.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  EndpointFriend,
  EndpointInstance,
  EndpointManagement,
  EndpointSendRequest,
} from 'zhin.js/adapter';
import type { MessageGateway, SideEventGateway } from '@zhin.js/core/runtime';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import { getUpdates, notifyStart, notifyStop, sendTyping } from './ilink-api.js';
import { configureIlinkMeta } from './ilink-meta.js';
import {
  loadSyncBuf,
  resolveStateDir,
  saveSyncBuf,
  type WeixinIlinkCredentials,
} from './credentials.js';
import { resolveCredentials } from './login.js';
import {
  getContextToken,
  listContextTokenUserIds,
  restoreContextTokens,
  setContextToken,
  flushContextTokenPersist,
} from './context-store.js';
import { WeixinConfigManager } from './ilink-config-cache.js';
import {
  getRemainingPauseMs,
  isSessionPaused,
  pauseSession,
  SESSION_EXPIRED_ERRCODE,
} from './ilink-session-guard.js';
import { downloadMediaFromItem } from './media-download.js';
import { sendMessageWeixin } from './weixin-send.js';
import { sendWeixinMediaFile } from './weixin-send-media.js';
import { materializeOutboundMedia } from './outbound-media.js';
import { MessageItemType, type WeixinMessage } from './ilink-types.js';
import { getExtensionFromMime, sniffMimeFromBuffer } from './mime.js';
import type { WeixinInboundMediaOpts } from './weixin-inbound.js';
import {
  formatInboundContent,
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
  readonly gateway: MessageGateway;
  readonly sideEvents?: SideEventGateway;
  readonly config: ResolvedWeixinIlinkConfig;
  readonly resolveCredentials?: (
    config: ResolvedWeixinIlinkConfig,
    signal?: AbortSignal,
  ) => Promise<WeixinIlinkCredentials>;
  /** Test / internal: override network side effects. */
  readonly notifyStart?: WeixinIlinkNotifyStart;
  readonly notifyStop?: WeixinIlinkNotifyStop;
  readonly getUpdates?: WeixinIlinkGetUpdates;
  readonly sendText?: WeixinIlinkSendText;
}

export class WeixinIlinkEndpoint implements EndpointInstance {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: WeixinIlinkEndpointOptions;
  readonly #resolveCredentials: (
    config: ResolvedWeixinIlinkConfig,
    signal?: AbortSignal,
  ) => Promise<WeixinIlinkCredentials>;
  readonly #notifyStart: WeixinIlinkNotifyStart;
  readonly #notifyStop: WeixinIlinkNotifyStop;
  readonly #getUpdates: WeixinIlinkGetUpdates;
  readonly #sendText: WeixinIlinkSendText;
  #creds: WeixinIlinkCredentials | null = null;
  #pollAbort?: AbortController;
  #pollPromise?: Promise<void>;
  #loginAbort?: AbortController;
  #configManager?: WeixinConfigManager;
  #mediaSweepTimer?: ReturnType<typeof setInterval>;
  #open = false;
  #started = false;
  readonly management: EndpointManagement = createWeixinIlinkEndpointManagement(this);

  constructor(options: WeixinIlinkEndpointOptions) {
    this.#logger = getAdapterLogger('weixin-ilink', options.config.id);
    this.#options = options;
    this.#resolveCredentials = options.resolveCredentials ?? resolveCredentials;
    this.#notifyStart = options.notifyStart ?? notifyStart;
    this.#notifyStop = options.notifyStop ?? notifyStop;
    this.#getUpdates = options.getUpdates ?? getUpdates;
    this.#sendText = options.sendText ?? sendMessageWeixin;
  }

  get hasCredentials(): boolean {
    return Boolean(this.#creds?.botToken);
  }

  /** Live endpoint 名（context token 按 account 名分桶，management 推导对端用）。 */
  get configName(): string {
    return this.#options.config.id;
  }

  apiBaseUrl(): string {
    return this.#creds?.baseUrl ?? this.#options.config.baseUrl;
  }

  cdnBaseUrl(): string {
    return this.#options.config.cdnBaseUrl;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      configureIlinkMeta({ botAgent: this.#options.config.botAgent });
      // QR 登录最长 8 分钟：stop() 必须能打断
      this.#loginAbort = new AbortController();
      this.#creds = await this.#resolveCredentials(this.#options.config, this.#loginAbort.signal);
      restoreContextTokens(this.#options.config.id);

      await this.#notifyStart({
        baseUrl: this.apiBaseUrl(),
        token: this.#creds.botToken,
      });

      this.#configManager = new WeixinConfigManager(
        { baseUrl: this.apiBaseUrl(), token: this.#creds.botToken },
        (msg) => this.#logger.debug(msg),
      );

      this.#pollAbort = new AbortController();
      this.#pollPromise = this.#pollLoop(this.#pollAbort.signal);
      this.#startMediaSweep();
      this.#logger.info(formatCompact({
        op: 'connect',
        endpoint: this.#options.config.id,
      }));
    } catch (error) {
      await this.stop();
      this.#logger.error('Failed to connect weixin-ilink bot:', error);
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
    this.#loginAbort?.abort();
    this.#pollAbort?.abort();
    try {
      await this.#pollPromise;
    } catch {
      /* poll loop exit */
    }
    this.#stopMediaSweep();
    // 防抖中的 context token 落盘，避免 stop 丢尾部写入
    flushContextTokenPersist(this.#options.config.id);
    if (this.#creds?.botToken) {
      try {
        await this.#notifyStop({ baseUrl: this.apiBaseUrl(), token: this.#creds.botToken });
      } catch (err) {
        this.#logger.warn(formatCompact({
          op: 'notify_stop',
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }
    this.#started = false;
    this.#logger.debug(formatCompact({
          op: 'disconnect',
    }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    if (!this.#creds?.botToken) {
      throw new Error('weixin-ilink bot not authenticated');
    }
    // 个人微信仅 private 会话，对端 user_id 即 conversation.id
    const target = conversation.id;
    const contextToken = getContextToken(this.#options.config.id, target);
    if (!contextToken) {
      this.#logger.warn(formatCompact({
        op: 'send',
        ok: false,
        reason: 'missing_context_token',
        target,
      }));
      throw new Error(`missing context_token for peer ${target}`);
    }

    const apiOpts = {
      baseUrl: this.apiBaseUrl(),
      token: this.#creds.botToken,
      contextToken,
    };

    const outboundDir = path.join(resolveStateDir(), 'media', 'outbound');
    const wire = formatOutboundSegments(payload);
    const materialized = await materializeOutboundMedia(wire, outboundDir);
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
          const textResult = await this.#sendText({
            to: target,
            text: pendingText,
            opts: apiOpts,
          });
          pendingText = '';
          lastId = textResult.messageId;
        }
        const result = await sendWeixinMediaFile({
          filePath,
          to: target,
          text: '',
          opts: apiOpts,
          cdnBaseUrl: this.cdnBaseUrl(),
        });
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
      const result = await this.#sendText({
        to: target,
        text: pendingText,
        opts: apiOpts,
      });
      lastId = result.messageId;
    }

    return lastId || `weixin-ilink-${Date.now()}`;
  }

  /** Test / internal: admit a parsed message when the endpoint is open. */
  admit(msg: WeixinMessageWithMedia): void {
    if (!this.#open) return;
    const userId = msg.from_user_id ?? '';
    if (msg.context_token && userId) {
      setContextToken(this.#options.config.id, userId, msg.context_token);
    }
    const conversation = weixinIlinkInboundConversation(String(this.#options.id), userId);
    void this.#options.gateway.receive({
      conversation,
      message: { conversation, id: inboundMessageId(msg) },
      content: formatInboundContent(msg),
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
    });
  }

  async sendTypingToUser(userId: string, status: number): Promise<void> {
    if (!this.#creds?.botToken || !this.#configManager) return;
    const contextToken = getContextToken(this.#options.config.id, userId);
    const cfg = await this.#configManager.getForUser(userId, contextToken);
    if (!cfg.typingTicket) {
      this.#logger.debug(formatCompact({
        op: 'send_typing',
        skip: 'no_typing_ticket',
        userId,
      }));
      return;
    }
    await sendTyping({
      baseUrl: this.apiBaseUrl(),
      token: this.#creds.botToken,
      body: {
        ilink_user_id: userId,
        typing_ticket: cfg.typingTicket,
        status,
      },
    });
  }

  async #pollLoop(abortSignal: AbortSignal): Promise<void> {
    if (!this.#creds?.botToken) return;

    const endpointId = this.#options.config.id;
    let getUpdatesBuf = loadSyncBuf(endpointId);
    let nextTimeoutMs = this.#options.config.longPollTimeoutMs;
    let consecutiveFailures = 0;

    while (!abortSignal.aborted) {
      if (isSessionPaused(endpointId)) {
        await sleep(getRemainingPauseMs(endpointId), abortSignal);
        continue;
      }

      try {
        const resp = await this.#getUpdates({
          baseUrl: this.apiBaseUrl(),
          token: this.#creds.botToken,
          get_updates_buf: getUpdatesBuf,
          timeoutMs: nextTimeoutMs,
          abortSignal,
        });

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
            pauseSession(endpointId);
            consecutiveFailures = 0;
            await sleep(getRemainingPauseMs(endpointId), abortSignal);
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
          saveSyncBuf(endpointId, getUpdatesBuf);
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
    const fromUserId = full.from_user_id ?? '';
    if (full.context_token && fromUserId) {
      setContextToken(this.#options.config.id, fromUserId, full.context_token);
    }

    const mediaOpts = await this.#downloadInboundMedia(full);
    this.admit({ ...full, _media: mediaOpts });
    this.#logger.debug(formatCompact({
      op: 'recv',
      endpoint: this.#options.config.id,
      target: fromUserId,
      preview: formatInboundContent({ ...full, _media: mediaOpts }).slice(0, 80),
    }));
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
      cdnBaseUrl: this.cdnBaseUrl(),
      saveMedia: (buffer, contentType, subdir, maxBytes, originalFilename) =>
        this.#saveInboundMedia(buffer, contentType, subdir, maxBytes, originalFilename),
      log: (msg) => this.#logger.debug(msg),
      errLog: (msg) => this.#logger.warn(msg),
      label: `inbound:${full.from_user_id ?? 'unknown'}`,
    });
  }

  async #saveInboundMedia(
    buffer: Buffer,
    contentType?: string,
    subdir = 'inbound',
    maxBytes = WEIXIN_MEDIA_MAX_BYTES,
    originalFilename?: string,
  ): Promise<{ path: string }> {
    if (buffer.length > maxBytes) {
      throw new Error(`media exceeds max size ${maxBytes}`);
    }
    const dir = path.join(resolveStateDir(), 'media', subdir);
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
    const dir = path.join(resolveStateDir(), 'media', 'inbound');
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

function createWeixinIlinkEndpointManagement(endpoint: WeixinIlinkEndpoint): EndpointManagement {
  return Object.freeze<EndpointManagement>({
    // 个人微信无群概念（listGroups/listGroupMembers 不接），也没有通讯录/资料接口。
    // "好友"只能从会话推导：凡持有 context_token 的对端（来过消息，含重启后从磁盘恢复的）
    // 即为可达私聊对端；昵称不可得，用 user_id 占位并在 remark 注明来源。
    async listFriends(): Promise<readonly EndpointFriend[]> {
      return listContextTokenUserIds(endpoint.configName).map((userId) => ({
        user_id: userId,
        nickname: userId,
        remark: 'ilink: 从会话 context_token 推导，非通讯录',
      }));
    },
  });
}
