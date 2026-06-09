/**
 * 微信 iLink Bot：长轮询入站 + CDN 媒体收发
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  Bot,
  Message,
  type MessageSegment,
  type SendContent,
  type SendOptions,
  segment,
} from "zhin.js";
import { getUpdates, notifyStart, notifyStop, sendTyping } from "./ilink-api.js";
import {
  configureIlinkMeta,
  DEFAULT_API_BASE_URL,
  DEFAULT_CDN_BASE_URL,
} from "./ilink-meta.js";
import {
  loadSyncBuf,
  resolveStateDir,
  saveSyncBuf,
  type WeixinIlinkCredentials,
} from "./credentials.js";
import { resolveCredentials } from "./login.js";
import {
  bodyFromItemList,
  getContextToken,
  isMediaItem,
  restoreContextTokens,
  setContextToken,
} from "./context-store.js";
import { WeixinConfigManager } from "./ilink-config-cache.js";
import {
  getRemainingPauseMs,
  isSessionPaused,
  pauseSession,
  SESSION_EXPIRED_ERRCODE,
} from "./ilink-session-guard.js";
import { downloadMediaFromItem } from "./media-download.js";
import { sendMessageWeixin } from "./weixin-send.js";
import { sendWeixinMediaFile } from "./weixin-send-media.js";
import { materializeOutboundMedia, segmentMediaRef } from "./outbound-media.js";
import type { MessageItem, WeixinMessage } from "./ilink-types.js";
import { MessageItemType } from "./ilink-types.js";
import { getExtensionFromMime, sniffMimeFromBuffer } from "./mime.js";
import type { WeixinInboundMediaOpts } from "./weixin-inbound.js";
import type { WeixinIlinkBotConfig } from "./types.js";
import type { WeixinIlinkAdapter } from "./adapter.js";
import {
  WeixinIlinkTypingIndicatorManager,
  type WeixinIlinkTypingIndicatorConfig,
} from "./typing-indicator.js";

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 2_000;
const WEIXIN_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

export type WeixinMessageWithMedia = WeixinMessage & {
  _media?: WeixinInboundMediaOpts;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function segmentLocalPath(seg: MessageSegment): string | undefined {
  const ref = segmentMediaRef(seg);
  if (!ref || ref.startsWith("base64://") || /^data:/.test(ref) || /^https?:\/\//i.test(ref)) {
    return undefined;
  }
  return ref.replace(/^file:\/\//, "");
}

export class WeixinIlinkBot implements Bot<WeixinIlinkBotConfig, WeixinMessage> {
  $connected = false;
  $typingIndicator?: WeixinIlinkTypingIndicatorManager;

  private creds: WeixinIlinkCredentials | null = null;
  private pollAbort?: AbortController;
  private pollPromise?: Promise<void>;
  private configManager?: WeixinConfigManager;

  get $id(): string {
    return this.$config.name;
  }

  get hasCredentials(): boolean {
    return Boolean(this.creds?.botToken);
  }

  get pluginLogger() {
    return this.adapter.plugin.logger;
  }

  constructor(
    public adapter: WeixinIlinkAdapter,
    public $config: WeixinIlinkBotConfig,
  ) {}

  apiBaseUrl(): string {
    return this.$config.baseUrl ?? this.creds?.baseUrl ?? DEFAULT_API_BASE_URL;
  }

  cdnBaseUrl(): string {
    return this.$config.cdnBaseUrl ?? DEFAULT_CDN_BASE_URL;
  }

  async $connect(): Promise<void> {
    configureIlinkMeta({ botAgent: this.$config.botAgent });
    this.creds = await resolveCredentials(this.adapter.plugin, this.$config);
    restoreContextTokens(this.$id);

    await notifyStart({
      baseUrl: this.apiBaseUrl(),
      token: this.creds.botToken,
    });

    this.configManager = new WeixinConfigManager(
      { baseUrl: this.apiBaseUrl(), token: this.creds.botToken },
      (msg) => this.pluginLogger.debug(msg),
    );

    if (this.$config.typingIndicator?.enabled !== false) {
      this.$typingIndicator = new WeixinIlinkTypingIndicatorManager(
        this,
        this.$config.typingIndicator as WeixinIlinkTypingIndicatorConfig | undefined,
      );
    }

    this.pollAbort = new AbortController();
    this.pollPromise = this.pollLoop(this.pollAbort.signal);
    this.$connected = true;
    this.pluginLogger.info(`weixin-ilink bot ${this.$id} connected`);
  }

  async $disconnect(): Promise<void> {
    this.pollAbort?.abort();
    try {
      await this.pollPromise;
    } catch {
      /* poll loop exit */
    }
    if (this.creds?.botToken) {
      try {
        await notifyStop({ baseUrl: this.apiBaseUrl(), token: this.creds.botToken });
      } catch (err) {
        this.pluginLogger.warn(`notifyStop failed: ${String(err)}`);
      }
    }
    this.$connected = false;
    this.pluginLogger.info(`weixin-ilink bot ${this.$id} disconnected`);
  }

  async sendTypingToUser(userId: string, status: number): Promise<void> {
    if (!this.creds?.botToken || !this.configManager) return;
    const contextToken = getContextToken(this.$id, userId);
    const cfg = await this.configManager.getForUser(userId, contextToken);
    if (!cfg.typingTicket) {
      this.pluginLogger.debug(`sendTyping: no typing_ticket for user=${userId}`);
      return;
    }
    await sendTyping({
      baseUrl: this.apiBaseUrl(),
      token: this.creds.botToken,
      body: {
        ilink_user_id: userId,
        typing_ticket: cfg.typingTicket,
        status,
      },
    });
  }

  async $recallMessage(_id: string): Promise<void> {
    this.pluginLogger.debug("weixin-ilink does not support message recall");
  }

  $formatMessage(msg: WeixinMessageWithMedia): Message<WeixinMessage> {
    const userId = msg.from_user_id ?? "";
    const content = this.buildInboundContent(msg);
    const quoteId = Message.quoteIdFromContent(content);
    Message.alignReplySegments(content, quoteId);
    const msgId = String(msg.message_id ?? msg.client_id ?? msg.seq ?? Date.now());

    return Message.from(msg, {
      $id: msgId,
      $adapter: "weixin-ilink",
      $bot: this.$config.name,
      $sender: {
        id: userId,
        name: userId,
      },
      $channel: {
        id: userId,
        type: "private",
      },
      $content: content,
      $quote_id: quoteId,
      $raw: bodyFromItemList(msg.item_list),
      $timestamp: msg.create_time_ms ?? Date.now(),
      $recall: async () => this.$recallMessage(msgId),
      $reply: async (replyContent: SendContent, _quote?: boolean | string) => {
        if (!Array.isArray(replyContent)) replyContent = [replyContent];
        return this.adapter.sendMessage({
          context: "weixin-ilink",
          bot: this.$config.name,
          id: userId,
          type: "private",
          content: replyContent,
        });
      },
    });
  }

  private buildInboundContent(msg: WeixinMessageWithMedia): MessageSegment[] {
    const segments: MessageSegment[] = [];
    const text = bodyFromItemList(msg.item_list);
    if (text) segments.push(segment.text(text));

    const media = msg._media;
    if (media?.decryptedPicPath) {
      segments.push(segment("image", { file: media.decryptedPicPath }));
    } else if (media?.decryptedVideoPath) {
      segments.push(segment("video", { file: media.decryptedVideoPath }));
    } else if (media?.decryptedFilePath) {
      segments.push(segment("file", {
        file: media.decryptedFilePath,
        name: path.basename(media.decryptedFilePath),
      }));
    } else if (media?.decryptedVoicePath) {
      segments.push(segment("record", { file: media.decryptedVoicePath }));
    } else if (!text && msg.item_list?.some((i) => isMediaItem(i))) {
      segments.push(segment.text("[媒体消息]"));
    }

    return segments.length ? segments : [segment.text("")];
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    if (!this.creds?.botToken) {
      throw new Error("weixin-ilink bot not authenticated");
    }
    const peerId = options.id;
    const contextToken = getContextToken(this.$id, peerId);
    if (!contextToken) {
      this.pluginLogger.warn(`missing context_token for peer ${peerId}, refusing send`);
      throw new Error(`missing context_token for peer ${peerId}`);
    }

    const apiOpts = {
      baseUrl: this.apiBaseUrl(),
      token: this.creds.botToken,
      contextToken,
    };

    const outboundDir = path.join(resolveStateDir(), "media", "outbound");
    const materialized = await materializeOutboundMedia(options.content, outboundDir);
    const segments = Array.isArray(materialized) ? materialized : [materialized];
    let lastId = "";
    let pendingText = "";

    for (const raw of segments) {
      if (typeof raw === "string") {
        pendingText += raw;
        continue;
      }
      if (typeof raw !== "object" || raw === null || !("type" in raw)) {
        continue;
      }
      const seg = raw as MessageSegment;
      if (seg.type === "text" || seg.type === "markdown") {
        const t = (seg.data as { text?: string }).text ?? "";
        pendingText += t;
        continue;
      }

      const filePath = segmentLocalPath(seg);
      if (filePath && fs.existsSync(filePath)) {
        // 微信限制：单条消息不能图文混排 → 先单独发文本，再发纯媒体（不带 caption）
        if (pendingText.trim()) {
          const textResult = await sendMessageWeixin({
            to: peerId,
            text: pendingText,
            opts: apiOpts,
          });
          pendingText = "";
          lastId = textResult.messageId;
        }
        const result = await sendWeixinMediaFile({
          filePath,
          to: peerId,
          text: "",
          opts: apiOpts,
          cdnBaseUrl: this.cdnBaseUrl(),
        });
        lastId = result.messageId;
        continue;
      }

      if (seg.type === "image" || seg.type === "video" || seg.type === "file" || seg.type === "record") {
        this.pluginLogger.warn(`skip outbound ${seg.type}: no local file path`);
      }
    }

    if (pendingText.trim()) {
      const result = await sendMessageWeixin({
        to: peerId,
        text: pendingText,
        opts: apiOpts,
      });
      lastId = result.messageId;
    }

    return lastId || `weixin-ilink-${Date.now()}`;
  }

  private async pollLoop(abortSignal: AbortSignal): Promise<void> {
    if (!this.creds?.botToken) return;

    let getUpdatesBuf = loadSyncBuf(this.$id);
    let nextTimeoutMs = this.$config.longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
    let consecutiveFailures = 0;

    while (!abortSignal.aborted) {
      if (isSessionPaused(this.$id)) {
        await sleep(getRemainingPauseMs(this.$id), abortSignal);
        continue;
      }

      try {
        const resp = await getUpdates({
          baseUrl: this.apiBaseUrl(),
          token: this.creds.botToken,
          get_updates_buf: getUpdatesBuf,
          timeoutMs: nextTimeoutMs,
          abortSignal,
        });

        if (resp.longpolling_timeout_ms != null && resp.longpolling_timeout_ms > 0) {
          nextTimeoutMs = resp.longpolling_timeout_ms;
        }

        const isApiError =
          (resp.ret !== undefined && resp.ret !== 0) ||
          (resp.errcode !== undefined && resp.errcode !== 0);

        if (isApiError) {
          const sessionExpired =
            resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE;
          if (sessionExpired) {
            pauseSession(this.$id);
            consecutiveFailures = 0;
            await sleep(getRemainingPauseMs(this.$id), abortSignal);
            continue;
          }
          consecutiveFailures += 1;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            consecutiveFailures = 0;
            await sleep(BACKOFF_DELAY_MS, abortSignal);
          } else {
            await sleep(RETRY_DELAY_MS, abortSignal);
          }
          continue;
        }

        consecutiveFailures = 0;
        if (resp.get_updates_buf) {
          getUpdatesBuf = resp.get_updates_buf;
          saveSyncBuf(this.$id, getUpdatesBuf);
        }

        for (const inbound of resp.msgs ?? []) {
          await this.handleInboundMessage(inbound);
        }
      } catch (err) {
        if (abortSignal.aborted) return;
        consecutiveFailures += 1;
        this.pluginLogger.error(`weixin-ilink poll error: ${String(err)}`);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = 0;
          await sleep(BACKOFF_DELAY_MS, abortSignal);
        } else {
          await sleep(RETRY_DELAY_MS, abortSignal);
        }
      }
    }
  }

  private async handleInboundMessage(full: WeixinMessage): Promise<void> {
    const fromUserId = full.from_user_id ?? "";
    if (full.context_token && fromUserId) {
      setContextToken(this.$id, fromUserId, full.context_token);
    }

    const mediaOpts = await this.downloadInboundMedia(full);
    // 入站保持单条 message.receive（文字+媒体同条），供 AI context / im_transcripts / agent_messages 组装。
    // 出站才按微信限制拆分图文（见 sendMessage）。
    const message = this.$formatMessage({ ...full, _media: mediaOpts });
    this.adapter.emit("message.receive", message);
    this.pluginLogger.debug(
      `${this.$id} recv private(${message.$channel.id}): ${segment.raw(message.$content)}`,
    );
  }

  private async downloadInboundMedia(full: WeixinMessage): Promise<WeixinInboundMediaOpts> {
    const hasDownloadableMedia = (m?: { encrypt_query_param?: string; full_url?: string }) =>
      Boolean(m?.encrypt_query_param || m?.full_url);

    const mediaItem =
      full.item_list?.find(
        (i) => i.type === MessageItemType.IMAGE && hasDownloadableMedia(i.image_item?.media),
      ) ??
      full.item_list?.find(
        (i) => i.type === MessageItemType.VIDEO && hasDownloadableMedia(i.video_item?.media),
      ) ??
      full.item_list?.find(
        (i) => i.type === MessageItemType.FILE && hasDownloadableMedia(i.file_item?.media),
      ) ??
      full.item_list?.find(
        (i) => i.type === MessageItemType.VOICE && hasDownloadableMedia(i.voice_item?.media),
      );

    if (!mediaItem) return {};

    return downloadMediaFromItem(mediaItem, {
      cdnBaseUrl: this.cdnBaseUrl(),
      saveMedia: (buffer, contentType, subdir, maxBytes, originalFilename) =>
        this.saveInboundMedia(buffer, contentType, subdir, maxBytes, originalFilename),
      log: (msg) => this.pluginLogger.debug(msg),
      errLog: (msg) => this.pluginLogger.warn(msg),
      label: `inbound:${fromUserIdLabel(full)}`,
    });
  }

  private async saveInboundMedia(
    buffer: Buffer,
    contentType?: string,
    subdir = "inbound",
    maxBytes = WEIXIN_MEDIA_MAX_BYTES,
    originalFilename?: string,
  ): Promise<{ path: string }> {
    if (buffer.length > maxBytes) {
      throw new Error(`media exceeds max size ${maxBytes}`);
    }
    const dir = path.join(resolveStateDir(), "media", subdir);
    fs.mkdirSync(dir, { recursive: true });
    const resolvedMime = contentType ?? sniffMimeFromBuffer(buffer);
    const ext = originalFilename
      ? path.extname(originalFilename)
      : resolvedMime
        ? getExtensionFromMime(resolvedMime)
        : ".bin";
    const base = originalFilename
      ? path.basename(originalFilename, ext)
      : "media";
    const fileName = `${base}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, buffer);
    return { path: filePath };
  }
}

function fromUserIdLabel(msg: WeixinMessage): string {
  return msg.from_user_id ?? "unknown";
}
