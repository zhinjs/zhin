/**
 * ICQQ Bot：通过 @icqqjs/cli 守护进程 IPC 通信，实现 zhin Endpoint 接口
 *
 * 不再直接依赖 @icqqjs/icqq 协议库。
 * 登录由 `icqq login` 完成，本 Endpoint 只负责连接守护进程并收发消息。
 */
import { formatCompact, Endpoint, Message, segment, SendContent, SendOptions, expandInteractiveSegmentsInContent, type QuotedMessagePayload,} from 'zhin.js';
import type {
  IcqqEndpointConfig,
  IcqqSenderInfo,
  IpcFriendInfo,
  IpcGroupInfo,
  IpcMemberInfo,
} from "./types.js";
import type { IcqqAdapter } from "./adapter.js";
import { IpcClient } from "./ipc-client.js";
import { Actions, type IpcEvent } from "./protocol.js";
import type { IcqqIpcMessageEvent } from "./icqq-inbound.js";
import {
  findIcqqNestedMessageSource,
  InboundMessageDeduper,
  isIcqqMessagePostType,
  normalizeIcqqInboundMessage,
  quotedPayloadFromIcqqSource,
  resolveIcqqQuoteIdFromEvent,
  resolveQuoteIdFromIcqqSource,
  shouldSkipSelfInboundMessage,
  unwrapIcqqIpcEventPayload,
  type NormalizedIcqqInbound,
} from "./icqq-inbound.js";
import {
  buildIcqqIpcMessage as buildIcqqIpcMessageImpl,
  parseCqMessage as parseCqMessageImpl,
  toCqString as toCqStringImpl,
} from "./cq-message.js";
import {
  materializeOutboundBase64,
  resolveIcqqOutboundMediaMode,
} from "./outbound-media.js";
import {
  formatIcqqMetaLog,
  formatIcqqNotice,
  formatIcqqRequest,
  isIcqqMetaPayload,
  isIcqqNoticePayload,
  isIcqqRequestPayload,
  resolveIcqqEventPostType,
  resolveSideEventDedupeKey,
  shouldRefreshListsOnMeta,
  type IcqqIpcRawEvent,
} from "./icqq-side-events.js";
import {
  disposeIcqqLoginAssistBridge,
  handleIcqqLoginIpcEvent,
} from "./icqq-login-assist-bridge.js";
import { parseIcqqGetMsgResponse } from "./get-msg.js";
import { enrichQuotedPayloadWithForward, isForwardPlaceholderPayload } from "./forward-msg.js";
import {
  IcqqGuildCatalog,
  isIcqqGuildIpcEvent,
  normalizeIcqqGuildInboundMessage,
  type NormalizedIcqqGuildInbound,
} from "./icqq-guild.js";
import type { IpcGuildMessageEventData } from "./protocol.js";

export class IcqqEndpoint implements Endpoint<IcqqEndpointConfig, IcqqIpcMessageEvent> {
  $connected = false;
  $config: IcqqEndpointConfig;
  ipc!: IpcClient;

  /** 缓存的好友列表 */
  friends = new Map<number, IpcFriendInfo>();
  /** 缓存的群列表 */
  groups = new Map<number, IpcGroupInfo>();
  /** QQ 频道（guild）子频道缓存 */
  readonly guildCatalog = new IcqqGuildCatalog();

  private subscriptions: Array<{ unsubscribe: () => Promise<void> }> = [];
  /** 事件去重：覆盖多端回流/服务端重复推送等场景 */
  private readonly inboundDeduper = new InboundMessageDeduper();
  /** MessageEvent.source 解析结果，供 $getMsg 优先命中 */
  private readonly quotedSourceCache = new Map<string, QuotedMessagePayload>();
  /** 用户主动断开时为 true，阻止自动重连 */
  private intentionalDisconnect = false;
  /** 是否已有重连循环在跑（避免多次 schedule 叠套） */
  private reconnectRunning = false;

  get $id() {
    return this.$config.name;
  }

  get logger() {
    return this.adapter.plugin.logger;
  }

  constructor(
    public adapter: IcqqAdapter,
    config: IcqqEndpointConfig,
  ) {
    this.$config = config;
  }

  // ── 连接 ───────────────────────────────────────────────────────────

  async $connect(): Promise<void> {
    this.intentionalDisconnect = false;
    const rpc = this.$config.rpc;

    this.logger.debug(formatCompact( {
      connecting: this.$id,
      mode: rpc ? "rpc" : "ipc",
      host: rpc?.host,
      port: rpc?.port,
    }));

    await this.rebindIpcSession();

    this.logger.info(formatCompact( {
      机器人: this.$id,
      好友数: this.friends.size,
      群组数: this.groups.size,
    }));
  }

  /** 建立或恢复与守护进程的 IPC/RPC 会话（订阅、缓存列表） */
  private async rebindIpcSession(): Promise<void> {
    const uin = Number(this.$config.name);
    const rpc = this.$config.rpc;

    // 旧连接上的订阅句柄已失效，不再对死 socket 发 unsubscribe
    this.subscriptions = [];

    let client: IpcClient;
    if (rpc) {
      client = await IpcClient.connectRpc(rpc);
    } else {
      client = await IpcClient.connect(uin);
    }

    if (this.intentionalDisconnect) {
      client.close();
      throw new Error("连接已取消");
    }

    this.ipc = client;
    if (this.$config.autoReconnect !== false) {
      this.ipc.setOnRemoteDisconnect(() => this.scheduleReconnect());
    } else {
      this.ipc.setOnRemoteDisconnect(null);
    }

    await this.refreshLists();

    // 新版 icqq cli 在认证后自动广播事件，订阅过滤改为客户端侧完成。
    const sub = this.ipc.subscribe(
      Actions.SUBSCRIBE,
      {},
      (event) => this.handleEvent(event),
    );
    this.subscriptions.push(sub);

    this.$connected = true;
  }

  /** IPC/RPC 意外断开时调度重连（指数退避） */
  private scheduleReconnect(): void {
    if (this.$config.autoReconnect === false) return;
    if (this.intentionalDisconnect) return;
    if (this.reconnectRunning) return;
    this.reconnectRunning = true;
    void this.runReconnectLoop();
  }

  private async runReconnectLoop(): Promise<void> {
    try {
      for (let attempt = 0; !this.intentionalDisconnect; attempt++) {
        const base = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6));
        const jitter = Math.floor(Math.random() * 400);
        const delayMs = base + jitter;

        this.$connected = false;
        this.logger.warn(formatCompact( {
          op: "disconnect",
          endpoint: this.$id,
          ok: false,
          delay_ms: delayMs,
          attempt: attempt + 1,
        }));

        await new Promise<void>((r) => setTimeout(r, delayMs));
        if (this.intentionalDisconnect) break;

        try {
          await this.rebindIpcSession();
          this.logger.info(formatCompact( {
            op: "reconnect",
            endpoint: this.$id,
            friends: this.friends.size,
            groups: this.groups.size,
          }));
          break;
        } catch (e: unknown) {
          this.logger.warn(formatCompact( {
            op: "reconnect",
            endpoint: this.$id,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          }));
        }
      }
    } finally {
      this.reconnectRunning = false;
    }
  }

  /** 刷新好友/群列表缓存 */
  async refreshLists(): Promise<void> {
    const [flResp, glResp] = await Promise.all([
      this.ipc.request(Actions.LIST_FRIENDS),
      this.ipc.request(Actions.LIST_GROUPS),
    ]);

    this.friends.clear();
    if (flResp.ok && Array.isArray(flResp.data)) {
      for (const f of flResp.data as IpcFriendInfo[]) {
        this.friends.set(f.user_id, f);
      }
    }

    this.groups.clear();
    if (glResp.ok && Array.isArray(glResp.data)) {
      for (const g of glResp.data as IpcGroupInfo[]) {
        this.groups.set(g.group_id, g);
      }
    }

    await this.guildCatalog.syncAll(this.ipc).catch((e: unknown) => {
      this.logger.warn(formatCompact({
        op: "sync_guilds",
        endpoint: this.$id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }));
    });
  }

  /** Console：列出 guild 子频道（含 parent.guild） */
  getGuildChannelList(): ReturnType<IcqqGuildCatalog["getGuildChannelList"]> {
    return this.guildCatalog.getGuildChannelList();
  }

  resolveConsoleChannelNames(
    channelId: string,
    guildId?: string,
  ): { channelName?: string; parentName?: string } {
    return this.guildCatalog.resolveConsoleChannelNames(channelId, guildId);
  }

  // ── 断开 ───────────────────────────────────────────────────────────

  async $disconnect(): Promise<void> {
    this.intentionalDisconnect = true;

    this.ipc?.setOnRemoteDisconnect(null);
    for (const sub of this.subscriptions) {
      await sub.unsubscribe().catch(() => {});
    }
    this.subscriptions = [];
    this.inboundDeduper.clear();
    disposeIcqqLoginAssistBridge(this.$id);
    this.ipc?.close();
    this.$connected = false;
    this.logger.info(formatCompact( { op: "disconnect", endpoint: this.$id }));
  }

  // ── 消息处理 ───────────────────────────────────────────────────────

  private handleEvent(event: IpcEvent): void {
    if (event.event?.startsWith("system.login.")) {
      handleIcqqLoginIpcEvent(this, event.event, event.data);
      return;
    }

    if (event.event === Actions.RELOAD_GUILDS) {
      void this.guildCatalog.syncAll(this.ipc).catch((e: unknown) => {
        this.logger.warn(formatCompact({
          op: "reload_guilds",
          endpoint: this.$id,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        }));
      });
      return;
    }

    if (isIcqqGuildIpcEvent(event.event)) {
      this.handleGuildMessageEvent(event);
      return;
    }

    const payload = unwrapIcqqIpcEventPayload(event);
    if (!payload || typeof payload !== "object") {
      if (process.env.ICQQ_IPC_LOG_RAW === "1") {
        this.logger.info(
          formatCompact({
            ipc_skip: "no_payload",
            ipc_event: event.event,
          }),
        );
      }
      return;
    }

    if (process.env.ICQQ_IPC_LOG_RAW === "1") {
      this.logger.info(
        formatCompact({
          ipc_raw: JSON.stringify(payload).slice(0, 800),
        }),
      );
    }

    if (isIcqqNoticePayload(payload)) {
      this.handleNoticeEvent(payload);
      return;
    }
    if (isIcqqRequestPayload(payload)) {
      this.handleRequestEvent(payload);
      return;
    }
    if (isIcqqMetaPayload(payload)) {
      this.handleMetaEvent(payload);
      return;
    }

    if (!isIcqqMessagePostType(payload)) {
      const postType = resolveIcqqEventPostType(
        payload as Record<string, unknown>,
      );
      if (process.env.ICQQ_IPC_LOG_RAW === "1") {
        this.logger.info(
          formatCompact({ ipc_skip: postType ?? "unknown_event" }),
        );
      }
      return;
    }

    const data = payload;

    if (shouldSkipSelfInboundMessage(data)) {
      if (process.env.ICQQ_IPC_LOG_RAW === "1") {
        this.logger.info(formatCompact({ ipc_skip: "self_message" }));
      }
      return;
    }

    const normalized = normalizeIcqqInboundMessage(data);
    if (!normalized) {
      if (process.env.ICQQ_IPC_LOG_RAW === "1") {
        this.logger.info(formatCompact({ ipc_skip: "normalize_failed" }));
      }
      return;
    }

    if (!this.inboundDeduper.shouldProcess(normalized.messageId)) {
      if (process.env.ICQQ_IPC_LOG_RAW === "1") {
        this.logger.info(
          formatCompact({ ipc_dedupe: normalized.messageId }),
        );
      }
      return;
    }

    void this.dispatchInboundMessage(data, normalized);
  }

  private async dispatchInboundMessage(
    data: IcqqIpcMessageEvent,
    normalized: NormalizedIcqqInbound,
  ): Promise<void> {
    this.logIpcInboundPayload(data, normalized);

    await this.primeQuotedSourceCache(
      data.source ?? findIcqqNestedMessageSource(data),
    );

    const message = this.$formatMessage(normalized);
    this.adapter.emit("message.receive", message);
    this.logger.debug(
      `${this.$id} recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}${message.$quote_id ? ` quote_id=${message.$quote_id}` : ""}`,
    );
  }

  private handleGuildMessageEvent(event: IpcEvent): void {
    const payload = event.data;
    if (!payload || typeof payload !== "object") return;
    const data = payload as IpcGuildMessageEventData & Record<string, unknown>;
    const normalized = normalizeIcqqGuildInboundMessage(data);
    if (!normalized) return;

    this.guildCatalog.upsertFromInbound(data);

    if (!this.inboundDeduper.shouldProcess(`guild:${normalized.messageId}`)) {
      return;
    }

    void this.dispatchGuildInboundMessage(normalized);
  }

  private async dispatchGuildInboundMessage(
    normalized: NormalizedIcqqGuildInbound,
  ): Promise<void> {
    const message = this.$formatGuildMessage(normalized);
    this.adapter.emit("message.receive", message);
    this.logger.debug(
      `${this.$id} recv channel(${message.$channel.id}):${segment.raw(message.$content)}`,
    );
  }

  private $formatGuildMessage(
    normalized: NormalizedIcqqGuildInbound,
  ): ReturnType<typeof Message.from<IpcGuildMessageEventData>> {
    const senderInfo: IcqqSenderInfo = {
      id: normalized.userId,
      name: normalized.nickname,
    };

    const result = Message.from(normalized.raw, {
      $id: normalized.messageId,
      $adapter: "icqq" as const,
      $endpoint: this.$config.name,
      $sender: senderInfo,
      $channel: {
        id: normalized.channelId,
        type: "channel",
        parent: { type: "guild", id: normalized.guildId },
      },
      $content: normalized.content,
      $raw: normalized.rawMessage,
      $timestamp: normalized.timestampMs,
      $recall: async () => {
        await this.$recallMessage(result.$id);
      },
      $reply: async (
        content: SendContent,
        quote?: boolean | string,
      ): Promise<string> => {
        if (!Array.isArray(content)) content = [content];
        if (quote) {
          content.unshift({
            type: "reply",
            data: { id: typeof quote === "boolean" ? result.$id : quote },
          });
        }
        return await this.adapter.sendMessage({
          context: "icqq",
          endpoint: this.$config.name,
          id: normalized.channelId,
          type: "channel",
          parent: { type: "guild", id: normalized.guildId },
          content,
        });
      },
    });
    return result;
  }

  private handleNoticeEvent(event: IcqqIpcRawEvent): void {
    const dedupeKey = resolveSideEventDedupeKey(event, "notice");
    if (!this.inboundDeduper.shouldProcess(dedupeKey)) {
      if (process.env.ICQQ_IPC_LOG_RAW === "1") {
        this.logger.info(formatCompact({ ipc_dedupe: dedupeKey }));
      }
      return;
    }
    const notice = formatIcqqNotice(event, this.$config.name);
    this.adapter.emit("notice.receive", notice);
    this.logger.info(
      formatCompact({
        notice: notice.$type,
        channel: `${notice.$channel.type}(${notice.$channel.id})`,
        endpoint: this.$id,
        sub_type: notice.$subType,
      }),
    );
  }

  private handleRequestEvent(event: IcqqIpcRawEvent): void {
    const dedupeKey = resolveSideEventDedupeKey(event, "request");
    if (!this.inboundDeduper.shouldProcess(dedupeKey)) {
      if (process.env.ICQQ_IPC_LOG_RAW === "1") {
        this.logger.info(formatCompact({ ipc_dedupe: dedupeKey }));
      }
      return;
    }
    const request = formatIcqqRequest(event, this.$config.name, this.ipc);
    this.adapter.emit("request.receive", request);
    this.logger.info(
      formatCompact({
        request: request.$type,
        channel: `${request.$channel.type}(${request.$channel.id})`,
        endpoint: this.$id,
        from: request.$sender.id,
      }),
    );
  }

  private handleMetaEvent(event: IcqqIpcRawEvent): void {
    const dedupeKey = resolveSideEventDedupeKey(event, "meta");
    if (!this.inboundDeduper.shouldProcess(dedupeKey)) return;

    this.logger.debug(formatIcqqMetaLog(event));
    if (shouldRefreshListsOnMeta(event)) {
      void this.refreshLists().catch((e: unknown) => {
        this.logger.warn(
          formatCompact({
            op: "refresh_lists",
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      });
    }
  }

  /** 调试 IPC 入站字段：默认 debug；设 ICQQ_IPC_LOG_RAW=1 则 info 打完整 payload */
  private logIpcInboundPayload(
    data: IcqqIpcMessageEvent,
    normalized: NormalizedIcqqInbound,
  ): void {
    const ext = data as IcqqIpcMessageEvent & Record<string, unknown>;
    const keys = Object.keys(ext);
    const idHints: Record<string, unknown> = {};
    for (const key of keys) {
      if (/message|msg|seq|id|source/i.test(key)) {
        idHints[key] = ext[key];
      }
    }
    const preview = JSON.stringify(data);
    const compact = formatCompact({
      post_type: data.post_type ?? "legacy",
      message_type: data.message_type ?? data.type,
      ipc_message_id: normalized.messageId,
      id_source: normalized.idSource,
      ipc_keys: keys.join(","),
      ...(Object.keys(idHints).length ? { ipc_id_hints: JSON.stringify(idHints) } : {}),
    });
    this.logger.debug(compact);
    this.logger.debug(formatCompact({ ipc_payload: preview.slice(0, 1200) }));
  }

  $formatMessage(
    input: NormalizedIcqqInbound | IcqqIpcMessageEvent,
  ): ReturnType<typeof Message.from<IcqqIpcMessageEvent>> {
    const normalized =
      "messageId" in input
        ? input
        : normalizeIcqqInboundMessage(input);
    if (!normalized) {
      throw new Error("无法解析 icqq 入站消息");
    }
    const raw = normalized.raw;
    const senderInfo: IcqqSenderInfo = {
      id: normalized.userId,
      name: normalized.nickname,
    };
    if (normalized.senderRole && normalized.senderRole !== "member") {
      senderInfo.role = normalized.senderRole;
      if (normalized.senderRole === "owner") {
        senderInfo.isOwner = true;
        senderInfo.permissions = ["owner"];
      } else if (normalized.senderRole === "admin") {
        senderInfo.isAdmin = true;
        senderInfo.permissions = ["admin"];
      }
    }

    const quoteId =
      Message.quoteIdFromContent(normalized.content) ??
      resolveIcqqQuoteIdFromEvent(normalized.raw);
    Message.alignReplySegments(normalized.content, quoteId);

    const result = Message.from(raw, {
      $id: normalized.messageId,
      $adapter: "icqq" as const,
      $endpoint: this.$config.name,
      $sender: senderInfo,
      $channel: {
        id: normalized.channelId,
        type: normalized.channelType,
        ...(normalized.channelParentGroupId
          ? { parent: { type: 'group' as const, id: normalized.channelParentGroupId } }
          : {}),
      },
      $content: normalized.content,
      $quote_id: quoteId,
      $raw: normalized.rawMessage,
      $timestamp: normalized.timestampMs,
      $recall: async () => {
        if (normalized.idSource === "synthetic") {
          this.logger.warn(formatCompact( {
            op: "recall",
            endpoint: this.$id,
            ok: false,
            error: "no message_id in push",
          }));
          return;
        }
        await this.$recallMessage(result.$id);
      },
      $reply: async (
        content: SendContent,
        quote?: boolean | string,
      ): Promise<string> => {
        if (!Array.isArray(content)) content = [content];
        if (quote) {
          content.unshift({
            type: "reply",
            data: { id: typeof quote === "boolean" ? result.$id : quote },
          });
        }
        return await this.adapter.sendMessage({
          ...result.$channel,
          context: "icqq",
          endpoint: this.$config.name,
          content,
        });
      },
    });
    return result;
  }

  /**
   * 有 source.message_id 时用 get_msg 拉全量正文；否则仅用 source 内联摘要。
   */
  private async primeQuotedSourceCache(source: unknown): Promise<void> {
    if (!source) return;
    const quoteId = resolveQuoteIdFromIcqqSource(source);
    const s = source as { message_id?: unknown };
    const hasCanonicalId =
      quoteId &&
      s.message_id != null &&
      String(s.message_id).trim() === quoteId;

    if (hasCanonicalId) {
      try {
        await this.fetchQuotedMessagePayload(quoteId);
        return;
      } catch (e: unknown) {
        this.logger.debug(
          formatCompact({
            op: "quote_get_msg",
            message_id: quoteId,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    }

    const sourcePayload = quotedPayloadFromIcqqSource(source);
    if (!sourcePayload) return;
    const enriched = await enrichQuotedPayloadWithForward(
      this.ipc,
      sourcePayload,
    );
    this.quotedSourceCache.set(enriched.messageId, enriched);
  }

  private async fetchQuotedMessagePayload(
    messageId: string,
  ): Promise<QuotedMessagePayload> {
    const resp = await this.ipc.request(Actions.GET_MSG, {
      message_id: messageId,
    });
    if (!resp.ok) {
      throw new Error(resp.error ?? "get_msg failed");
    }
    const payload = parseIcqqGetMsgResponse(messageId, resp.data);
    const enriched = await enrichQuotedPayloadWithForward(
      this.ipc,
      payload,
      resp.data,
    );
    if (
      isForwardPlaceholderPayload(enriched) &&
      !String(
        Array.isArray(enriched.content)
          ? segment.raw(enriched.content)
          : enriched.content ?? "",
      ).includes("[Merged chat history")
    ) {
      this.logger.debug(
        formatCompact({
          op: "forward_unresolved",
          message_id: messageId,
        }),
      );
    }
    this.quotedSourceCache.set(messageId, enriched);
    return enriched;
  }

  async $getMsg(messageId: string): Promise<QuotedMessagePayload> {
    const cached = this.quotedSourceCache.get(messageId);
    if (cached) {
      return enrichQuotedPayloadWithForward(this.ipc, cached);
    }
    return this.fetchQuotedMessagePayload(messageId);
  }

  // ── 撤回 ───────────────────────────────────────────────────────────

  async $recallMessage(id: string): Promise<void> {
    const resp = await this.ipc.request(Actions.RECALL_MSG, {
      message_id: id,
    });
    if (!resp.ok) {
      this.logger.warn(formatCompact( {
        op: "recall",
        endpoint: this.$id,
        ok: false,
        error: resp.error,
      }));
    }
  }

  // ── 发送消息 ───────────────────────────────────────────────────────

  async $sendMessage(options: SendOptions): Promise<string> {
    const outboundMedia = resolveIcqqOutboundMediaMode(this.$config);
    const expanded = expandInteractiveSegmentsInContent(options.content);
    const qrcodeContent = expanded;
    const content = materializeOutboundBase64(qrcodeContent, outboundMedia);
    const message = buildIcqqIpcMessageImpl(content);

    let action: string;
    let params: Record<string, unknown>;

    switch (options.type) {
      case "private": {
        const groupParent =
          options.parent?.type === "group" ? options.parent.id : undefined;
        if (groupParent) {
          action = Actions.SEND_TEMP_MSG;
          params = {
            group_id: Number(groupParent),
            user_id: Number(options.id),
            message,
          };
        } else {
          action = Actions.SEND_PRIVATE_MSG;
          params = { user_id: Number(options.id), message };
        }
        break;
      }
      case "group":
        action = Actions.SEND_GROUP_MSG;
        params = { group_id: Number(options.id), message };
        break;
      case "channel": {
        const guildId =
          options.parent?.type === "guild" ? options.parent.id : undefined;
        if (!guildId) {
          throw new Error(
            'channel 发送需要 parent: { type: "guild", id: guild_id }',
          );
        }
        action = Actions.GUILD_SEND_MSG;
        params = {
          guild_id: guildId,
          channel_id: options.id,
          message,
        };
        break;
      }
      default:
        throw new Error(`不支持的频道类型: ${options.type}`);
    }

    const resp = await this.ipc.request(action, params);
    if (!resp.ok) {
      this.logger.debug(formatCompact({
        op: action,
        ...params,
      }));
      throw new Error(`发送消息失败: ${resp.error}`);
    }

    const messageId = String(
      (resp.data as any)?.message_id ?? `sent_${Date.now()}`,
    );
    this.logger.debug(
      `${this.$id} send ${options.type}(${options.id}):${segment.raw(options.content)}`,
    );
    return messageId;
  }

  // ── 消息回应 ───────────────────────────────────────────────────────

  /**
   * 表情符号到 reaction id 的映射
   * QQ 使用数字 ID 来标识表情，而不是 Unicode 字符
   */
  private static readonly EMOJI_MAP: Record<string, string> = {
    '⏳': '1468368274',  // 沙漏
    '👍': '128077',      // 竖起大拇指
    '❤️': '10084',       // 红心
    '😊': '128522',      // 微笑
    '🎉': '127881',      // 派对
    '🔥': '128293',      // 火
    '✅': '9989',        // 勾选
    '❌': '10060',       // 叉号
    '⭐': '11088',       // 星星
    '💯': '128175',      // 一百分
  };

  /**
   * 将表情符号转换为 reaction id
   */
  private getEmojiId(emoji: string): string {
    // 如果已经是数字 ID，直接返回
    if (/^\d+$/.test(emoji)) {
      return emoji;
    }

    // 从映射中查找
    const id = IcqqEndpoint.EMOJI_MAP[emoji];
    if (id) {
      return id;
    }

    // 默认返回 Unicode 码点
    return String(emoji.codePointAt(0) || 0);
  }

  /**
   * 添加消息回应（表情）
   *
   * @param messageId - 消息 ID
  * @param emoji - 表情符号或 reaction id
   * @returns 反应 ID，可用于后续移除
   */
  async $addReaction(messageId: string, emoji: string): Promise<string | null> {
    try {
      const emojiId = this.getEmojiId(emoji);

      const resp = await this.ipc.request(Actions.GROUP_SET_REACTION, {
        message_id: messageId,
        id: emojiId,
      });

      if (!resp.ok) {
        this.logger.warn(formatCompact({
          op: "add_reaction",
          endpoint: this.$id,
          message_id: messageId,
          emoji,
          id: emojiId,
          ok: false,
          error: resp.error,
        }));
        return null;
      }

      this.logger.debug(formatCompact({
        op: "add_reaction",
        endpoint: this.$id,
        message_id: messageId,
        emoji,
        id: emojiId,
        ok: true,
      }));

      // 返回 reaction id，供 $removeReaction 直接使用
      return emojiId;
    } catch (error) {
      this.logger.warn(formatCompact({
        op: "add_reaction",
        endpoint: this.$id,
        message_id: messageId,
        emoji,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      return null;
    }
  }

  /**
   * 移除消息回应
   *
   * @param messageId - 消息 ID
   * @param reactionId - 反应 ID（由 $addReaction 返回）
   */
  async $removeReaction(messageId: string, reactionId: string): Promise<void> {
    try {
      // 兼容两种格式：
      // 1) 旧格式 reaction_{id}_{timestamp}
      // 2) 新格式直接为 id
      const parts = reactionId.split('_');
      const emojiId = parts.length >= 2 ? parts[1] : reactionId;

      const resp = await this.ipc.request(Actions.GROUP_DEL_REACTION, {
        message_id: messageId,
        id: emojiId,
      });

      if (!resp.ok) {
        this.logger.warn(formatCompact({
          op: "remove_reaction",
          endpoint: this.$id,
          message_id: messageId,
          reaction_id: reactionId,
          id: emojiId,
          ok: false,
          error: resp.error,
        }));
      } else {
        this.logger.debug(formatCompact({
          op: "remove_reaction",
          endpoint: this.$id,
          message_id: messageId,
          reaction_id: reactionId,
          id: emojiId,
          ok: true,
        }));
      }
    } catch (error) {
      this.logger.warn(formatCompact({
        op: "remove_reaction",
        endpoint: this.$id,
        message_id: messageId,
        reaction_id: reactionId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}

/** @deprecated 使用 `./cq-message.js` 导出 */
export namespace IcqqEndpoint {
  export const parseCqMessage = parseCqMessageImpl;
  export const buildIcqqIpcMessage = buildIcqqIpcMessageImpl;
  export const toCqString = toCqStringImpl;
}
