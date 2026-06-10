/**
 * QQ 官方 Bot 实现
 */
import {
  Bot,
  PrivateMessageEvent,
  GroupMessageEvent,
} from "qq-official-bot";
import path from "path";
import { formatCompact } from "@zhin.js/logger";
import { registerFetchRoute, type RouterContext } from "@zhin.js/host-router/router";
import {
  Bot as ZhinBot,
  Message,
  SendOptions,
  SendContent,
  segment,
} from "zhin.js";
import type { MessageElement } from "zhin.js";
import { ReceiverMode, type QQBotConfig, type ApplicationPlatform } from "./types.js";
import type { QQAdapter } from "./adapter.js";
import { normalizeQqInboundWsPayload, type QqWsPacket } from "./inbound-normalize.js";
import { normalizeGroupAtPrefix } from "./group-at-normalize.js";
import { SDK_VERSION, SDK_VERSION_HEADER } from "./sdk-version.js";
import { applyCustomAuthEndpoints } from "./gateway-config.js";
import { normalizeOutboundMarkdown } from "./outbound-markdown.js";
import { normalizeOutboundMedia } from "./outbound-media.js";

/** 从 qq-official-bot SendResult / 审核回包中解析出站消息 ID */
export function resolveOutboundMessageId(result: unknown): string {
  if (!result || typeof result !== "object") {
    throw new Error("QQ 发送消息失败：响应为空");
  }
  const row = result as Record<string, unknown>;
  const nested = row.data && typeof row.data === "object"
    ? row.data as Record<string, unknown>
    : undefined;
  const audit = (row.message_audit ?? nested?.message_audit) as Record<string, unknown> | undefined;
  const id = row.id ?? row.message_id ?? audit?.audit_id;
  if (id == null || id === "") {
    const code = row.code;
    const msg = row.message;
    throw new Error(
      code != null
        ? `QQ 发送消息失败（${String(code)}）${msg ? `: ${String(msg)}` : ""}`
        : "QQ 发送消息失败：响应缺少消息 ID",
    );
  }
  return String(id);
}

export class QQBot<T extends ReceiverMode, M extends ApplicationPlatform = ApplicationPlatform>
  extends Bot
  implements ZhinBot<QQBotConfig<T, M>, PrivateMessageEvent | GroupMessageEvent>
{
  $connected: boolean = false;
  declare $config: QQBotConfig<T, M>;
  /** 平台侧机器人 user_id，用于 @ 触发匹配 */
  $platformUserId?: string;

  get pluginLogger() {
    return this.adapter.plugin.logger;
  }

  get $id() {
    return this.$config.name;
  }

  constructor(public adapter: QQAdapter, config: QQBotConfig<T, M>) {
    if (!config.data_dir) config.data_dir = path.join(process.cwd(), "data");
    if (config.mode === ReceiverMode.MIDDLEWARE) {
      const mw = config as QQBotConfig<ReceiverMode.MIDDLEWARE, M> & {
        platform?: ApplicationPlatform;
      };
      if (!mw.platform) {
        mw.platform = (mw.application ?? "koa") as ApplicationPlatform;
      }
    }
    super(config);
    this.$config = config;
    this.attachSdkVersionHeader();
    applyCustomAuthEndpoints(this, config, this.pluginLogger);
  }

  /** 出站 QQ API 请求附带 SDK 版本，便于平台侧日志排查 */
  private attachSdkVersionHeader(): void {
    this.request.interceptors.request.use((reqConfig) => {
      reqConfig.headers[SDK_VERSION_HEADER] = SDK_VERSION;
      return reqConfig;
    });
  }

  /** 归一化 QQ API v2 群聊字段后再交给 qq-official-bot 解析 */
  dispatchEvent(event: string, wsRes: QqWsPacket): void {
    this.pluginLogger.debug({
      op: 'inbound_ws',
      event,
      group: String(wsRes.d?.group_openid ?? wsRes.d?.group_id ?? '?'),
    });
    if (event === 'GROUP_AT_MESSAGE_CREATE' || event === 'GROUP_MESSAGE_CREATE') {
      this.pluginLogger.info(
        `qq inbound ws: ${event} group=${String(wsRes.d?.group_openid ?? wsRes.d?.group_id ?? '?')}`,
      );
    }
    normalizeQqInboundWsPayload(event, wsRes);
    super.dispatchEvent(event, wsRes);
  }

  private handleQQMessage(msg: PrivateMessageEvent | GroupMessageEvent): void {
    try {
      const message = this.$formatMessage(msg);
      this.adapter.emit("message.receive", message);
      this.pluginLogger.debug(
        `${this.$config.name} recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`,
      );
    } catch (err) {
      this.pluginLogger.warn(
        `qq format inbound failed (${msg.message_type}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private handleGroupNotice(event: string, payload: { group_id?: string; operator_id?: string }): void {
    this.pluginLogger.info(
      `qq notice ${event}: group=${payload.group_id ?? '?'} operator=${payload.operator_id ?? '?'}`,
    );
  }

  async $connect(): Promise<void> {
    this.on("message.group", this.handleQQMessage.bind(this));
    this.on("message.guild", this.handleQQMessage.bind(this));
    this.on("message.private", this.handleQQMessage.bind(this));
    this.on("notice.group.increase", (e) => this.handleGroupNotice('group.add_robot', e));
    this.on("notice.group.decrease", (e) => this.handleGroupNotice('group.del_robot', e));
    this.on("notice.group.receive_open", (e) => this.handleGroupNotice('group.msg_receive_open', e));
    this.on("notice.group.receive_close", (e) => this.handleGroupNotice('group.msg_receive_close', e));
    await this.start();
    this.mountWebhookReceiver();
    this.$connected = true;
    try {
      const self = await this.getSelfInfo();
      const uid = (self as { id?: string; user_id?: string; username?: string })?.id
        ?? (self as { user_id?: string })?.user_id;
      if (uid) this.$platformUserId = String(uid);
    } catch (err) {
      this.pluginLogger.debug(
        `${this.$config.name} getSelfInfo failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async $disconnect(): Promise<void> {
    // Bot 继承自 EventEmitter，清除 $connect() 注册的所有监听器
    (this as unknown as import('node:events').EventEmitter).removeAllListeners();
    await this.stop();
    this.$connected = false;
  }

  private resolveWebhookPath(): string {
    const raw = this.$config.webhookPath ?? "/qq/webhook";
    return raw.startsWith("/") ? raw : `/${raw}`;
  }

  /**
   * Webhook 入站：middleware（挂 host-router）或独立 HTTP 端口（qq-official-bot 内置服务）。
   */
  private mountWebhookReceiver(): void {
    const mode = this.$config.mode;
    if (mode === ReceiverMode.MIDDLEWARE) {
      const router = this.adapter.getRouter();
      if (!router) {
        throw new Error("QQ mode=middleware 需要启用 @zhin.js/host-router 插件");
      }
      const webhookPath = this.resolveWebhookPath();
      const mw = this.middleware as (
        ctx: RouterContext,
        next: () => Promise<void>,
      ) => Promise<unknown>;
      router.post(webhookPath, async (ctx: RouterContext) => {
        this.pluginLogger.debug(ctx.body);
        await mw(ctx, async () => {});
      });
      this.pluginLogger.info(formatCompact({
        op: "webhook",
        mode: "middleware",
        path: webhookPath,
        url: `POST ${webhookPath}`,
        note: "无 /api 前缀；Host API 才走 /api/*",
      }));
      return;
    }
    if (mode === ReceiverMode.WEBHOOK) {
      const cfg = this.$config as QQBotConfig<ReceiverMode.WEBHOOK>;
      this.pluginLogger.info(formatCompact({
        op: "webhook",
        mode: "standalone",
        port: cfg.port,
        path: cfg.path,
        url: `http://127.0.0.1:${cfg.port}${cfg.path}`,
      }));
    }
  }

  $formatMessage(msg: PrivateMessageEvent | GroupMessageEvent) {
    const raw = msg as PrivateMessageEvent & GroupMessageEvent & {
      group_openid?: string;
      author?: { member_openid?: string; user_openid?: string; id?: string; username?: string };
      __zhin_group_at?: boolean;
    };

    if (msg.message_type === "group") {
      if (!raw.group_id && raw.group_openid) {
        raw.group_id = raw.group_openid;
      }
      if (!msg.user_id && raw.author) {
        const uid = raw.author.member_openid ?? raw.author.user_openid ?? raw.author.id;
        if (uid) msg.user_id = String(uid);
      }
    }

    let target_id = msg.user_id;
    if (msg.message_type === "guild") target_id = msg.channel_id!;
    if (msg.message_type === "group") target_id = raw.group_id ?? msg.group_id ?? "";
    if (msg.sub_type === "direct") target_id = `direct:${msg.guild_id}`;

    let content = msg.message;
    if (msg.message_type === "group" && Array.isArray(content)) {
      const botAtIds = [this.$platformUserId, this.$config.appid]
        .filter((id): id is string => Boolean(id))
        .map(String);
      content = normalizeGroupAtPrefix(content, botAtIds, raw.__zhin_group_at === true);
    }

    const result = Message.from(msg, {
      $id: msg.message_id?.toString(),
      $adapter: "qq" as const,
      $bot: this.$config.name,
      $sender: {
        id: msg.sender.user_id?.toString(),
        name: msg.sender.user_name?.toString(),
      },
      $channel: {
        id: target_id,
        type: msg.message_type === "guild" ? "channel" : msg.message_type,
      },
      $content: content,
      $raw: msg.raw_message,
      $timestamp: Date.now(),
      $recall: async () => {
        await this.$recallMessage(result.$id);
      },
      $reply: async (content: SendContent, quote: boolean | string = true): Promise<string> => {
        if (!Array.isArray(content)) content = [content];
        if (quote) content.unshift({ type: "reply", data: { id: typeof quote === "boolean" ? result.$id : quote } });
        return await this.adapter.sendMessage({
          ...result.$channel,
          context: "qq",
          bot: this.$config.name,
          content,
        });
      },
    });
    return result;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    const content = normalizeOutboundMarkdown(
      normalizeOutboundMedia(options.content),
      this.$config.outboundMarkdown,
    );
    switch (options.type) {
      case "private": {
        if (options.id.startsWith("direct:")) {
          const id = options.id.replace("direct:", "");
          const result = await this.sendDirectMessage(id, content);
          this.pluginLogger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(content)}`);
          return `direct-${options.id}:${resolveOutboundMessageId(result)}`;
        } else {
          const result = await this.sendPrivateMessage(options.id, content);
          this.pluginLogger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(content)}`);
          return `private-${options.id}:${resolveOutboundMessageId(result)}`;
        }
      }
      case "group": {
        const result = await this.sendGroupMessage(options.id, content);
        this.pluginLogger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(content)}`);
        return `group-${options.id}:${resolveOutboundMessageId(result)}`;
      }
      case "channel": {
        const result = await this.sendGuildMessage(options.id, content);
        this.pluginLogger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(content)}`);
        return `channel-${options.id}:${resolveOutboundMessageId(result)}`;
      }
      default:
        throw new Error(`unsupported channel type ${options.type}`);
    }
  }

  async $recallMessage(id: string): Promise<void> {
    if (!/^(private|group|channel|direct)-([^\:]+):(.+)$/.test(id)) throw new Error(`invalid message id ${id}`);
    const match = id.match(/^(private|group|channel|direct)-([^\:]+):(.+)$/);
    if (!match) return;
    const [, target_type, target_id, message_id] = match;
    if (target_type === "private") await this.recallPrivateMessage(target_id, message_id);
    if (target_type === "group") await this.recallGroupMessage(target_id, message_id);
    if (target_type === "channel") await this.recallGuildMessage(target_id, message_id);
    if (target_type === "direct") await this.recallDirectMessage(target_id, message_id);
  }

  // ==================== 频道管理 API ====================

  /**
   * 获取频道列表
   */
  async getGuilds(): Promise<any[]> {
    try {
      return await this.guildService.getList();
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 获取频道列表失败:`, error);
      throw error;
    }
  }

  /**
   * 获取频道详情
   * @param guildId 频道 ID
   */
  async getGuildInfo(guildId: string): Promise<any> {
    try {
      return await this.guildService.getInfo(guildId);
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 获取频道详情失败:`, error);
      throw error;
    }
  }

  /**
   * 获取子频道列表
   * @param guildId 频道 ID
   */
  async getChannels(guildId: string): Promise<any[]> {
    try {
      return await this.channelService.getList(guildId);
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 获取子频道列表失败:`, error);
      throw error;
    }
  }

  /**
   * 获取子频道详情
   * @param channelId 子频道 ID
   */
  async getChannelInfo(channelId: string): Promise<any> {
    try {
      return await this.channelService.getInfo(channelId);
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 获取子频道详情失败:`, error);
      throw error;
    }
  }

  /**
   * 获取频道成员列表
   * @param guildId 频道 ID
   */
  async getGuildMembers(guildId: string): Promise<any[]> {
    try {
      return await this.memberService.getGuildMemberList(guildId);
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 获取频道成员列表失败:`, error);
      throw error;
    }
  }

  /**
   * 获取频道成员详情
   * @param guildId 频道 ID
   * @param userId 用户 ID
   */
  async getGuildMember(guildId: string, userId: string): Promise<any> {
    try {
      return await this.memberService.getGuildMemberInfo(guildId, userId);
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 获取成员详情失败:`, error);
      throw error;
    }
  }

  /**
   * 删除频道成员（踢出）
   * @param guildId 频道 ID
   * @param userId 用户 ID
   * @param addBlacklist 是否加入黑名单
   * @param deleteHistoryMsg 删除历史消息天数 (-1不删除，0全部删除，3/7/15/30)
   */
  async removeGuildMember(guildId: string, userId: string, addBlacklist?: boolean, deleteHistoryMsg?: -1 | 0 | 3 | 7 | 15 | 30): Promise<boolean> {
    try {
      await this.memberService.kickMember(guildId, userId, deleteHistoryMsg, addBlacklist);
      this.pluginLogger.info(`QQ Bot ${this.$id} 踢出成员 ${userId}（频道 ${guildId}）`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 踢出成员失败:`, error);
      throw error;
    }
  }

  /**
   * 获取频道角色列表
   * @param guildId 频道 ID
   */
  async getGuildRoles(guildId: string): Promise<any[]> {
    try {
      return await this.guildService.getRoles(guildId);
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 获取角色列表失败:`, error);
      throw error;
    }
  }

  /**
   * 创建频道角色
   * @param guildId 频道 ID
   * @param name 角色名
   * @param color 颜色
   * @param hoist 是否在成员列表中单独展示 (0 或 1)
   */
  async createGuildRole(guildId: string, name: string, color?: number, hoist?: 0 | 1): Promise<any> {
    try {
      const result = await this.guildService.createRole(guildId, { name, color: color || 0, hoist: hoist ?? 0 });
      this.pluginLogger.info(`QQ Bot ${this.$id} 创建角色 "${name}"（频道 ${guildId}）`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 创建角色失败:`, error);
      throw error;
    }
  }

  /**
   * 给成员添加角色
   * @param guildId 频道 ID
   * @param channelId 子频道 ID
   * @param userId 用户 ID
   * @param roleId 角色 ID
   */
  async addMemberRole(guildId: string, channelId: string, userId: string, roleId: string): Promise<boolean> {
    try {
      await this.memberService.addMemberRole(guildId, channelId, userId, roleId);
      this.pluginLogger.info(`QQ Bot ${this.$id} 给成员 ${userId} 添加角色 ${roleId}（频道 ${guildId}）`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 添加角色失败:`, error);
      throw error;
    }
  }

  /**
   * 移除成员角色
   * @param guildId 频道 ID
   * @param channelId 子频道 ID
   * @param userId 用户 ID
   * @param roleId 角色 ID
   */
  async removeMemberRole(guildId: string, channelId: string, userId: string, roleId: string): Promise<boolean> {
    try {
      await this.memberService.removeMemberRole(guildId, channelId, userId, roleId);
      this.pluginLogger.info(`QQ Bot ${this.$id} 移除成员 ${userId} 的角色 ${roleId}（频道 ${guildId}）`);
      return true;
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 移除角色失败:`, error);
      throw error;
    }
  }

  /**
   * 禁言成员（批量）
   * @param guildId 频道 ID
   * @param userIds 用户 ID 列表
   * @param muteSeconds 禁言时长（秒），0 表示解除禁言
   */
  async muteMembers(guildId: string, userIds: string[], muteSeconds: number): Promise<boolean> {
    try {
      if (muteSeconds > 0) {
        await this.memberService.muteMembers(guildId, userIds, muteSeconds);
        this.pluginLogger.info(`QQ Bot ${this.$id} 禁言成员 ${userIds.join(',')} ${muteSeconds}秒（频道 ${guildId}）`);
      } else {
        await this.memberService.unmuteMembers(guildId, userIds);
        this.pluginLogger.info(`QQ Bot ${this.$id} 解除成员 ${userIds.join(',')} 禁言（频道 ${guildId}）`);
      }
      return true;
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 禁言操作失败:`, error);
      throw error;
    }
  }

  /**
   * 全员禁言
   * @param guildId 频道 ID
   * @param muteSeconds 禁言时长（秒），0 表示解除禁言
   */
  async muteAll(guildId: string, muteSeconds: number): Promise<boolean> {
    try {
      if (muteSeconds > 0) {
        await this.guildService.mute(guildId, muteSeconds);
        this.pluginLogger.info(`QQ Bot ${this.$id} 开启全员禁言（频道 ${guildId}）`);
      } else {
        await this.guildService.unmute(guildId);
        this.pluginLogger.info(`QQ Bot ${this.$id} 关闭全员禁言（频道 ${guildId}）`);
      }
      return true;
    } catch (error) {
      this.pluginLogger.error(`QQ Bot ${this.$id} 全员禁言操作失败:`, error);
      throw error;
    }
  }
}
