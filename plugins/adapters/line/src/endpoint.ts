/**
 * LINE Endpoint 实现
 *
 * 使用 Webhook 模式接收消息，通过 LINE Messaging API 发送消息。
 * HMAC-SHA256 签名验证确保请求来自 LINE 平台。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  Endpoint,
  Message,
  SendOptions,
  SendContent,
  MessageSegment,
  segment,
  formatCompact,
  expandInteractiveSegmentsInContent,
  type QuotedMessagePayload,} from 'zhin.js';
import { registerFetchRoute, type Router, type RouterContext } from "@zhin.js/host-router/router";
import type {
  LineEndpointConfig,
  LineEvent,
  LineMessageEvent,
  LineFollowEvent,
  LineJoinEvent,
  LinePostbackEvent,
  LineMessage,
  LineWebhookBody,
  LineReplyMessage,
  LinePushRequest,
  LineReplyRequest,
  LineApiResponse,
} from "./types.js";
import type { LineAdapter } from "./adapter.js";
import { fromCanonicalSegments, toCanonicalSegments } from './segment-mapper.js';

/** Type guard: narrows a LineEvent to a message event */
function isMessageEvent(e: LineEvent): e is LineMessageEvent {
  return e.type === "message" && "message" in e && (e as LineMessageEvent).message != null;
}

/** Type guard: narrows a LineEvent to a postback event */
function isPostbackEvent(e: LineEvent): e is LinePostbackEvent {
  return e.type === "postback" && "postback" in e;
}

export class LineEndpoint implements Endpoint<LineEndpointConfig, LineEvent> {
  $connected: boolean = false;

  get pluginLogger() {
    return this.adapter.plugin.logger;
  }

  get $id() {
    return this.$config.name;
  }

  constructor(
    public adapter: LineAdapter,
    private router: Router,
    public $config: LineEndpointConfig,
  ) {}

  async $connect(): Promise<void> {
    try {
      const path = this.$config.webhookPath || "/line/webhook";
      const cleanPath = path.startsWith("/") ? path : `/${path}`;
      registerFetchRoute(this.router, "POST", cleanPath, async (ctx: RouterContext) => {
        await this.handleWebhook(ctx);
      });
      this.$connected = true;
      this.pluginLogger.info(formatCompact({ op: "webhook", path: cleanPath }));
    } catch (error) {
      this.pluginLogger.error("Failed to connect LINE endpoint:", error);
      this.$connected = false;
      throw error;
    }
  }

  async $disconnect(): Promise<void> {
    try {
      this.$connected = false;
      this.replyTokenCache.clear();
      this.pluginLogger.info(`LINE endpoint ${this.$config.name} disconnected`);
    } catch (error) {
      this.pluginLogger.error("Error disconnecting LINE endpoint:", error);
      // L02: Log and swallow instead of re-throwing
    }
  }

  // ── Webhook 处理 ────────────────────────────────────────────────────

  private async handleWebhook(ctx: RouterContext): Promise<void> {
    try {
      // 1. 签名验证
      const signature = ctx.get("x-line-signature");
      if (!signature) {
        ctx.status = 403;
        ctx.body = { message: "Missing signature" };
        return;
      }

      // L05: 获取原始请求体用于签名验证
      // Koa ctx.req 是 Node.js IncomingMessage，koa-body 可能已经消费了流
      // 因此优先使用已解析的 body 并序列化，记录警告说明可能不精确
      let rawBody: string;
      if (typeof ctx.request.body === "string") {
        rawBody = ctx.request.body;
      } else {
        rawBody = JSON.stringify(ctx.request.body);
        this.pluginLogger.debug("Signature verification using JSON.stringify(body) — may differ from original raw body");
      }

      if (!this.verifySignature(rawBody, signature)) {
        this.pluginLogger.warn(formatCompact({ op: "webhook", ok: false, error: "invalid signature" }));
        ctx.status = 403;
        ctx.body = { message: "Invalid signature" };
        return;
      }

      // 2. 解析事件
      const body: LineWebhookBody = typeof ctx.request.body === "string"
        ? JSON.parse(ctx.request.body)
        : ctx.request.body;

      if (!body.events || !Array.isArray(body.events)) {
        ctx.status = 200;
        ctx.body = { message: "OK" };
        return;
      }

      // 3. 处理每个事件
      for (const event of body.events) {
        await this.handleEvent(event);
      }

      ctx.status = 200;
      ctx.body = { message: "OK" };
    } catch (error) {
      this.pluginLogger.error("LINE webhook error:", error);
      ctx.status = 200;
      ctx.body = { message: "OK" };
    }
  }

  // L07: Use timing-safe comparison for signature
  private verifySignature(body: string, signature: string): boolean {
    const channelSecret = this.$config.channelSecret;
    const hmac = createHmac("sha256", channelSecret);
    hmac.update(body, "utf-8");
    const computedSignature = hmac.digest("base64");
    const sigBuf = Buffer.from(signature);
    const computedBuf = Buffer.from(computedSignature);
    if (sigBuf.length !== computedBuf.length) return false;
    return timingSafeEqual(sigBuf, computedBuf);
  }

  // L04: Use type guards instead of "in" checks + `as any` casts
  private async handleEvent(event: LineEvent): Promise<void> {
    switch (event.type) {
      case "message":
        if (isMessageEvent(event)) {
          await this.handleMessageEvent(event);
        }
        break;
      case "follow":
        await this.handleFollowEvent(event as LineFollowEvent);
        break;
      case "unfollow":
        this.pluginLogger.debug(formatCompact({
          op: "unfollow",
          endpoint: this.$config.name,
          userId: event.source.userId,
        }));
        break;
      case "join":
        await this.handleJoinEvent(event as LineJoinEvent);
        break;
      case "leave":
        this.pluginLogger.debug(formatCompact({
          op: "leave",
          endpoint: this.$config.name,
          sourceType: event.source.type,
          groupId: event.source.groupId,
          roomId: event.source.roomId,
        }));
        break;
      case "postback":
        if (isPostbackEvent(event)) {
          this.pluginLogger.debug(formatCompact({
            op: "postback",
            endpoint: this.$config.name,
            data: event.postback.data,
          }));
        }
        break;
      default:
        this.pluginLogger.debug(formatCompact({
          op: "unknown_event",
          endpoint: this.$config.name,
          type: (event as LineEvent).type,
        }));
    }
  }

  // L01: Cache replyToken from webhook events before emitting
  private async handleMessageEvent(event: LineMessageEvent): Promise<void> {
    const { channelId } = this.resolveChannel(event.source);
    this.cacheReplyToken(channelId, event.replyToken);

    const message = this.$formatMessage(event);
    this.adapter.emit("message.receive", message);
    this.pluginLogger.debug(formatCompact({
      op: "recv",
      endpoint: this.$config.name,
      channel: message.$channel.type,
      id: message.$channel.id,
      len: segment.raw(message.$content).length,
    }));
  }

  private async handleFollowEvent(event: LineFollowEvent): Promise<void> {
    const { channelId } = this.resolveChannel(event.source);
    this.cacheReplyToken(channelId, event.replyToken);

    const message = this.$formatMessage(event);
    this.adapter.emit("message.receive", message);
    this.pluginLogger.debug(formatCompact({
      op: "follow",
      endpoint: this.$config.name,
      userId: event.source.userId,
    }));
  }

  private async handleJoinEvent(event: LineJoinEvent): Promise<void> {
    const { channelId } = this.resolveChannel(event.source);
    this.cacheReplyToken(channelId, event.replyToken);

    const message = this.$formatMessage(event);
    this.adapter.emit("message.receive", message);
    this.pluginLogger.debug(formatCompact({
      op: "join",
      endpoint: this.$config.name,
      sourceType: event.source.type,
      groupId: event.source.groupId,
      roomId: event.source.roomId,
    }));
  }

  // ── 消息格式化 ────────────────────────────────────────────────────

  $formatMessage(event: LineEvent): Message<LineEvent> {
    const { channelType, channelId } = this.resolveChannel(event.source);
    const wire = this.parseMessageContent(event);
    const quoteId = Message.quoteIdFromContent(wire);
    Message.alignReplySegments(wire, quoteId);
    const content = toCanonicalSegments(wire);

    const userId = event.source.userId || "";
    const timestamp = event.timestamp || Date.now();
    const rawText = this.extractRawText(event);

    return Message.from(event, {
      $id: this.generateMessageId(event),
      $adapter: "line",
      $endpoint: this.$config.name,
      $sender: {
        id: userId,
        name: userId,
      },
      $channel: {
        id: channelId,
        type: channelType,
      },
      $content: content,
      $quote_id: quoteId,
      $raw: rawText,
      $timestamp: timestamp,
      $recall: async () => {
        // LINE 不支持消息撤回
        this.pluginLogger.warn("LINE does not support message recall");
      },
      $reply: async (
        content: SendContent,
        quote?: boolean | string
      ): Promise<string> => {
        if (!Array.isArray(content)) content = [content];
        if (quote) {
          const replyToMessageId = typeof quote === "boolean"
            ? (isMessageEvent(event) && event.message?.id) || ""
            : quote;
          content.unshift({ type: "reply", data: { id: replyToMessageId } });
        }
        return await this.adapter.sendMessage({
          context: "line",
          endpoint: this.$config.name,
          id: channelId,
          type: channelType,
          content: content,
        });
      },
    });
  }

  private generateMessageId(event: LineEvent): string {
    if (isMessageEvent(event) && event.message?.id) {
      return event.message.id;
    }
    return `${event.type}-${event.timestamp}`;
  }

  private resolveChannel(source: LineEvent["source"]): { channelType: "private" | "group" | "channel"; channelId: string } {
    switch (source.type) {
      case "user":
        return { channelType: "private", channelId: source.userId || "" };
      case "group":
        return { channelType: "group", channelId: source.groupId || "" };
      case "room":
        return { channelType: "channel", channelId: source.roomId || "" };
      default:
        return { channelType: "private", channelId: "" };
    }
  }

  private extractRawText(event: LineEvent): string {
    if (isMessageEvent(event)) {
      const msg = event.message;
      if (msg.type === "text" && msg.text) return msg.text;
      if (msg.type === "location" && msg.address) return msg.address;
      return `[${msg.type}]`;
    }
    if (event.type === "follow") return "[follow]";
    if (event.type === "join") return "[join]";
    return "";
  }

  private parseMessageContent(event: LineEvent): MessageSegment[] {
    const segments: MessageSegment[] = [];

    if (isMessageEvent(event)) {
      const msg = event.message;
      switch (msg.type) {
        case "text":
          if (msg.text) {
            segments.push({ type: "text", data: { text: msg.text } });
          }
          break;
        case "image":
          segments.push({
            type: "image",
            data: {
              message_id: msg.id,
              platform: "line",
            },
          });
          break;
        case "video":
          segments.push({
            type: "video",
            data: {
              message_id: msg.id,
              platform: "line",
            },
          });
          break;
        case "audio":
          segments.push({
            type: "audio",
            data: {
              message_id: msg.id,
              duration: msg.duration || 0,
              platform: "line",
            },
          });
          break;
        case "file":
          segments.push({
            type: "file",
            data: {
              message_id: msg.id,
              file_name: msg.fileName,
              file_size: msg.fileSize,
              platform: "line",
            },
          });
          break;
        case "location":
          segments.push({
            type: "location",
            data: {
              title: msg.title,
              address: msg.address,
              latitude: msg.latitude,
              longitude: msg.longitude,
            },
          });
          break;
        case "sticker":
          segments.push({
            type: "sticker",
            data: {
              package_id: msg.packageId,
              sticker_id: msg.stickerId,
              resource_type: msg.stickerResourceType,
            },
          });
          break;
        default:
          segments.push({ type: "text", data: { text: `[unsupported message type]` } });
      }
    } else {
      // 系统事件（follow/unfollow/join/leave）
      const text = event.type === "follow" ? "[follow event]"
        : event.type === "join" ? "[join event]"
        : event.type === "unfollow" ? "[unfollow event]"
        : event.type === "leave" ? "[leave event]"
        : `[${event.type} event]`;
      segments.push({ type: "text", data: { text } });
    }

    return segments.length > 0 ? segments : [{ type: "text", data: { text: "" } }];
  }

  // ── 发送消息 ──────────────────────────────────────────────────────

  async $sendMessage(options: SendOptions): Promise<string> {
    try {
      const canonical = expandInteractiveSegmentsInContent(options.content);
      const wire = fromCanonicalSegments(canonical);
      const messages = this.buildLineMessages(wire);
      if (messages.length === 0) {
        throw new Error("No valid LINE messages to send");
      }

      // 优先使用 Reply API（如果存在 replyToken）
      const replyToken = this.replyTokenCache.get(options.id);
      if (replyToken) {
        this.replyTokenCache.delete(options.id);
        return await this.replyMessage(replyToken, messages);
      }

      // L06: Validate Push API `to` field
      if (!/^[UGR]/.test(options.id)) {
        throw new Error(
          `Invalid LINE recipient ID "${options.id}": must start with U (user), G (group), or R (room)`
        );
      }

      // 使用 Push API
      return await this.pushMessage(options.id, messages);
    } catch (error) {
      this.pluginLogger.error("Failed to send LINE message:", error);
      throw error;
    }
  }

  private replyTokenCache = new Map<string, string>();

  /**
   * 缓存 replyToken，用于后续发送回复消息
   */
  cacheReplyToken(channelId: string, replyToken: string): void {
    this.replyTokenCache.set(channelId, replyToken);
  }

  // L15: Parse Reply API response for message ID
  private async replyMessage(replyToken: string, messages: LineReplyMessage[]): Promise<string> {
    const baseUrl = this.$config.apiBaseUrl || "https://api.line.me";
    const request: LineReplyRequest = { replyToken, messages };
    const response = await fetch(`${baseUrl}/v2/bot/message/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.$config.channelAccessToken}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LINE Reply API error ${response.status}: ${errorText}`);
    }

    // Reply API now returns sentMessages in the response body
    const result: LineApiResponse = await response.json() as LineApiResponse;
    return result.sentMessages?.[0]?.id || `reply-${Date.now()}`;
  }

  private async pushMessage(to: string, messages: LineReplyMessage[]): Promise<string> {
    const baseUrl = this.$config.apiBaseUrl || "https://api.line.me";
    const request: LinePushRequest = { to, messages };
    const response = await fetch(`${baseUrl}/v2/bot/message/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.$config.channelAccessToken}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LINE Push API error ${response.status}: ${errorText}`);
    }

    const result: LineApiResponse = await response.json() as LineApiResponse;
    return result.sentMessages?.[0]?.id || `push-${Date.now()}`;
  }

  private buildLineMessages(content: SendContent): LineReplyMessage[] {
    if (!Array.isArray(content)) content = [content];
    const messages: LineReplyMessage[] = [];

    for (const item of content) {
      if (typeof item === "string") {
        messages.push(this.buildTextMessage(item));
        continue;
      }

      const seg = item as MessageSegment;
      switch (seg.type) {
        case "text":
          messages.push(this.buildTextMessage(seg.data.text || ""));
          break;
        case "at":
          // LINE 没有 @ 语法，转为文本
          if (seg.data.id) {
            messages.push(this.buildTextMessage(`@${seg.data.name || seg.data.id}`));
          }
          break;
        case "image":
          if (seg.data.url) {
            messages.push({
              type: "image",
              originalContentUrl: seg.data.url,
              previewImageUrl: seg.data.url,
            });
          }
          break;
        case "video":
          if (seg.data.url) {
            messages.push({
              type: "video",
              originalContentUrl: seg.data.url,
              previewImageUrl: seg.data.previewUrl || seg.data.url,
            });
          }
          break;
        case "audio":
          if (seg.data.url) {
            messages.push({
              type: "audio",
              originalContentUrl: seg.data.url,
              duration: seg.data.duration || 0,
            });
          }
          break;
        case "location":
          messages.push({
            type: "location",
            title: seg.data.title || "Location",
            address: seg.data.address || "",
            latitude: seg.data.latitude || 0,
            longitude: seg.data.longitude || 0,
          });
          break;
        case "sticker":
          messages.push({
            type: "sticker",
            packageId: seg.data.package_id || "1",
            stickerId: seg.data.sticker_id || "1",
          });
          break;
        default:
          messages.push(this.buildTextMessage(`[${seg.type}]`));
      }
    }

    // L14: Log warning when messages are sliced to 5 (LINE limit)
    if (messages.length > 5) {
      this.pluginLogger.warn(
        `LINE messages truncated from ${messages.length} to 5 (platform limit)`
      );
    }

    // LINE 单次最多发送 5 条消息
    return messages.slice(0, 5);
  }

  private buildTextMessage(text: string): LineReplyMessage {
    // L13: Log warning on text truncation
    if (text.length > 5000) {
      this.pluginLogger.warn(
        `LINE text message truncated from ${text.length} to 5000 characters`
      );
    }
    // LINE 消息文本限制 5000 字符
    const truncated = text.length > 5000 ? text.slice(0, 4997) + "..." : text;
    return { type: "text", text: truncated };
  }

  // ── 消息撤回 ──────────────────────────────────────────────────────

  // L16: Log warning and return gracefully (matching WeCom/DingTalk pattern)
  async $recallMessage(_id: string): Promise<void> {
    this.pluginLogger.warn(
      formatCompact({ op: "recall", ok: false, error: "LINE Messaging API does not support message recall" })
    );
  }
}
