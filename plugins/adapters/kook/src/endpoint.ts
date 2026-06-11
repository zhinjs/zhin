/**
 * KOOK Endpoint 实现
 */
import {
  Client,
  PrivateMessageEvent,
  ChannelMessageEvent,
  MessageSegment,
  User,
  Guild,
  GuildMember,
  parseGroupId,
} from "kook-client";
import { EventEmitter } from "node:events";
import path from "path";
import {
  Endpoint,
  Message,
  SendOptions,
  SendContent,
  MessageElement,
  segment,
  MessageType,
} from "zhin.js";
import type { KookEndpointConfig, KookSenderInfo, KookRawMessage } from "./types.js";
import { KookPermission } from "./types.js";
import type { KookAdapter } from "./adapter.js";
import { InboundMessageDeduper } from "./kook-inbound.js";
import { normalizeKookSenderForPermit } from "./platform-permit.js";
import {
  enrichKookGatewayForPlugins,
  formatKookNotice,
  formatKookNoticeLog,
  isKookNoticeGatewayEvent,
  resolveKookSideEventDedupeKey,
  type KookGatewayEvent,
} from "./kook-side-events.js";
import {
  encodeKookMsgRef,
  encodeKookReactionId,
  isKookApiGoneResult,
  isKookApiSuccess,
  isKookMsgGoneError,
  shouldStopDeleteAfterResponse,
  kookDeleteApiPath,
  kookReactionApiPath,
  parseKookMsgRef,
  parseKookReactionId,
  plainKookMsgId,
  resolveKookRoutes,
  routeFromSceneType,
  routeFromSendType,
  type KookMsgRoute,
} from "./kook-msg-route.js";
import { materializeOutboundMedia } from "./outbound-media.js";
import { uploadKookAsset } from "./kook-asset-upload.js";
import { convertToKookSendable } from "./outbound-sendable.js";

export class KookEndpoint extends Client implements Endpoint<KookEndpointConfig, KookRawMessage> {
  $connected: boolean = false;
  /** KOOK 平台 user_id，用于 @ 触发匹配（resolveEndpointAtIds） */
  $platformUserId?: string;
  adapter: KookAdapter;
  private readonly inboundDeduper = new InboundMessageDeduper();
  private readonly onGatewayEvent = (raw: KookGatewayEvent) => {
    this.handleGatewayEvent(raw);
  };

  get $id(): string {
    return this.$config.name;
  }

  get pluginLogger() {
    return this.adapter.plugin.logger;
  }

  constructor(adapter: KookAdapter, public $config: KookEndpointConfig) {
    super({
      token: $config.token,
      mode: "websocket", // KOOK 默认使用 WebSocket 模式
      data_dir: $config.data_dir || path.join(process.cwd(), "data", "kook"),
      timeout: $config.timeout || 10000,
      max_retry: $config.max_retry || 3,
      ignore: $config.ignore || "bot",
      logLevel: $config.logLevel || "info",
    });
    this.adapter = adapter;
    this.setupEventListeners();
    this.hookGatewayReceiver();
  }

  /**
   * 在 kook-client Receiver transform 之前拦截原始 gateway 事件（SDK 未实现 notice transform）
   */
  private hookGatewayReceiver(): void {
    const receiver = this.receiver as import("node:events").EventEmitter;
    receiver.prependListener("event", this.onGatewayEvent);
  }

  private handleGatewayEvent(raw: KookGatewayEvent): void {
    try {
      const enriched = enrichKookGatewayForPlugins(raw);
      EventEmitter.prototype.emit.call(this.adapter, "kook.gateway", enriched);

      if (!isKookNoticeGatewayEvent(raw)) return;

      const dedupeKey = resolveKookSideEventDedupeKey(raw, "notice");
      if (!this.inboundDeduper.shouldProcess(dedupeKey)) return;

      const notice = formatKookNotice(raw, this.$config.name);
      this.emitSideEvent("notice.receive", notice);
      this.pluginLogger.info(formatKookNoticeLog(notice));
    } catch (error) {
      this.pluginLogger.error("处理 KOOK gateway 事件失败:", error);
    }
  }

  private emitSideEvent(
    event: "notice.receive" | "request.receive",
    payload: unknown,
  ): void {
    this.adapter.emit(event, payload as never);
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 监听消息事件
    this.on("message", (msg: KookRawMessage) => {
      try {
        const message = this.$formatMessage(msg);
        const atSegs = message.$content.filter((s) => s.type === 'at');
        if (atSegs.length > 0) {
          this.pluginLogger.debug(
            `KOOK @解析: self_id=${this.$platformUserId ?? (this as { self_id?: string }).self_id ?? '?'}`
            + ` at=${JSON.stringify(atSegs.map((s) => s.data))}`
            + ` preview=${segment.raw(message.$content)}`,
          );
        }
        this.pluginLogger.debug(`KOOK 格式化消息: $content=${JSON.stringify(message.$content)}, $raw=${message.$raw}`);
        this.adapter.emit("message.receive", message);
        
        // 根据消息类型触发特定事件
        const eventMap: Record<MessageType, string> = {
          private: "message.private.receive",
          group: "message.group.receive",
          channel: "message.channel.receive",
        };
        
        const specificEvent = eventMap[msg.message_type];
        if (specificEvent) {
          this.adapter.emit(specificEvent as any, message);
        }
      } catch (error) {
        this.pluginLogger.error(`处理 KOOK 消息失败:`, error);
      }
    });

    // 监听连接事件
    this.on("connect" as any, () => {
      this.$connected = true;
      this.pluginLogger.info(`KOOK Endpoint ${this.$id} 已连接`);
    });

    // 监听断开事件
    this.on("disconnect" as any, () => {
      this.$connected = false;
      this.pluginLogger.warn(`KOOK Endpoint ${this.$id} 已断开`);
    });

    // 监听错误事件
    this.on("error" as any, (error: Error) => {
      this.pluginLogger.error(`KOOK Endpoint ${this.$id} 错误:`, error);
    });
  }

  /**
   * 将 KOOK 消息转换为标准消息格式
   */
  $formatMessage(msg: KookRawMessage): Message<KookRawMessage> {
    const channelId = msg.message_type === "channel" 
      ? (msg as ChannelMessageEvent).channel_id 
      : msg.author_id;
    
    // 获取发送者的权限信息
    const senderInfo = this.getSenderInfo(msg);
    
    // 频道消息需要获取 guild_id
    let guildId: string | undefined;
    if (msg.message_type === "channel") {
      const channelMsg = msg as ChannelMessageEvent;
      // 尝试从 channel 获取 guild_id
      try {
        const channel = channelMsg.channel;
        guildId = (channel?.info as any)?.guild_id;
      } catch {
        // 如果获取失败，尝试从缓存中查找
      }
    }
    
    const message: Message<KookRawMessage> = Message.from(msg, {
      $id: msg.message_id.toString(),
      $adapter: "kook" as const,
      $endpoint: this.$id,
      
      $sender: senderInfo,
      
      $channel: {
        id: channelId.toString(),
        type: msg.message_type === "channel" ? "channel" : "private",
        // 频道消息包含服务器ID
        ...(guildId ? { guild_id: guildId } : {}),
      },
      
      $content: this.parseMessageContent(msg.message),
      $raw: msg.raw_message,
      $timestamp: msg.timestamp,
      
      $recall: async () => {
        await this.$recallMessage(message.$id, {
          route: msg.message_type === 'channel' ? 'channel' : 'direct',
        });
      },
      
      $reply: async (content: SendContent, quote?: string | boolean): Promise<string> => {
        const elements = Array.isArray(content) ? content : [content];
        const finalContent: MessageElement[] = [];
        
        if (quote) {
          finalContent.push({
            type: "reply",
            data: { 
              id: typeof quote === "boolean" ? message.$id : quote,
            },
          });
        } 

        finalContent.push(...elements.map(el => 
          typeof el === 'string' ? { type: 'text' as const, data: { text: el } } : el
        ));
        
        return await this.adapter.sendMessage({
          ...message.$channel,
          context: "kook",
          endpoint: this.$id,
          content: finalContent,
        });
      },
    });
    
    return message;
  }

  /**
   * 获取发送者的详细权限信息
   */
  private getSenderInfo(msg: KookRawMessage): KookSenderInfo {
    const authorInfo = msg.author?.info;
    const senderInfo: KookSenderInfo = {
      id: msg.author_id.toString(),
      name: authorInfo?.nickname || authorInfo?.username || "未知用户",
    };

    // 频道消息才有权限信息
    if (msg.message_type === "channel") {
      const channelMsg = msg as ChannelMessageEvent;
      
      // 从 author.info 中获取权限信息（如果 kook-client 提供）
      if (authorInfo) {
        // 尝试获取角色列表
        senderInfo.roles = (authorInfo as any).roles || [];
        
        // 尝试获取 guild_id 并检查是否为服务器主人
        try {
          const channel = channelMsg.channel;
          const guildId = (channel?.info as any)?.guild_id;
          if (guildId) {
            const guildInfo = this.guilds?.get(guildId);
            if (guildInfo) {
              senderInfo.isGuildOwner = guildInfo.user_id === msg.author_id;
            }
          }
        } catch {
          // 忽略获取失败
        }
        
        // 根据 permission 字段判断（如果有）
        const permission = (authorInfo as any).permission as KookPermission | undefined;
        if (permission !== undefined) {
          senderInfo.permission = permission;
          senderInfo.isAdmin = permission === KookPermission.Admin || 
                               permission === KookPermission.Owner ||
                               permission === KookPermission.ChannelAdmin;
          senderInfo.isGuildOwner = senderInfo.isGuildOwner || permission === KookPermission.Owner;
        }
      }
    }

    const normalized = normalizeKookSenderForPermit(senderInfo, msg.message_type === "channel");
    senderInfo.role = normalized.role;
    senderInfo.permissions = normalized.permissions;
    return senderInfo;
  }

  // ==================== 频道管理 API ====================

  /**
   * 踢出用户
   * @param guildId 服务器ID
   * @param userId 用户ID
   */
  async kickUser(guildId: string, userId: string): Promise<boolean> {
    try {
      const guild = this.pickGuild(guildId);
      const result = await guild.kick(userId);
      this.pluginLogger.info(`KOOK Endpoint ${this.$id} 踢出用户 ${userId} 从服务器 ${guildId}`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`KOOK Endpoint ${this.$id} 踢出用户失败:`, error);
      throw error;
    }
  }

  /**
   * 将用户加入黑名单
   * @param guildId 服务器ID
   * @param userId 用户ID
   * @param remark 备注
   * @param delMsgDays 删除消息天数（0-7）
   */
  async addToBlacklist(guildId: string, userId: string, remark?: string, delMsgDays?: number): Promise<boolean> {
    try {
      const member = this.pickGuildMember(guildId, userId);
      const result = await member.addToBlackList(remark, delMsgDays);
      this.pluginLogger.info(`KOOK Endpoint ${this.$id} 将用户 ${userId} 加入黑名单（服务器 ${guildId}）`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`KOOK Endpoint ${this.$id} 加入黑名单失败:`, error);
      throw error;
    }
  }

  /**
   * 将用户从黑名单移除
   * @param guildId 服务器ID
   * @param userId 用户ID
   */
  async removeFromBlacklist(guildId: string, userId: string): Promise<boolean> {
    try {
      const member = this.pickGuildMember(guildId, userId);
      const result = await member.removeFromBlackList();
      this.pluginLogger.info(`KOOK Endpoint ${this.$id} 将用户 ${userId} 从黑名单移除（服务器 ${guildId}）`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`KOOK Endpoint ${this.$id} 移除黑名单失败:`, error);
      throw error;
    }
  }

  /**
   * 给用户授予角色
   * @param guildId 服务器ID
   * @param userId 用户ID
   * @param roleId 角色ID
   */
  async grantRole(guildId: string, userId: string, roleId: string): Promise<boolean> {
    try {
      const member = this.pickGuildMember(guildId, userId);
      const result = await member.grant(roleId);
      this.pluginLogger.info(`KOOK Endpoint ${this.$id} 授予用户 ${userId} 角色 ${roleId}（服务器 ${guildId}）`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`KOOK Endpoint ${this.$id} 授予角色失败:`, error);
      throw error;
    }
  }

  /**
   * 撤销用户角色
   * @param guildId 服务器ID
   * @param userId 用户ID
   * @param roleId 角色ID
   */
  async revokeRole(guildId: string, userId: string, roleId: string): Promise<boolean> {
    try {
      const member = this.pickGuildMember(guildId, userId);
      const result = await member.revoke(roleId);
      this.pluginLogger.info(`KOOK Endpoint ${this.$id} 撤销用户 ${userId} 角色 ${roleId}（服务器 ${guildId}）`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`KOOK Endpoint ${this.$id} 撤销角色失败:`, error);
      throw error;
    }
  }

  /**
   * 设置用户昵称
   * @param guildId 服务器ID
   * @param userId 用户ID
   * @param nickname 新昵称
   */
  async setNickname(guildId: string, userId: string, nickname: string): Promise<boolean> {
    try {
      const member = this.pickGuildMember(guildId, userId);
      const result = await member.setNickname(nickname);
      this.pluginLogger.info(`KOOK Endpoint ${this.$id} 设置用户 ${userId} 昵称为 "${nickname}"（服务器 ${guildId}）`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`KOOK Endpoint ${this.$id} 设置昵称失败:`, error);
      throw error;
    }
  }

  /**
   * 获取服务器角色列表
   * @param guildId 服务器ID
   */
  async getRoleList(guildId: string): Promise<Guild.Role[]> {
    try {
      const guild = this.pickGuild(guildId);
      return await guild.getRoleList();
    } catch (error) {
      this.pluginLogger.error(`KOOK Endpoint ${this.$id} 获取角色列表失败:`, error);
      throw error;
    }
  }

  /**
   * 创建角色
   * @param guildId 服务器ID
   * @param name 角色名称
   */
  async createRole(guildId: string, name: string): Promise<Guild.Role> {
    try {
      const guild = this.pickGuild(guildId);
      const role = await guild.createRole(name);
      this.pluginLogger.info(`KOOK Endpoint ${this.$id} 创建角色 "${name}"（服务器 ${guildId}）`);
      return role;
    } catch (error) {
      this.pluginLogger.error(`KOOK Endpoint ${this.$id} 创建角色失败:`, error);
      throw error;
    }
  }

  /**
   * 删除角色
   * @param guildId 服务器ID
   * @param roleId 角色ID
   */
  async deleteRole(guildId: string, roleId: string): Promise<boolean> {
    try {
      const guild = this.pickGuild(guildId);
      const result = await guild.deleteRole(roleId);
      this.pluginLogger.info(`KOOK Endpoint ${this.$id} 删除角色 ${roleId}（服务器 ${guildId}）`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`KOOK Endpoint ${this.$id} 删除角色失败:`, error);
      throw error;
    }
  }

  /**
   * 获取服务器成员列表
   * @param guildId 服务器ID
   * @param channelId 可选的频道ID
   */
  async getGuildMembers(guildId: string, channelId?: string): Promise<User.Info[]> {
    try {
      return await this.getGuildUserList(guildId, channelId);
    } catch (error) {
      this.pluginLogger.error(`KOOK Endpoint ${this.$id} 获取成员列表失败:`, error);
      throw error;
    }
  }
  private buildAtElement(userId: string | number): MessageElement {
    const id = String(userId);
    return { type: 'at', data: { id, user_id: id, qq: id } };
  }

  private resolveAtUserId(data: Record<string, unknown>): string {
    const raw = data.user_id ?? data.qq ?? data.id;
    return raw == null ? '' : String(raw);
  }

  private parseMarkdown(content: string): MessageElement[] {
    const elements: MessageElement[] = [];
    
    // KMarkdown 图片格式: ![alt](url)
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    // KMarkdown @提及格式: (met)userId(met) 或 @用户名
    const mentionRegex = /\(met\)(\d+)\(met\)|@([^\s]+)/g;
    // KMarkdown 表情格式: (emj)表情名(emj)[表情ID]
    const emojiRegex = /\(emj\)([^(]+)\(emj\)\[([^\]]+)\]/g;
    // KMarkdown 频道格式: (chn)channelId(chn)
    const channelRegex = /\(chn\)(\d+)\(chn\)/g;

    let lastIndex = 0;
    const matches: Array<{ index: number; length: number; element: MessageElement }> = [];

    // 解析图片
    let match: RegExpExecArray | null;
    while ((match = imageRegex.exec(content)) !== null) {
      matches.push({
        index: match.index,
        length: match[0].length,
        element: { type: "image", data: { url: match[2], alt: match[1] } }
      });
    }

    // 解析 @提及
    while ((match = mentionRegex.exec(content)) !== null) {
      const userId = match[1] || match[2];
      matches.push({
        index: match.index,
        length: match[0].length,
        element: this.buildAtElement(userId),
      });
    }

    // 解析表情
    while ((match = emojiRegex.exec(content)) !== null) {
      matches.push({
        index: match.index,
        length: match[0].length,
        element: { type: "face", data: { id: match[2], name: match[1] } }
      });
    }

    // 解析频道引用
    while ((match = channelRegex.exec(content)) !== null) {
      matches.push({
        index: match.index,
        length: match[0].length,
        element: { type: "text", data: { text: `#频道:${match[1]}` } }
      });
    }

    // 按位置排序
    matches.sort((a, b) => a.index - b.index);

    // 组装消息段
    for (const match of matches) {
      // 添加之前的文本
      if (match.index > lastIndex) {
        const text = content.slice(lastIndex, match.index);
        if (text) {
          elements.push({ type: "text", data: { text } });
        }
      }

      // 添加特殊元素
      elements.push(match.element);
      lastIndex = match.index + match.length;
    }

    // 添加剩余文本
    if (lastIndex < content.length) {
      const text = content.slice(lastIndex);
      if (text) {
        elements.push({ type: "text", data: { text } });
      }
    }

    // 如果没有解析到任何特殊元素，返回纯文本
    if (elements.length === 0) {
      elements.push({ type: "text", data: { text: content } });
    }

    return elements;
  }
  /**
   * 将 kook-client 的 MessageSegment[] 转换为 Zhin 的 MessageElement[]
   */
  private parseMessageContent(segments: MessageSegment[]): MessageElement[] {
    const elements: MessageElement[] = [];
    
    for (const segment of segments) {
      switch (segment.type) {
        case "markdown":
          // 检查是否包含特殊语法，如果是纯文本则直接转换
          if (this.hasKMarkdownSyntax(segment.text)) {
            elements.push(...this.parseMarkdown(segment.text));
          } else {
            elements.push({ type: "text", data: { text: segment.text } });
          }
          break;
          
        case "text":
          elements.push({ type: "text", data: { text: segment.text } });
          break;
          
        case "at":
          elements.push(this.buildAtElement(segment.user_id));
          break;
          
        case "image":
          elements.push({ 
            type: "image", 
            data: { url: segment.url, alt: segment.title || "图片" } 
          });
          break;
          
        case "video":
          elements.push({ type: "video", data: { url: segment.url } });
          break;
          
        case "audio":
          elements.push({ type: "audio", data: { url: segment.url } });
          break;
          
        case "file":
          elements.push({ 
            type: "file", 
            data: { url: segment.url, name: segment.name } 
          });
          break;
          
        case "reply":
          elements.push({ type: "reply", data: { id: segment.id } });
          break;
          
        case "card":
          // Card 消息暂不支持，转为提示文本
          elements.push({ type: "text", data: { text: "[卡片消息]" } });
          break;
          
        default:
          this.pluginLogger.warn(`未知的 KOOK 消息段类型: ${(segment as any).type}`);
          break;
      }
    }
    
    return elements.length > 0 ? elements : [{ type: "text", data: { text: "" } }];
  }
  
  /**
   * 检查文本是否包含 KMarkdown 特殊语法
   */
  private hasKMarkdownSyntax(text: string): boolean {
    return /!\[.*?\]\(.*?\)|\(met\)|\(emj\)|\(chn\)|@\S+/.test(text);
  }

  /**
   * 连接到 KOOK
   */
  async $connect(): Promise<void> {
    try {
      await this.connect();
      this.$connected = true;
      const selfId = (this as { self_id?: string | number }).self_id;
      if (selfId != null) {
        this.$platformUserId = String(selfId);
      }
      this.pluginLogger.info(
        `KOOK Endpoint ${this.$id} 连接成功`
        + (this.$platformUserId ? ` (platform_user_id=${this.$platformUserId})` : ''),
      );
    } catch (error) {
      this.pluginLogger.error(`KOOK Endpoint ${this.$id} 连接失败:`, error);
      throw error;
    }
  }

  /**
 * 断开连接
 */
  async $disconnect(): Promise<void> {
    try {
      const receiver = this.receiver as import("node:events").EventEmitter;
      receiver.off("event", this.onGatewayEvent);
      this.inboundDeduper.clear();
      (this as unknown as import('node:events').EventEmitter).removeAllListeners();
      await this.disconnect();
      this.$connected = false;
      this.pluginLogger.info(`KOOK Endpoint ${this.$id} 已断开连接`);
    } catch (error) {
      this.pluginLogger.error(`KOOK Endpoint ${this.$id} 断开连接失败:`, error);
      throw error;
    }
  }

  /**
   * 上传媒体（覆盖 kook-client：其 FormData.append 不接受 Node Buffer）
   */
  override async uploadMedia(data: string | Buffer): Promise<string> {
    return uploadKookAsset(this.request, data);
  }

  /**
 * 发送消息
 */
  async $sendMessage(options: SendOptions): Promise<string> {
    try {
      const { id, type, content } = options;

      const elements = await materializeOutboundMedia(this, content);
      const kookContent = convertToKookSendable(
        elements,
        (els) => this.convertToKookFormat(els),
      );

      // 根据消息类型发送
      let result: any;
      if (type === "private") {
        result = await (this as any).sendPrivateMsg(id, kookContent);
      } else {
        result = await (this as any).sendChannelMsg(id, kookContent);
      }

      const route = routeFromSendType(type);
      return encodeKookMsgRef(route, String(result?.msg_id ?? ''));
    } catch (error) {
      this.pluginLogger.error(`KOOK Endpoint ${this.$id} 发送消息失败:`, error);
      throw error;
    }
  }

  /**
   * 撤回消息。支持 `kook:channel:msgId` 出站 ref，或入站 plain msgId + route/sceneType 提示。
   */
  async $recallMessage(
    messageIdOrRef: string,
    hint?: { route?: KookMsgRoute; sceneType?: 'private' | 'group' | 'channel' },
  ): Promise<void> {
    const { route: encodedRoute, msgId } = parseKookMsgRef(messageIdOrRef);
    const routeHint = encodedRoute ?? hint?.route ?? routeFromSceneType(hint?.sceneType);
    try {
      await this.deleteKookMsg(msgId, routeHint);
      this.pluginLogger.debug(
        `KOOK Endpoint ${this.$id} 撤回消息 (${routeHint ?? 'auto'}): ${msgId}`,
      );
    } catch (error) {
      this.pluginLogger.error(`KOOK Endpoint ${this.$id} 撤回消息失败:`, error);
      throw error;
    }
  }

  private async deleteKookMsg(msgId: string, routeHint?: KookMsgRoute): Promise<void> {
    const routes = resolveKookRoutes('delete', routeHint);
    let lastError: unknown;

    for (const route of routes) {
      try {
        const result = await this.request.post(
          kookDeleteApiPath(route),
          { msg_id: msgId },
        ) as { code?: number };
        if (shouldStopDeleteAfterResponse(result, routes.length)) return;
      } catch (err) {
        if (isKookMsgGoneError(err)) return;
        lastError = err;
      }
    }

    return;
  }

  /**
   * 为消息添加表情回应（TypingIndicator reaction 模式）
   * @returns reactionId（含 channel/direct 路由），供 $removeReaction 使用
   */
  async $addReaction(
    messageId: string,
    emoji: string,
    hint?: { sceneType?: 'private' | 'group' | 'channel' },
  ): Promise<string> {
    const msgId = plainKookMsgId(messageId);
    const route = await this.mutateMsgReaction(
      msgId,
      emoji,
      'add',
      routeFromSceneType(hint?.sceneType),
    );
    return encodeKookReactionId(route, msgId, emoji);
  }

  /** 移除本 Endpoint 在消息上的表情回应 */
  async $removeReaction(messageId: string, reactionId: string): Promise<void> {
    const { route, emoji } = parseKookReactionId(reactionId);
    await this.mutateMsgReaction(plainKookMsgId(messageId), emoji, 'delete', route);
  }

  private async mutateMsgReaction(
    msgId: string,
    emoji: string,
    action: 'add' | 'delete',
    routeHint?: KookMsgRoute,
  ): Promise<KookMsgRoute> {
    const routes = resolveKookRoutes(action, routeHint);
    const body = { msg_id: msgId, emoji };
    let lastError: unknown;

    for (const route of routes) {
      try {
        const result = await this.request.post(
          kookReactionApiPath(route, action),
          body,
        ) as { code?: number };
        if (isKookApiSuccess(result)) {
          this.pluginLogger.debug(
            `KOOK Endpoint ${this.$id} ${action} reaction (${route}) on ${msgId}`,
          );
          return route;
        }
        if (action === 'delete' && shouldStopDeleteAfterResponse(result, routes.length)) {
          const label = isKookApiGoneResult(result) ? 'already gone' : 'done';
          this.pluginLogger.debug(
            `KOOK Endpoint ${this.$id} delete reaction ${label} (${route}) on ${msgId}`,
          );
          return route;
        }
      } catch (err) {
        if (action === 'delete' && isKookMsgGoneError(err)) {
          this.pluginLogger.debug(
            `KOOK Endpoint ${this.$id} delete reaction already gone (${route}) on ${msgId}`,
          );
          return route;
        }
        lastError = err;
      }
    }

    if (action === 'delete') {
      this.pluginLogger.debug(
        `KOOK Endpoint ${this.$id} delete reaction noop on ${msgId}`,
      );
      return routeHint ?? 'channel';
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`KOOK ${action} reaction failed (msg_id=${msgId})`);
  }

  /**
 * 将消息段转换为 KOOK KMarkdown 格式
 * 支持：文本、图片、@提及、表情、引用等
 */
  private convertToKookFormat(content: MessageElement[]): string {
    return content
      .map((el) => {
        switch (el.type) {
          case "text":
            // 纯文本，转义特殊字符
            return el.data.text.replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&');

          case "image":
            // 图片：![alt](url)
            return `![${el.data.alt || '图片'}](${el.data.url || el.data.file})`;

          case "at": {
            const atId = this.resolveAtUserId(el.data as Record<string, unknown>);
            if (atId === 'all') {
              return '(met)all(met)';
            }
            return `(met)${atId}(met)`;
          }

          case "face":
            // 表情：(emj)表情名(emj)[表情ID]
            return `(emj)${el.data.name || 'emoji'}(emj)[${el.data.id}]`;

          case "reply":
            // 引用消息（KOOK 使用 quote 参数，不在消息内容中）
            return "";

          case "video":
            // 视频：使用链接形式
            return `[视频](${el.data.url || el.data.file})`;

          case "audio":
            // 音频：使用链接形式
            return `[音频](${el.data.url || el.data.file})`;

          case "file":
            // 文件：使用链接形式
            return `[文件: ${el.data.name || '未命名'}](${el.data.url || el.data.file})`;

          case "link":
            // 链接：[文本](url)
            return `[${el.data.text || el.data.url}](${el.data.url})`;

          case "bold":
            // 粗体：**文本**
            return `**${el.data.text}**`;

          case "italic":
            // 斜体：*文本*
            return `*${el.data.text}*`;

          case "code":
            // 行内代码：`代码`
            return `\`${el.data.text}\``;

          case "code_block":
            // 代码块：```语言\n代码\n```
            return `\`\`\`${el.data.language || ''}\n${el.data.text}\n\`\`\``;

          default:
            // 未知类型，尝试转换为文本
            this.pluginLogger.warn(`未知的消息段类型: ${el.type}`);
            return el.data.text || JSON.stringify(el.data);
        }
      })
      .filter(Boolean)
      .join("");
  }
}
