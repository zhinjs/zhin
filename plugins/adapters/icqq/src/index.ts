import { Config, Client, PrivateMessageEvent, GroupMessageEvent, Sendable, MessageElem, MemberInfo, GroupRole } from "@icqqjs/icqq";
import path from "path";
import {
  Bot,
  usePlugin,
  Adapter,
  Plugin,
  Message,
  SendOptions,
  MessageSegment,
  SendContent,
  segment,
  Tool,
  ToolPermissionLevel,
} from "zhin.js";
import { Router } from "@zhin.js/http";

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      web: any;
      router: Router;
    }
  }
  
  interface Adapters {
    icqq: IcqqAdapter;
  }
}

// ICQQ 发送者权限信息
export interface IcqqSenderInfo {
  id: string;
  name: string;
  /** 群角色 */
  role?: GroupRole;
  /** 是否为群主 */
  isOwner?: boolean;
  /** 是否为管理员 */
  isAdmin?: boolean;
  /** 权限标识列表（供 inferSenderPermissions 使用） */
  permissions?: string[];
  /** 群名片 */
  card?: string;
  /** 头衔 */
  title?: string;
}

const plugin = usePlugin();
const { useContext } = plugin;

export interface IcqqBotConfig extends Config {
  context: "icqq";
  name: `${number}`;
  password?: string;
  scope?: string;
}

export interface IcqqBot {
  $config: IcqqBotConfig;
}

export class IcqqBot extends Client implements Bot<IcqqBotConfig, PrivateMessageEvent | GroupMessageEvent> {
  $connected: boolean = false;

  get $id() {
    return this.$config.name;
  }

  constructor(public adapter: IcqqAdapter, config: IcqqBotConfig) {
    if (!config.scope) config.scope = "icqqjs";
    if (!config.data_dir) config.data_dir = path.join(process.cwd(), "data");
    if (config.scope.startsWith("@")) config.scope = config.scope.slice(1);
    super(config);
    this.$config = config;
  }

  private handleIcqqMessage(msg: PrivateMessageEvent | GroupMessageEvent): void {
    const message = this.$formatMessage(msg);
    this.adapter.emit("message.receive", message);
    plugin.logger.debug(`${this.$config.name} recv  ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`);
  }

  async $connect(): Promise<void> {
    this.on("message", this.handleIcqqMessage.bind(this));
    this.on("system.login.device", async (e: unknown) => {
      await this.sendSmsCode();
      plugin.logger.info("请输入短信验证码:");
      process.stdin.once("data", (data) => {
        this.submitSmsCode(data.toString().trim());
      });
    });
    this.on("system.login.qrcode", (e) => {
      plugin.logger.info(`取码地址：${e.image}\n请扫码完成后回车继续:`);
      process.stdin.once("data", () => {
        this.login();
      });
    });
    this.on("system.login.slider", (e) => {
      plugin.logger.info(`取码地址：${e.url}\n请输入滑块验证ticket:`);
      process.stdin.once("data", (e) => {
        this.submitSlider(e.toString().trim());
      });
    });
    return new Promise((resolve) => {
      this.once("system.online", () => {
        this.$connected = true;
        resolve();
      });
      this.login(Number(this.$config.name), this.$config.password);
    });
  }

  async $disconnect(): Promise<void> {
    await this.logout();
    this.$connected = false;
  }

  $formatMessage(msg: PrivateMessageEvent | GroupMessageEvent) {
    // 获取发送者的权限信息
    const senderInfo = this.getSenderInfo(msg);
    
    const result = Message.from(msg, {
      $id: msg.message_id.toString(),
      $adapter: "icqq" as const,
      $bot: `${this.$config.name}`,
      $sender: senderInfo,
      $channel: {
        id: msg.message_type === "group" ? msg.group_id.toString() : msg.from_id.toString(),
        type: msg.message_type,
      },
      $content: IcqqBot.toSegments(msg.message),
      $raw: msg.raw_message,
      $timestamp: msg.time,
      $recall: async () => {
        await this.$recallMessage(result.$id);
      },
      $reply: async (content: SendContent, quote?: boolean | string): Promise<string> => {
        if (!Array.isArray(content)) content = [content];
        if (quote) content.unshift({ type: "reply", data: { id: typeof quote === "boolean" ? result.$id : quote } });
        return await this.adapter.sendMessage({
          ...result.$channel,
          context: "icqq",
          bot: `${this.uin}`,
          content,
        });
      },
    });
    return result;
  }

  /**
   * 获取发送者的详细权限信息
   */
  private getSenderInfo(msg: PrivateMessageEvent | GroupMessageEvent): IcqqSenderInfo {
    const senderInfo: IcqqSenderInfo = {
      id: msg.sender.user_id.toString(),
      name: msg.sender.nickname.toString(),
    };

    // 群消息才有权限信息
    if (msg.message_type === "group") {
      const groupMsg = msg as GroupMessageEvent;
      const sender = groupMsg.sender as any;
      
      if (sender.role) {
        senderInfo.role = sender.role;
        senderInfo.isOwner = sender.role === "owner";
        senderInfo.isAdmin = sender.role === "admin" || sender.role === "owner";
        // 设置 permissions 数组，供 inferSenderPermissions 使用
        const perms: string[] = [];
        if (sender.role === "owner") perms.push('owner', 'admin');
        else if (sender.role === "admin") perms.push('admin');
        senderInfo.permissions = perms;
      }
      
      if (sender.card) {
        senderInfo.card = sender.card;
      }
      
      if (sender.title) {
        senderInfo.title = sender.title;
      }
    }

    return senderInfo;
  }

  // ==================== 群管理 API ====================

  /**
   * 踢出群成员
   * @param groupId 群号
   * @param userId 用户QQ号
   * @param block 是否拉黑（加入黑名单）
   */
  async kickMember(groupId: number, userId: number, block?: boolean): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.kickMember(userId, undefined, block);
      plugin.logger.info(`ICQQ Bot ${this.$id} 踢出成员 ${userId} 从群 ${groupId}${block ? '（已拉黑）' : ''}`);
      return result;
    } catch (error) {
      plugin.logger.error(`ICQQ Bot ${this.$id} 踢出成员失败:`, error);
      throw error;
    }
  }

  /**
   * 禁言群成员
   * @param groupId 群号
   * @param userId 用户QQ号
   * @param duration 禁言时长（秒），0 表示解除禁言
   */
  async muteMember(groupId: number, userId: number, duration: number = 600): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.muteMember(userId, duration);
      plugin.logger.info(`ICQQ Bot ${this.$id} ${duration > 0 ? `禁言成员 ${userId} ${duration}秒` : `解除成员 ${userId} 禁言`}（群 ${groupId}）`);
      return result;
    } catch (error) {
      plugin.logger.error(`ICQQ Bot ${this.$id} 禁言操作失败:`, error);
      throw error;
    }
  }

  /**
   * 全员禁言
   * @param groupId 群号
   * @param enable 是否开启全员禁言
   */
  async muteAll(groupId: number, enable: boolean = true): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.muteAll(enable);
      plugin.logger.info(`ICQQ Bot ${this.$id} ${enable ? '开启' : '关闭'}全员禁言（群 ${groupId}）`);
      return result;
    } catch (error) {
      plugin.logger.error(`ICQQ Bot ${this.$id} 全员禁言操作失败:`, error);
      throw error;
    }
  }

  /**
   * 设置管理员
   * @param groupId 群号
   * @param userId 用户QQ号
   * @param enable 是否设为管理员
   */
  async setAdmin(groupId: number, userId: number, enable: boolean = true): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.setAdmin(userId, enable);
      plugin.logger.info(`ICQQ Bot ${this.$id} ${enable ? '设置' : '取消'}管理员 ${userId}（群 ${groupId}）`);
      return result;
    } catch (error) {
      plugin.logger.error(`ICQQ Bot ${this.$id} 设置管理员失败:`, error);
      throw error;
    }
  }

  /**
   * 设置群名片
   * @param groupId 群号
   * @param userId 用户QQ号
   * @param card 群名片
   */
  async setCard(groupId: number, userId: number, card: string): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.setCard(userId, card);
      plugin.logger.info(`ICQQ Bot ${this.$id} 设置成员 ${userId} 群名片为 "${card}"（群 ${groupId}）`);
      return result;
    } catch (error) {
      plugin.logger.error(`ICQQ Bot ${this.$id} 设置群名片失败:`, error);
      throw error;
    }
  }

  /**
   * 设置群头衔
   * @param groupId 群号
   * @param userId 用户QQ号
   * @param title 头衔
   * @param duration 持续时间（秒），-1 表示永久
   */
  async setTitle(groupId: number, userId: number, title: string, duration: number = -1): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.setTitle(userId, title, duration);
      plugin.logger.info(`ICQQ Bot ${this.$id} 设置成员 ${userId} 头衔为 "${title}"（群 ${groupId}）`);
      return result;
    } catch (error) {
      plugin.logger.error(`ICQQ Bot ${this.$id} 设置头衔失败:`, error);
      throw error;
    }
  }

  /**
   * 设置群名
   * @param groupId 群号
   * @param name 群名
   */
  async setGroupName(groupId: number, name: string): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.setName(name);
      plugin.logger.info(`ICQQ Bot ${this.$id} 设置群名为 "${name}"（群 ${groupId}）`);
      return result;
    } catch (error) {
      plugin.logger.error(`ICQQ Bot ${this.$id} 设置群名失败:`, error);
      throw error;
    }
  }

  /**
   * 发送群公告
   * @param groupId 群号
   * @param content 公告内容
   */
  async sendAnnounce(groupId: number, content: string): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.announce(content);
      plugin.logger.info(`ICQQ Bot ${this.$id} 发送群公告（群 ${groupId}）`);
      return result;
    } catch (error) {
      plugin.logger.error(`ICQQ Bot ${this.$id} 发送群公告失败:`, error);
      throw error;
    }
  }

  /**
   * 戳一戳
   * @param groupId 群号
   * @param userId 用户QQ号
   */
  async pokeMember(groupId: number, userId: number): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.pokeMember(userId);
      plugin.logger.info(`ICQQ Bot ${this.$id} 戳了戳 ${userId}（群 ${groupId}）`);
      return result;
    } catch (error) {
      plugin.logger.error(`ICQQ Bot ${this.$id} 戳一戳失败:`, error);
      throw error;
    }
  }

  /**
   * 获取群成员列表
   * @param groupId 群号
   */
  async getMemberList(groupId: number): Promise<Map<number, MemberInfo>> {
    try {
      const group = this.pickGroup(groupId);
      return await group.getMemberMap();
    } catch (error) {
      plugin.logger.error(`ICQQ Bot ${this.$id} 获取群成员列表失败:`, error);
      throw error;
    }
  }

  /**
   * 获取被禁言成员列表
   * @param groupId 群号
   */
  async getMutedMembers(groupId: number): Promise<any[]> {
    try {
      const group = this.pickGroup(groupId);
      return await group.getMuteMemberList();
    } catch (error) {
      plugin.logger.error(`ICQQ Bot ${this.$id} 获取禁言列表失败:`, error);
      throw error;
    }
  }

  /**
   * 允许/禁止匿名
   * @param groupId 群号
   * @param enable 是否允许匿名
   */
  async setAnonymous(groupId: number, enable: boolean = true): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.allowAnony(enable);
      plugin.logger.info(`ICQQ Bot ${this.$id} ${enable ? '开启' : '关闭'}匿名（群 ${groupId}）`);
      return result;
    } catch (error) {
      plugin.logger.error(`ICQQ Bot ${this.$id} 设置匿名失败:`, error);
      throw error;
    }
  }

  async getGroupFiles(groupId: number): Promise<any> {
    try {
      const group = this.pickGroup(groupId);
      return await group.fs.ls();
    } catch (error) {
      plugin.logger.error(`ICQQ Bot ${this.$id} 获取群文件列表失败:`, error);
      throw error;
    }
  }

  async $recallMessage(id: string): Promise<void> {
    await this.deleteMsg(id);
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    switch (options.type) {
      case "private": {
        const result = await this.sendPrivateMsg(Number(options.id), IcqqBot.toSendable(options.content));
        plugin.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
        return result.message_id.toString();
      }
      case "group": {
        const result = await this.sendGroupMsg(Number(options.id), IcqqBot.toSendable(options.content));
        plugin.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
        return result.message_id.toString();
      }
      default:
        throw new Error(`unsupported channel type ${options.type}`);
    }
  }
}

export namespace IcqqBot {
  const allowTypes = ["text", "face", "image", "record", "audio", "dice", "rps", "video", "file", "location", "share", "json", "at", "reply", "long_msg", "button", "markdown", "xml"];

  export function toSegments(message: Sendable): MessageSegment[] {
    if (!Array.isArray(message)) message = [message];
    return message
      .filter((item, index) => {
        return typeof item === "string" || item.type !== "long_msg" || index !== 0;
      })
      .map((item): MessageSegment => {
        if (typeof item === "string") return { type: "text", data: { text: item } };
        const { type, ...data } = item;
        return { type, data };
      });
  }

  export function toSendable(content: SendContent): Sendable {
    if (!Array.isArray(content)) content = [content];
    return content.map((seg): MessageElem => {
      if (typeof seg === "string") return { type: "text", text: seg };
      let { type, data } = seg;
      if (typeof type === "function") type = type.name;
      if (!allowTypes.includes(type)) return { type: "text", text: segment.toString(seg) };
      return { type, ...data } as MessageElem;
    });
  }
}

class IcqqAdapter extends Adapter<IcqqBot> {
  constructor(plugin: Plugin) {
    super(plugin, "icqq", []);
  }

  createBot(config: IcqqBotConfig): IcqqBot {
    return new IcqqBot(this, config);
  }

  async start(): Promise<void> {
    // 注册 ICQQ 特有的群管理工具
    this.registerIcqqTools();

    // 声明适配器 Skill：将所有工具聚合为一个语义化的 Skill
    this.declareSkill({
      description: 'ICQQ QQ群管理能力，包括成员管理（踢人、禁言、设管理员、改名片、设头衔）、群设置（改群名、发公告、全员禁言、匿名设置）、群查询（成员列表、禁言列表、群文件）、好友列表、互动（戳一戳）。',
      keywords: ['QQ', '群管理', '群聊', '群文件', '好友列表'],
      tags: ['qq', '群管理', '社交平台'],
      conventions: '用户和群均使用数字 QQ号标识。调用工具时 bot 参数应填当前上下文的 Bot ID，group_id 应填当前场景 ID。user_id 为要操作的目标成员 QQ号。',
    });

    await super.start();
  }

  /**
   * 注册 ICQQ 平台特有的群管理工具
   */
  private registerIcqqTools(): void {
    // 公共参数: 通过 contextKey 自动从上下文注入，对 AI 隐藏，避免小模型填错
    const CTX_BOT = { type: 'string' as const, description: '执行操作的 Bot QQ号', contextKey: 'botId' as const };
    const CTX_GROUP = { type: 'number' as const, description: '目标群号', contextKey: 'sceneId' as const };

    // 踢出成员工具
    this.addTool({
      name: 'icqq_kick_member',
      description: '将指定成员踢出 QQ 群聊，可选是否同时拉黑。需要 Bot 拥有管理员或群主权限。',
      tags: ['群管理', '成员管理', '踢人'],
      keywords: ['踢', '踢出', '移出', '移除', '请出', '踢出群', '踢人', '拉黑', 't人'],
      parameters: {
        type: 'object',
        properties: {
          bot: CTX_BOT,
          group_id: CTX_GROUP,
          user_id: {
            type: 'number',
            description: '要踢出的目标成员 QQ号',
          },
          block: {
            type: 'boolean',
            description: '是否同时拉黑（加入黑名单），默认 false',
          },
        },
        required: ['bot', 'group_id', 'user_id'],
      },
      platforms: ['icqq'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args, context) => {
        const { bot: botId, group_id, user_id, block } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_admin');
        
        const success = await bot.kickMember(group_id, user_id, block);
        return { 
          success, 
          message: success ? `已将 ${user_id} 踢出群${block ? '并拉黑' : ''}` : '踢出失败' 
        };
      },
    });

    // 禁言成员工具
    this.addTool({
      name: 'icqq_mute_member',
      description: '对 QQ 群中的指定成员执行禁言或解除禁言操作。可指定禁言时长，duration=0 表示解除禁言。需要 Bot 拥有管理员权限/群主权限，同时。',
      tags: ['群管理', '成员管理', '禁言'],
      keywords: ['禁言', '解除禁言', '取消禁言', '闭嘴', '封口', '解禁', '静音', '解除静音'],
      parameters: {
        type: 'object',
        properties: {
          bot: CTX_BOT,
          group_id: CTX_GROUP,
          user_id: {
            type: 'number',
            description: '要禁言的目标成员 QQ号',
          },
          duration: {
            type: 'number',
            description: '禁言时长（秒）。0=解除禁言，60=1分钟，3600=1小时，86400=1天。默认 600 秒（10分钟）',
          },
        },
        required: ['bot', 'group_id', 'user_id'],
      },
      platforms: ['icqq'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args, context) => {
        const { bot: botId, group_id, user_id, duration = 600 } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_admin');
        
        const success = await bot.muteMember(group_id, user_id, duration);
        return { 
          success, 
          message: success 
            ? (duration > 0 ? `已禁言 ${user_id} ${duration} 秒` : `已解除 ${user_id} 的禁言`) 
            : '操作失败' 
        };
      },
    });

    // 全员禁言工具
    this.addTool({
      name: 'icqq_mute_all',
      description: '开启或关闭 QQ 群的全员禁言模式。开启后所有普通成员无法发言，关闭后恢复正常。需要 Bot 拥有管理员权限。',
      tags: ['群管理', '群设置', '禁言'],
      keywords: ['全员禁言', '全体禁言', '全群禁言', '关闭全员禁言', '开启全员禁言', '解除全员禁言'],
      parameters: {
        type: 'object',
        properties: {
          bot: CTX_BOT,
          group_id: CTX_GROUP,
          enable: {
            type: 'boolean',
            description: 'true=开启全员禁言，false=关闭全员禁言，默认 true',
          },
        },
        required: ['bot', 'group_id'],
      },
      platforms: ['icqq'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args, context) => {
        const { bot: botId, group_id, enable = true } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_admin');
        
        const success = await bot.muteAll(group_id, enable);
        return { 
          success, 
          message: success ? (enable ? '已开启全员禁言' : '已关闭全员禁言') : '操作失败' 
        };
      },
    });

    // 设置管理员工具
    this.addTool({
      name: 'icqq_set_admin',
      description: '设置或取消 QQ 群管理员。只有群主才能操作。enable=true 授予管理员，enable=false 撤销管理员。',
      tags: ['群管理', '权限管理', '管理员'],
      keywords: ['管理员', '设管理', '取消管理', '撤销管理', '设置管理员', '取消管理员'],
      parameters: {
        type: 'object',
        properties: {
          bot: CTX_BOT,
          group_id: CTX_GROUP,
          user_id: {
            type: 'number',
            description: '目标成员 QQ号',
          },
          enable: {
            type: 'boolean',
            description: 'true=授予管理员，false=撤销管理员，默认 true',
          },
        },
        required: ['bot', 'group_id', 'user_id'],
      },
      platforms: ['icqq'],
      scopes: ['group'],
      permissionLevel: 'group_owner',
      execute: async (args, context) => {
        const { bot: botId, group_id, user_id, enable = true } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_owner');
        
        const success = await bot.setAdmin(group_id, user_id, enable);
        return { 
          success, 
          message: success ? (enable ? `已将 ${user_id} 设为管理员` : `已取消 ${user_id} 的管理员`) : '操作失败' 
        };
      },
    });

    // 设置群名片工具
    this.addTool({
      name: 'icqq_set_card',
      description: '修改 QQ 群中某个成员的群名片（备注名）。需要 Bot 拥有管理员权限。',
      tags: ['群管理', '成员管理', '群名片'],
      keywords: ['名片', '群名片', '备注', '改名', '改名片', '设置名片', '修改名片'],
      parameters: {
        type: 'object',
        properties: {
          bot: CTX_BOT,
          group_id: CTX_GROUP,
          user_id: {
            type: 'number',
            description: '目标成员 QQ号',
          },
          card: {
            type: 'string',
            description: '新的群名片内容',
          },
        },
        required: ['bot', 'group_id', 'user_id', 'card'],
      },
      platforms: ['icqq'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args, context) => {
        const { bot: botId, group_id, user_id, card } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_admin');
        
        const success = await bot.setCard(group_id, user_id, card);
        return { 
          success, 
          message: success ? `已将 ${user_id} 的群名片设为 "${card}"` : '设置失败' 
        };
      },
    });

    // 设置头衔工具
    this.addTool({
      name: 'icqq_set_title',
      description: '设置 QQ 群成员的专属头衔（显示在群昵称旁）。只有群主才能操作。可设置持续时间或永久。',
      tags: ['群管理', '成员管理', '头衔'],
      keywords: ['头衔', '专属头衔', '设置头衔', '给头衔', '加头衔', '称号'],
      parameters: {
        type: 'object',
        properties: {
          bot: CTX_BOT,
          group_id: CTX_GROUP,
          user_id: {
            type: 'number',
            description: '目标成员 QQ号',
          },
          title: {
            type: 'string',
            description: '头衔文字内容',
          },
          duration: {
            type: 'number',
            description: '持续时间（秒），-1 表示永久，默认永久',
          },
        },
        required: ['bot', 'group_id', 'user_id', 'title'],
      },
      platforms: ['icqq'],
      scopes: ['group'],
      permissionLevel: 'group_owner',
      execute: async (args, context) => {
        const { bot: botId, group_id, user_id, title, duration = -1 } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_owner');
        
        const success = await bot.setTitle(group_id, user_id, title, duration);
        return { 
          success, 
          message: success ? `已将 ${user_id} 的头衔设为 "${title}"` : '设置失败' 
        };
      },
    });

    // 设置群名工具
    this.addTool({
      name: 'icqq_set_group_name',
      description: '修改 QQ 群的群名称。需要 Bot 拥有管理员权限。',
      tags: ['群管理', '群设置', '群名'],
      keywords: ['群名', '改群名', '修改群名', '群名称', '改名'],
      parameters: {
        type: 'object',
        properties: {
          bot: CTX_BOT,
          group_id: CTX_GROUP,
          name: {
            type: 'string',
            description: '新的群名称',
          },
        },
        required: ['bot', 'group_id', 'name'],
      },
      platforms: ['icqq'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args, context) => {
        const { bot: botId, group_id, name } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_admin');
        
        const success = await bot.setGroupName(group_id, name);
        return { 
          success, 
          message: success ? `已将群名修改为 "${name}"` : '修改失败' 
        };
      },
    });

    // 发送群公告工具
    this.addTool({
      name: 'icqq_announce',
      description: '发送 QQ 群公告（需要管理员权限）',
      parameters: {
        type: 'object',
        properties: {
          bot: CTX_BOT,
          group_id: CTX_GROUP,
          content: {
            type: 'string',
            description: '公告内容',
          },
        },
        required: ['bot', 'group_id', 'content'],
      },
      platforms: ['icqq'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args, context) => {
        const { bot: botId, group_id, content } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_admin');
        
        const success = await bot.sendAnnounce(group_id, content);
        return { success, message: success ? '群公告已发送' : '发送失败' };
      },
    });

    // 戳一戳工具
    this.addTool({
      name: 'icqq_poke',
      description: '在 QQ 群中对某个成员执行"戳一戳"互动操作（类似拍一拍）。任何人都可以使用。',
      tags: ['互动', '趣味', '戳一戳'],
      keywords: ['戳', '戳一戳', '拍一拍', '拍', '碰一碰', 'poke'],
      parameters: {
        type: 'object',
        properties: {
          bot: CTX_BOT,
          group_id: CTX_GROUP,
          user_id: {
            type: 'number',
            description: '要戳的目标成员 QQ号',
          },
        },
        required: ['bot', 'group_id', 'user_id'],
      },
      platforms: ['icqq'],
      scopes: ['group'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, group_id, user_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        const success = await bot.pokeMember(group_id, user_id);
        return { success, message: success ? `已戳了戳 ${user_id}` : '戳一戳失败' };
      },
    });

    // 获取群成员列表工具
    this.addTool({
      name: 'icqq_list_members',
      description: '查询 QQ 群的完整成员列表，返回每个成员的 QQ号、昵称、群名片、角色（群主/管理员/成员）、头衔等信息。',
      tags: ['群查询', '成员查询', '列表'],
      keywords: ['成员', '群成员', '成员列表', '群员', '有多少人', '人数', '管理员列表', '谁是管理'],
      parameters: {
        type: 'object',
        properties: {
          bot: CTX_BOT,
          group_id: CTX_GROUP,
        },
        required: ['bot', 'group_id'],
      },
      platforms: ['icqq'],
      scopes: ['group'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, group_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        const memberMap = await bot.getMemberList(group_id);
        const members = Array.from(memberMap.values()).map(m => ({
          user_id: m.user_id,
          nickname: m.nickname,
          card: m.card,
          role: m.role,
          title: m.title,
          join_time: m.join_time,
          last_sent_time: m.last_sent_time,
        }));
        
        return { 
          members,
          count: members.length,
          admins: members.filter(m => m.role === 'admin' || m.role === 'owner').length,
        };
      },
    });
    
    // 获取被禁言列表工具
    this.addTool({
      name: 'icqq_list_muted',
      description: '查询 QQ 群中当前被禁言的成员列表。仅查询用途，不执行禁言操作（禁言请用 icqq_mute_member）。',
      tags: ['群查询', '禁言查询', '列表'],
      keywords: ['禁言列表', '被禁言', '谁被禁言', '查看禁言', '禁言名单'],
      parameters: {
        type: 'object',
        properties: {
          bot: CTX_BOT,
          group_id: CTX_GROUP,
        },
        required: ['bot', 'group_id'],
      },
      platforms: ['icqq'],
      scopes: ['group'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, group_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        const mutedList = await bot.getMutedMembers(group_id);
        return { 
          muted_members: mutedList.filter(m => m !== null),
          count: mutedList.filter(m => m !== null).length,
        };
      },
    });
    this.addTool({
      name:'icqq_send_user_like',
      description: '发送用户点赞消息',
      tags: ['互动', '趣味', '点赞'],
      keywords: ['点赞', '赞我'],
      parameters: {
        type: 'object',
        properties: {
          bot: CTX_BOT,
          user_id: {
            type: 'number',
            description: '要点赞的目标用户 QQ号',
          },
          times:{
            type: 'number',
            description: '点赞次数',
            default: 1,
          }
        },
        required: ['bot', 'user_id'],
      },
      platforms: ['icqq'],
      scopes: ['group', 'private'], 
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, user_id, times = 1 } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.sendLike(user_id, Math.min(times, 10));
        return { success, message: success ? `已发送用户点赞消息给 ${user_id}` : '发送失败' };
      },
    })
    // 设置匿名状态工具
    this.addTool({
      name: 'icqq_set_anonymous',
      description: '开启或关闭 QQ 群的匿名聊天功能。开启后群成员可以匿名发言。需要 Bot 拥有管理员权限。',
      tags: ['群管理', '群设置', '匿名'],
      keywords: ['匿名', '匿名聊天', '开启匿名', '关闭匿名', '允许匿名'],
      parameters: {
        type: 'object',
        properties: {
          bot: CTX_BOT,
          group_id: CTX_GROUP,
          enable: {
            type: 'boolean',
            description: 'true=开启匿名聊天，false=关闭匿名聊天，默认 true',
          },
        },
        required: ['bot', 'group_id'],
      },
      platforms: ['icqq'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args, context) => {
        const { bot: botId, group_id, enable = true } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        
        this.checkPermission(context, 'group_admin');
        
        const success = await bot.setAnonymous(group_id, enable);
        return { 
          success, 
          message: success ? (enable ? '已开启匿名聊天' : '已关闭匿名聊天') : '操作失败' 
        };
      },
    });

    // 群文件列表
    this.addTool({
      name: 'icqq_group_files',
      description: '获取 QQ 群的群文件列表',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          group_id: { type: 'number', description: '群号' },
        },
        required: ['bot', 'group_id'],
      },
      platforms: ['icqq'],
      scopes: ['group'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, group_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const files = await bot.getGroupFiles(group_id);
        if (!files?.length) return { files: [], message: '群文件为空' };
        return {
          files: files.slice(0, 30).map((f: any) => ({
            name: f.name,
            size: f.size,
            uploader: f.uploader_uin,
            upload_time: f.upload_time,
          })),
          count: files.length,
        };
      },
    });

    // 好友列表
    this.addTool({
      name: 'icqq_friend_list',
      description: '获取 QQ 好友列表',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
        },
        required: ['bot'],
      },
      platforms: ['icqq'],
      scopes: ['group', 'private'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const fl = bot.fl;
        const friends = Array.from(fl.values()).map((f: any) => ({
          user_id: f.user_id,
          nickname: f.nickname,
          remark: f.remark,
        }));
        return { friends: friends.slice(0, 50), count: fl.size };
      },
    });

    plugin.logger.debug('已注册 ICQQ 平台群管理工具');
  }

  /**
   * 检查执行上下文中的权限
   * 双重验证：优先从 ToolContext 获取权限级别，其次从消息发送者信息获取
   */
  private checkPermission(context: any, required: ToolPermissionLevel): void {
    const permissionLevels: Record<ToolPermissionLevel, number> = {
      'user': 0,
      'group_admin': 1,
      'group_owner': 2,
      'bot_admin': 3,
      'owner': 4,
    };

    const requiredLevel = permissionLevels[required] ?? 0;
    if (requiredLevel === 0) return; // user 级别无需检查

    // 1. 优先从 ToolContext.senderPermissionLevel 获取（AI Agent 路径注入）
    if (context?.senderPermissionLevel) {
      const ctxLevel = permissionLevels[context.senderPermissionLevel as ToolPermissionLevel] ?? 0;
      if (ctxLevel < requiredLevel) {
        throw new Error(`权限不足：需要 ${required} 权限，当前为 ${context.senderPermissionLevel}`);
      }
      return; // 检查通过
    }

    // 2. 从消息的 $sender 获取权限（命令行/中间件路径）
    const sender = context?.message?.$sender as IcqqSenderInfo | undefined;
    if (!sender) {
      // 无上下文且无发送者信息 → 拒绝高权限操作
      throw new Error(`权限不足：无法验证身份，拒绝执行需要 ${required} 权限的操作`);
    }

    let senderLevel: ToolPermissionLevel = 'user';
    if (sender.isOwner || sender.role === 'owner') {
      senderLevel = 'group_owner';
    } else if (sender.isAdmin || sender.role === 'admin') {
      senderLevel = 'group_admin';
    }

    if (permissionLevels[senderLevel] < requiredLevel) {
      throw new Error(`权限不足：需要 ${required} 权限，当前为 ${senderLevel}`);
    }
  }
}

const { provide } = usePlugin();

provide({
  name: "icqq",
  description: "ICQQ Adapter",
  mounted: async (p) => {
    const adapter = new IcqqAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter) => {
    await adapter.stop();
  },
});

useContext("web", (web: any) => {
  // 注册ICQQ适配器的客户端入口文件
  const dispose = web.addEntry(path.resolve(import.meta.dirname, "../client/index.tsx"));
  return dispose;
});

useContext("router", async (router: Router) => {
  const icqq = plugin.root.inject("icqq") as IcqqAdapter;
  router.get("/api/icqq/bots", async (ctx: any) => {
    try {
      const bots = Array.from(icqq.bots.values());

      if (bots.length === 0) {
        ctx.body = {
          success: true,
          data: [],
          message: "暂无ICQQ机器人实例",
        };
        return;
      }

      const result = bots.map((bot) => {
        try {
          return {
            name: bot.$config.name,
            connected: bot.$connected || false,
            groupCount: bot.gl?.size || 0,
            friendCount: bot.fl?.size || 0,
            receiveCount: bot.stat?.recv_msg_cnt || 0,
            sendCount: bot.stat?.sent_msg_cnt || 0,
            loginMode: bot.$config.password ? "password" : "qrcode",
            status: bot.$connected ? "online" : "offline",
            lastActivity: new Date().toISOString(),
          };
        } catch (botError) {
          // 单个机器人数据获取失败时的处理
          return {
            name: bot.$config.name,
            connected: false,
            groupCount: 0,
            friendCount: 0,
            receiveCount: 0,
            sendCount: 0,
            loginMode: "unknown",
            status: "error",
            error: "数据获取失败",
          };
        }
      });

      ctx.body = {
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: "ICQQ_API_ERROR",
        message: "获取机器人数据失败",
        details: process.env.NODE_ENV === "development" ? (error as Error).message : undefined,
        timestamp: new Date().toISOString(),
      };
    }
  });
});
