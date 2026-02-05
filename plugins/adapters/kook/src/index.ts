import { 
  Client, 
  LogLevel, 
  PrivateMessageEvent, 
  ChannelMessageEvent, 
  MessageSegment,
  User,
  Guild,
  GuildMember,
  parseGroupId,
} from "kook-client";
import path from "path";
import {
  Bot,
  Adapter,
  Plugin,
  Message,
  SendOptions,
  SendContent,
  MessageElement,
  segment,
  usePlugin,
  MessageType,
  Tool,
  ToolPermissionLevel,
} from "zhin.js";

// 类型扩展
declare module "zhin.js" {
  interface Adapters {
    kook: KookAdapter;
  }
}

// KOOK 用户权限枚举
export enum KookPermission {
  Normal = 1,
  Admin = 2,
  Owner = 4,
  ChannelAdmin = 5,
}

// 扩展消息类型，包含更多发送者信息
export interface KookSenderInfo {
  id: string;
  name: string;
  /** KOOK 权限级别 */
  permission?: KookPermission;
  /** 用户角色列表 */
  roles?: number[];
  /** 是否为服务器主人 */
  isGuildOwner?: boolean;
  /** 是否为管理员 */
  isAdmin?: boolean;
}

// KOOK 配置接口
export interface KookBotConfig {
  context: "kook";
  name: string;
  token: string;
  data_dir?: string;
  timeout?: number;
  max_retry?: number;
  ignore?: "bot" | "self";
  logLevel?: LogLevel;
}

// KOOK 原始消息类型（实际是 kook-client 的 MessageEvent）
type KookRawMessage = PrivateMessageEvent | ChannelMessageEvent;

const plugin = usePlugin();
const { provide } = plugin;
const logger = plugin.logger;

/**
 * KOOK Bot 实现
 */
export class KookBot extends Client implements Bot<KookBotConfig, KookRawMessage> {
  $connected: boolean = false;
  adapter: KookAdapter;

  get $id(): string {
    return this.$config.name;
  }

  constructor(adapter: KookAdapter, public $config: KookBotConfig) {
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
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 监听消息事件
    this.on("message", (msg: KookRawMessage) => {
      try {
        const message = this.$formatMessage(msg);
        logger.debug(`KOOK 格式化消息: $content=${JSON.stringify(message.$content)}, $raw=${message.$raw}`);
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
        logger.error(`处理 KOOK 消息失败:`, error);
      }
    });

    // 监听连接事件
    this.on("connect" as any, () => {
      this.$connected = true;
      logger.info(`KOOK Bot ${this.$id} 已连接`);
    });

    // 监听断开事件
    this.on("disconnect" as any, () => {
      this.$connected = false;
      logger.warn(`KOOK Bot ${this.$id} 已断开`);
    });

    // 监听错误事件
    this.on("error" as any, (error: Error) => {
      logger.error(`KOOK Bot ${this.$id} 错误:`, error);
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
      $bot: this.$id,
      
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
        await this.$recallMessage(message.$id);
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
          bot: this.$id,
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
      logger.info(`KOOK Bot ${this.$id} 踢出用户 ${userId} 从服务器 ${guildId}`);
      return result;
    } catch (error) {
      logger.error(`KOOK Bot ${this.$id} 踢出用户失败:`, error);
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
      logger.info(`KOOK Bot ${this.$id} 将用户 ${userId} 加入黑名单（服务器 ${guildId}）`);
      return result;
    } catch (error) {
      logger.error(`KOOK Bot ${this.$id} 加入黑名单失败:`, error);
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
      logger.info(`KOOK Bot ${this.$id} 将用户 ${userId} 从黑名单移除（服务器 ${guildId}）`);
      return result;
    } catch (error) {
      logger.error(`KOOK Bot ${this.$id} 移除黑名单失败:`, error);
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
      logger.info(`KOOK Bot ${this.$id} 授予用户 ${userId} 角色 ${roleId}（服务器 ${guildId}）`);
      return result;
    } catch (error) {
      logger.error(`KOOK Bot ${this.$id} 授予角色失败:`, error);
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
      logger.info(`KOOK Bot ${this.$id} 撤销用户 ${userId} 角色 ${roleId}（服务器 ${guildId}）`);
      return result;
    } catch (error) {
      logger.error(`KOOK Bot ${this.$id} 撤销角色失败:`, error);
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
      logger.info(`KOOK Bot ${this.$id} 设置用户 ${userId} 昵称为 "${nickname}"（服务器 ${guildId}）`);
      return result;
    } catch (error) {
      logger.error(`KOOK Bot ${this.$id} 设置昵称失败:`, error);
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
      logger.error(`KOOK Bot ${this.$id} 获取角色列表失败:`, error);
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
      logger.info(`KOOK Bot ${this.$id} 创建角色 "${name}"（服务器 ${guildId}）`);
      return role;
    } catch (error) {
      logger.error(`KOOK Bot ${this.$id} 创建角色失败:`, error);
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
      logger.info(`KOOK Bot ${this.$id} 删除角色 ${roleId}（服务器 ${guildId}）`);
      return result;
    } catch (error) {
      logger.error(`KOOK Bot ${this.$id} 删除角色失败:`, error);
      throw error;
    }
  }

  /**
   * 获取黑名单列表
   * @param guildId 服务器ID
   */
  async getBlacklist(guildId: string): Promise<Guild.BlackInfo[]> {
    try {
      return await this.getBlacklist(guildId);
    } catch (error) {
      logger.error(`KOOK Bot ${this.$id} 获取黑名单失败:`, error);
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
      logger.error(`KOOK Bot ${this.$id} 获取成员列表失败:`, error);
      throw error;
    }
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
        element: { type: "at", data: { id: userId } }
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
          elements.push({ type: "at", data: { id: segment.user_id } });
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
          logger.warn(`未知的 KOOK 消息段类型: ${(segment as any).type}`);
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
      logger.info(`KOOK Bot ${this.$id} 连接成功`);
    } catch (error) {
      logger.error(`KOOK Bot ${this.$id} 连接失败:`, error);
      throw error;
    }
  }

  /**
 * 断开连接
 */
  async $disconnect(): Promise<void> {
    try {
      await this.disconnect();
      this.$connected = false;
      logger.info(`KOOK Bot ${this.$id} 已断开连接`);
    } catch (error) {
      logger.error(`KOOK Bot ${this.$id} 断开连接失败:`, error);
      throw error;
    }
  }

  /**
 * 发送消息
 */
  async $sendMessage(options: SendOptions): Promise<string> {
    try {
      const { id, type, content } = options;

      // 将消息段转换为 KOOK 格式
      const elements: MessageElement[] = Array.isArray(content)
        ? content.map(el => typeof el === 'string' ? { type: 'text' as const, data: { text: el } } : el)
        : [typeof content === 'string' ? { type: 'text' as const, data: { text: content } } : content];

      const kookContent = this.convertToKookFormat(elements);

      // 根据消息类型发送
      let result: any;
      if (type === "private") {
        result = await (this as any).sendPrivateMsg(id, kookContent);
      } else {
        result = await (this as any).sendChannelMsg(id, kookContent);
      }

      return result?.msg_id || "";
    } catch (error) {
      logger.error(`KOOK Bot ${this.$id} 发送消息失败:`, error);
      throw error;
    }
  }

  /**
 * 撤回消息
   */
  async $recallMessage(messageId: string): Promise<void> {
    try {
      await (this as any).deleteMsg(messageId);
      logger.debug(`KOOK Bot ${this.$id} 撤回消息: ${messageId}`);
    } catch (error) {
      logger.error(`KOOK Bot ${this.$id} 撤回消息失败:`, error);
      throw error;
    }
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

          case "at":
            // @提及：(met)userId(met) 或 @all
            if (el.data.id === "all") {
              return "(met)all(met)";
            }
            return `(met)${el.data.id}(met)`;

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
            logger.warn(`未知的消息段类型: ${el.type}`);
            return el.data.text || JSON.stringify(el.data);
        }
      })
      .filter(Boolean)
      .join("");
  }
}

/**
 * KOOK 适配器
 */
export class KookAdapter extends Adapter<KookBot> {
  constructor(plugin: Plugin) {
    super(plugin, "kook", []);
  }

  createBot(config: KookBotConfig): KookBot {
    const bot = new KookBot(this, config);
    this.bots.set(bot.$id, bot);
    return bot;
  }

  async start(): Promise<void> {
    // 注册 KOOK 特有的管理工具
    this.registerKookTools();
    logger.info("KOOK 适配器已启动");
  }

  async stop(): Promise<void> {
    // 断开所有 bot 连接
    for (const bot of this.bots.values()) {
      await bot.$disconnect();
    }
    logger.info("KOOK 适配器已停止");
  }

  /**
   * 注册 KOOK 平台特有的管理工具
   * 这些工具仅在 KOOK 平台可用，且需要相应权限
   */
  private registerKookTools(): void {
    // 踢出用户工具
    this.addTool({
      name: 'kook_kick_user',
      description: '将用户踢出 KOOK 服务器（需要管理员或服务器主人权限）',
      parameters: {
        type: 'object',
        properties: {
          bot: {
            type: 'string',
            description: 'Bot 名称',
          },
          guild_id: {
            type: 'string',
            description: '服务器 ID',
          },
          user_id: {
            type: 'string',
            description: '要踢出的用户 ID',
          },
        },
        required: ['bot', 'guild_id', 'user_id'],
      },
      platforms: ['kook'],
      scopes: ['channel'],
      permissionLevel: 'group_admin',
      execute: async (args, context) => {
        const { bot: botId, guild_id, user_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        // 权限检查
        this.checkPermission(context, 'group_admin');
        
        const success = await bot.kickUser(guild_id, user_id);
        return { success, message: success ? `已将用户 ${user_id} 踢出服务器` : '踢出失败' };
      },
    });

    // 黑名单管理工具
    this.addTool({
      name: 'kook_ban_user',
      description: '将用户加入 KOOK 服务器黑名单（封禁用户，需要管理员权限）',
      parameters: {
        type: 'object',
        properties: {
          bot: {
            type: 'string',
            description: 'Bot 名称',
          },
          guild_id: {
            type: 'string',
            description: '服务器 ID',
          },
          user_id: {
            type: 'string',
            description: '要封禁的用户 ID',
          },
          remark: {
            type: 'string',
            description: '封禁原因/备注（可选）',
          },
          del_msg_days: {
            type: 'number',
            description: '删除该用户最近几天的消息（0-7，可选）',
          },
        },
        required: ['bot', 'guild_id', 'user_id'],
      },
      platforms: ['kook'],
      scopes: ['channel'],
      permissionLevel: 'group_admin',
      execute: async (args, context) => {
        const { bot: botId, guild_id, user_id, remark, del_msg_days } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_admin');
        
        const success = await bot.addToBlacklist(guild_id, user_id, remark, del_msg_days);
        return { 
          success, 
          message: success ? `已将用户 ${user_id} 加入黑名单${remark ? `，原因：${remark}` : ''}` : '封禁失败' 
        };
      },
    });

    // 解除封禁工具
    this.addTool({
      name: 'kook_unban_user',
      description: '将用户从 KOOK 服务器黑名单移除（解除封禁）',
      parameters: {
        type: 'object',
        properties: {
          bot: {
            type: 'string',
            description: 'Bot 名称',
          },
          guild_id: {
            type: 'string',
            description: '服务器 ID',
          },
          user_id: {
            type: 'string',
            description: '要解封的用户 ID',
          },
        },
        required: ['bot', 'guild_id', 'user_id'],
      },
      platforms: ['kook'],
      scopes: ['channel'],
      permissionLevel: 'group_admin',
      execute: async (args, context) => {
        const { bot: botId, guild_id, user_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_admin');
        
        const success = await bot.removeFromBlacklist(guild_id, user_id);
        return { success, message: success ? `已将用户 ${user_id} 从黑名单移除` : '解封失败' };
      },
    });

    // 角色管理工具 - 授予角色
    this.addTool({
      name: 'kook_grant_role',
      description: '给用户授予 KOOK 服务器角色',
      parameters: {
        type: 'object',
        properties: {
          bot: {
            type: 'string',
            description: 'Bot 名称',
          },
          guild_id: {
            type: 'string',
            description: '服务器 ID',
          },
          user_id: {
            type: 'string',
            description: '用户 ID',
          },
          role_id: {
            type: 'string',
            description: '角色 ID',
          },
        },
        required: ['bot', 'guild_id', 'user_id', 'role_id'],
      },
      platforms: ['kook'],
      scopes: ['channel'],
      permissionLevel: 'group_admin',
      execute: async (args, context) => {
        const { bot: botId, guild_id, user_id, role_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_admin');
        
        const success = await bot.grantRole(guild_id, user_id, role_id);
        return { success, message: success ? `已授予用户 ${user_id} 角色 ${role_id}` : '授予角色失败' };
      },
    });

    // 角色管理工具 - 撤销角色
    this.addTool({
      name: 'kook_revoke_role',
      description: '撤销用户的 KOOK 服务器角色',
      parameters: {
        type: 'object',
        properties: {
          bot: {
            type: 'string',
            description: 'Bot 名称',
          },
          guild_id: {
            type: 'string',
            description: '服务器 ID',
          },
          user_id: {
            type: 'string',
            description: '用户 ID',
          },
          role_id: {
            type: 'string',
            description: '角色 ID',
          },
        },
        required: ['bot', 'guild_id', 'user_id', 'role_id'],
      },
      platforms: ['kook'],
      scopes: ['channel'],
      permissionLevel: 'group_admin',
      execute: async (args, context) => {
        const { bot: botId, guild_id, user_id, role_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_admin');
        
        const success = await bot.revokeRole(guild_id, user_id, role_id);
        return { success, message: success ? `已撤销用户 ${user_id} 的角色 ${role_id}` : '撤销角色失败' };
      },
    });

    // 设置昵称工具
    this.addTool({
      name: 'kook_set_nickname',
      description: '设置用户在 KOOK 服务器中的昵称',
      parameters: {
        type: 'object',
        properties: {
          bot: {
            type: 'string',
            description: 'Bot 名称',
          },
          guild_id: {
            type: 'string',
            description: '服务器 ID',
          },
          user_id: {
            type: 'string',
            description: '用户 ID',
          },
          nickname: {
            type: 'string',
            description: '新昵称',
          },
        },
        required: ['bot', 'guild_id', 'user_id', 'nickname'],
      },
      platforms: ['kook'],
      scopes: ['channel'],
      permissionLevel: 'group_admin',
      execute: async (args, context) => {
        const { bot: botId, guild_id, user_id, nickname } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_admin');
        
        const success = await bot.setNickname(guild_id, user_id, nickname);
        return { success, message: success ? `已将用户 ${user_id} 的昵称设置为 "${nickname}"` : '设置昵称失败' };
      },
    });

    // 获取角色列表工具
    this.addTool({
      name: 'kook_list_roles',
      description: '获取 KOOK 服务器的角色列表',
      parameters: {
        type: 'object',
        properties: {
          bot: {
            type: 'string',
            description: 'Bot 名称',
          },
          guild_id: {
            type: 'string',
            description: '服务器 ID',
          },
        },
        required: ['bot', 'guild_id'],
      },
      platforms: ['kook'],
      scopes: ['channel'],
      permissionLevel: 'user', // 普通用户可查看
      execute: async (args) => {
        const { bot: botId, guild_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        const roles = await bot.getRoleList(guild_id);
        return { 
          roles: roles.map(r => ({
            id: r.role_id,
            name: r.name,
            color: r.color,
            position: r.position,
            permissions: r.permissions,
          })),
          count: roles.length,
        };
      },
    });

    // 创建角色工具
    this.addTool({
      name: 'kook_create_role',
      description: '在 KOOK 服务器中创建新角色（需要服务器主人权限）',
      parameters: {
        type: 'object',
        properties: {
          bot: {
            type: 'string',
            description: 'Bot 名称',
          },
          guild_id: {
            type: 'string',
            description: '服务器 ID',
          },
          name: {
            type: 'string',
            description: '角色名称',
          },
        },
        required: ['bot', 'guild_id', 'name'],
      },
      platforms: ['kook'],
      scopes: ['channel'],
      permissionLevel: 'group_owner',
      execute: async (args, context) => {
        const { bot: botId, guild_id, name } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_owner');
        
        const role = await bot.createRole(guild_id, name);
        return { 
          success: true, 
          message: `已创建角色 "${name}"`,
          role: {
            id: role.role_id,
            name: role.name,
          },
        };
      },
    });

    // 删除角色工具
    this.addTool({
      name: 'kook_delete_role',
      description: '删除 KOOK 服务器中的角色（需要服务器主人权限）',
      parameters: {
        type: 'object',
        properties: {
          bot: {
            type: 'string',
            description: 'Bot 名称',
          },
          guild_id: {
            type: 'string',
            description: '服务器 ID',
          },
          role_id: {
            type: 'string',
            description: '角色 ID',
          },
        },
        required: ['bot', 'guild_id', 'role_id'],
      },
      platforms: ['kook'],
      scopes: ['channel'],
      permissionLevel: 'group_owner',
      execute: async (args, context) => {
        const { bot: botId, guild_id, role_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_owner');
        
        const success = await bot.deleteRole(guild_id, role_id);
        return { success, message: success ? `已删除角色 ${role_id}` : '删除角色失败' };
      },
    });

    // 获取成员列表工具
    this.addTool({
      name: 'kook_list_members',
      description: '获取 KOOK 服务器或频道的成员列表',
      parameters: {
        type: 'object',
        properties: {
          bot: {
            type: 'string',
            description: 'Bot 名称',
          },
          guild_id: {
            type: 'string',
            description: '服务器 ID',
          },
          channel_id: {
            type: 'string',
            description: '频道 ID（可选，不填则获取整个服务器成员）',
          },
        },
        required: ['bot', 'guild_id'],
      },
      platforms: ['kook'],
      scopes: ['channel'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, guild_id, channel_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        const members = await bot.getGuildMembers(guild_id, channel_id);
        return { 
          members: members.map(m => ({
            id: m.id,
            username: m.username,
            nickname: m.nickname,
            avatar: m.avatar,
            roles: m.roles,
          })),
          count: members.length,
        };
      },
    });

    logger.debug('已注册 KOOK 平台管理工具');
  }

  /**
   * 检查执行上下文中的权限
   */
  private checkPermission(context: any, required: ToolPermissionLevel): void {
    if (!context?.message) return; // 无上下文时跳过检查（命令行调用）
    
    const sender = context.message.$sender as KookSenderInfo;
    if (!sender) return;
    
    const permissionLevels: Record<ToolPermissionLevel, number> = {
      'user': 0,
      'group_admin': 1,
      'group_owner': 2,
      'bot_admin': 3,
      'owner': 4,
    };
    
    // 获取发送者的实际权限级别
    let senderLevel: ToolPermissionLevel = 'user';
    
    if (sender.isGuildOwner || sender.permission === KookPermission.Owner) {
      senderLevel = 'group_owner';
    } else if (sender.isAdmin || sender.permission === KookPermission.Admin || 
               sender.permission === KookPermission.ChannelAdmin) {
      senderLevel = 'group_admin';
    }
    
    // TODO: 检查是否为 bot_admin 或 owner（需要从 zhin 配置中获取）
    
    if (permissionLevels[senderLevel] < permissionLevels[required]) {
      throw new Error(`权限不足：需要 ${required} 权限，当前为 ${senderLevel}`);
    }
  }
}

/**
 * 注册 KOOK 适配器
 */
provide({
  name: "kook",
  description: "KOOK Adapter",
  mounted: async (p: Plugin) => {
    const adapter = new KookAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: KookAdapter) => {
    await adapter.stop();
  },
});

logger.info("✅ KOOK 适配器已加载");
