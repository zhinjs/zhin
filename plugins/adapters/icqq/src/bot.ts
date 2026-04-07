/**
 * ICQQ Bot：继承 icqq Client，实现 zhin Bot 接口
 */
import {
  Client,
  PrivateMessageEvent,
  GroupMessageEvent,
  Sendable,
  MessageElem,
  MemberInfo,
  MemberIncreaseEvent,
  MemberDecreaseEvent,
  GroupRecallEvent,
  GroupAdminEvent,
  GroupMuteEvent,
  GroupTransferEvent,
  GroupPokeEvent,
  FriendRecallEvent,
  FriendPokeEvent,
  FriendIncreaseEvent,
  FriendRequestEvent,
  GroupRequestEvent,
  GroupInviteEvent,
} from "@icqqjs/icqq";
import path from "path";
import {
  Bot,
  Message,
  SendOptions,
  MessageSegment,
  SendContent,
  segment,
  Notice,
  Request,
} from "zhin.js";
import type { IcqqBotConfig, IcqqSenderInfo } from "./types.js";
import type { IcqqAdapter } from "./adapter.js";

export class IcqqBot
  extends Client
  implements Bot<IcqqBotConfig, PrivateMessageEvent | GroupMessageEvent>
{
  $connected: boolean = false;
  $config!: IcqqBotConfig;

  get pluginLogger() {
    return this.adapter.plugin.logger;
  }

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

  private handleIcqqMessage(
    msg: PrivateMessageEvent | GroupMessageEvent,
  ): void {
    const message = this.$formatMessage(msg);
    this.adapter.emit("message.receive", message);
    this.pluginLogger.debug(
      `${this.$config.name} recv  ${message.$channel.type}(${
        message.$channel.id
      }):${segment.raw(message.$content)}`,
    );
  }

  async $connect(): Promise<void> {
    this.on("message", this.handleIcqqMessage.bind(this));
    this.on("notice.group.increase", (e: MemberIncreaseEvent) => this.handleGroupNotice(e, 'group_member_increase', 'increase'));
    this.on("notice.group.decrease", (e: MemberDecreaseEvent) => this.handleGroupNotice(e, 'group_member_decrease', 'decrease'));
    this.on("notice.group.recall", (e: GroupRecallEvent) => this.handleGroupNotice(e, 'group_recall', 'recall'));
    this.on("notice.group.admin", (e: GroupAdminEvent) => this.handleGroupNotice(e, 'group_admin_change', 'admin'));
    this.on("notice.group.ban", (e: GroupMuteEvent) => this.handleGroupNotice(e, 'group_ban', 'ban'));
    this.on("notice.group.transfer", (e: GroupTransferEvent) => this.handleGroupNotice(e, 'group_transfer', 'transfer'));
    this.on("notice.group.poke", (e: GroupPokeEvent) => this.handleGroupNotice(e, 'group_poke', 'poke'));
    this.on("notice.friend.increase", (e: FriendIncreaseEvent) => this.handleFriendNotice(e, 'friend_add', 'increase'));
    this.on("notice.friend.recall", (e: FriendRecallEvent) => this.handleFriendNotice(e, 'friend_recall', 'recall'));
    this.on("notice.friend.poke", (e: FriendPokeEvent) => this.handleFriendNotice(e, 'friend_poke', 'poke'));
    this.on("request.friend.add", (e: FriendRequestEvent) => this.handleFriendRequest(e));
    this.on("request.group.add", (e: GroupRequestEvent) => this.handleGroupRequest(e, 'group_add'));
    this.on("request.group.invite", (e: GroupInviteEvent) => this.handleGroupRequest(e, 'group_invite'));

    this.on("system.login.device", async (e) => {
      this.pluginLogger.info(`[${this.$config.name}] 触发设备验证，正在发送短信验证码...`);
      await this.sendSmsCode();
      this.pluginLogger.info(`[${this.$config.name}] 短信验证码已发送，请查收手机短信`);
      this.pluginLogger.info(`[${this.$config.name}] 请在终端输入短信验证码:`);
      process.stdin.once("data", (data: Buffer) => {
        this.pluginLogger.info(`[${this.$config.name}] 正在提交短信验证码...`);
        this.submitSmsCode(data.toString().trim());
      });
    });
    this.on("system.login.qrcode", async (e: any) => {
      this.pluginLogger.info(`[${this.$config.name}] 触发扫码登录，请使用手机 QQ 扫描二维码`);
      this.pluginLogger.info(`[${this.$config.name}] 扫码完成后按回车继续`);
      process.stdin.once("data", () => {
        this.pluginLogger.info(`[${this.$config.name}] 扫码已确认，正在登录...`);
        this.login();
      });
    });
    this.on("system.login.slider", async (e: { url: string }) => {
      this.pluginLogger.info(`[${this.$config.name}] 触发滑块验证`);
      this.pluginLogger.info(`[${this.$config.name}] 验证地址: ${e.url}`);
      this.pluginLogger.info(`[${this.$config.name}] 请在浏览器中完成滑块验证后，在终端输入 ticket:`);
      process.stdin.once("data", (data: Buffer) => {
        this.pluginLogger.info(`[${this.$config.name}] 正在提交滑块 ticket...`);
        this.submitSlider(data.toString().trim());
      });
    });

    const LOGIN_TIMEOUT = 120_000; // 2 分钟登录超时
    const loginMode = this.$config.password ? '密码' : '扫码';
    this.pluginLogger.info(`[${this.$config.name}] 正在尝试${loginMode}登录...`);

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        const msg = `[${this.$config.name}] 登录超时（${LOGIN_TIMEOUT / 1000}s），请检查网络或验证流程是否完成`;
        this.pluginLogger.error(msg);
        reject(new Error(msg));
      }, LOGIN_TIMEOUT);

      const cleanup = () => {
        clearTimeout(timer);
        // once 注册的监听器在触发后会自动移除，这里只清理未触发的
        this.off("system.online" as any);
        this.off("system.login.error" as any);
        this.off("system.offline" as any);
      };

      const onOnline = () => {
        cleanup();
        this.$connected = true;
        this.pluginLogger.info(`[${this.$config.name}] 登录成功，已上线`);
        resolve();
      };

      const onError = (e: { code: number; message: string }) => {
        cleanup();
        const msg = `[${this.$config.name}] 登录失败 (code=${e.code}): ${e.message}`;
        this.pluginLogger.error(msg);
        reject(new Error(msg));
      };

      const onOffline = (e?: { message: string }) => {
        cleanup();
        const msg = `[${this.$config.name}] 登录过程中掉线: ${e?.message ?? '未知原因'}`;
        this.pluginLogger.error(msg);
        reject(new Error(msg));
      };

      this.once("system.online", onOnline);
      this.once("system.login.error", onError as any);
      this.once("system.offline", onOffline);

      this.login(Number(this.$config.name), this.$config.password);
    });
  }

  async $disconnect(): Promise<void> {
    // Client 继承自 EventEmitter，清除 $connect() 注册的所有监听器
    (this as unknown as import('node:events').EventEmitter).removeAllListeners();
    await this.logout();
    this.$connected = false;
  }

  $formatMessage(msg: PrivateMessageEvent | GroupMessageEvent) {
    const senderInfo = this.getSenderInfo(msg);
    const result = Message.from(msg, {
      $id: msg.message_id.toString(),
      $adapter: "icqq" as const,
      $bot: `${this.$config.name}`,
      $sender: senderInfo,
      $channel: {
        id:
          msg.message_type === "group"
            ? msg.group_id.toString()
            : msg.from_id.toString(),
        type: msg.message_type,
      },
      $content: IcqqBot.toSegments(msg.message),
      $raw: msg.raw_message,
      $timestamp: msg.time*1000,
      $recall: async () => {
        await this.$recallMessage(result.$id);
      },
      $reply: async (
        content: SendContent,
        quote?: boolean | string,
      ): Promise<string> => {
        if (!Array.isArray(content)) content = [content];
        if (quote)
          content.unshift({
            type: "reply",
            data: { id: typeof quote === "boolean" ? result.$id : quote },
          });
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

  private getSenderInfo(
    msg: PrivateMessageEvent | GroupMessageEvent,
  ): IcqqSenderInfo {
    const senderInfo: IcqqSenderInfo = {
      id: msg.sender.user_id.toString(),
      name: msg.sender.nickname.toString(),
    };
    if (msg.message_type === "group") {
      const groupMsg = msg as GroupMessageEvent;
      const sender = groupMsg.sender as any;
      if (sender.role) {
        senderInfo.role = sender.role;
        senderInfo.isOwner = sender.role === "owner";
        senderInfo.isAdmin = sender.role === "admin" || sender.role === "owner";
        const perms: string[] = [];
        if (sender.role === "owner") perms.push("owner", "admin");
        else if (sender.role === "admin") perms.push("admin");
        senderInfo.permissions = perms;
      }
      if (sender.card) senderInfo.card = sender.card;
      if (sender.title) senderInfo.title = sender.title;
    }
    return senderInfo;
  }

  private handleGroupNotice(event: any, type: string, subType: string): void {
    const notice = Notice.from(event, {
      $id: `${event.time || Date.now()}_${type}_${event.group_id}`,
      $adapter: 'icqq',
      $bot: this.$config.name,
      $type: type,
      $subType: subType,
      $channel: { id: event.group_id?.toString() || '', type: 'group' },
      $operator: event.operator_id ? { id: event.operator_id.toString(), name: event.operator_id.toString() } : undefined,
      $target: event.user_id ? { id: event.user_id.toString(), name: event.user_id.toString() } : (event.target_id ? { id: event.target_id.toString(), name: event.target_id.toString() } : undefined),
      $timestamp: event.time*1000 || Date.now(),
    });
    this.adapter.emit('notice.receive', notice);
  }

  private handleFriendNotice(event: any, type: string, subType: string): void {
    const notice = Notice.from(event, {
      $id: `${event.time || Date.now()}_${type}_${event.user_id}`,
      $adapter: 'icqq',
      $bot: this.$config.name,
      $type: type,
      $subType: subType,
      $channel: { id: event.user_id?.toString() || '', type: 'private' },
      $operator: event.operator_id ? { id: event.operator_id.toString(), name: event.operator_id.toString() } : undefined,
      $target: event.user_id ? { id: event.user_id.toString(), name: event.user_id.toString() } : undefined,
      $timestamp: event.time*1000 || Date.now(),
    });
    this.adapter.emit('notice.receive', notice);
  }

  private handleFriendRequest(event: FriendRequestEvent): void {
    const request = Request.from(event, {
      $id: event.flag || `${event.time}_friend_add_${event.user_id}`,
      $adapter: 'icqq',
      $bot: this.$config.name,
      $type: 'friend_add',
      $subType: event.sub_type,
      $channel: { id: event.user_id.toString(), type: 'private' },
      $sender: { id: event.user_id.toString(), name: event.nickname || event.user_id.toString() },
      $comment: event.comment,
      $timestamp: event.time*1000 || Date.now(),
      $approve: async () => { await event.approve(true); },
      $reject: async () => { await event.approve(false); },
    });
    this.adapter.emit('request.receive', request);
  }

  private handleGroupRequest(event: GroupRequestEvent | GroupInviteEvent, type: string): void {
    const request = Request.from(event, {
      $id: event.flag || `${event.time}_${type}_${event.user_id}`,
      $adapter: 'icqq',
      $bot: this.$config.name,
      $type: type,
      $subType: event.sub_type,
      $channel: { id: event.group_id.toString(), type: 'group' },
      $sender: { id: event.user_id.toString(), name: event.nickname || event.user_id.toString() },
      $comment: 'comment' in event ? event.comment : undefined,
      $timestamp: event.time*1000 || Date.now(),
      $approve: async () => { await event.approve(true); },
      $reject: async () => { await event.approve(false); },
    });
    this.adapter.emit('request.receive', request);
  }

  async kickMember(groupId: number, userId: number, block?: boolean): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.kickMember(userId, undefined, block);
      this.pluginLogger.info(
        `ICQQ Bot ${this.$id} 踢出成员 ${userId} 从群 ${groupId}${block ? "（已拉黑）" : ""}`,
      );
      return result;
    } catch (error) {
      this.pluginLogger.error(`ICQQ Bot ${this.$id} 踢出成员失败:`, error);
      throw error;
    }
  }

  async muteMember(groupId: number, userId: number, duration: number = 600): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.muteMember(userId, duration);
      this.pluginLogger.info(
        `ICQQ Bot ${this.$id} ${duration > 0 ? `禁言成员 ${userId} ${duration}秒` : `解除成员 ${userId} 禁言`}（群 ${groupId}）`,
      );
      return result;
    } catch (error) {
      this.pluginLogger.error(`ICQQ Bot ${this.$id} 禁言操作失败:`, error);
      throw error;
    }
  }

  async muteAll(groupId: number, enable: boolean = true): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.muteAll(enable);
      this.pluginLogger.info(`ICQQ Bot ${this.$id} ${enable ? "开启" : "关闭"}全员禁言（群 ${groupId}）`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`ICQQ Bot ${this.$id} 全员禁言操作失败:`, error);
      throw error;
    }
  }

  async setAdmin(groupId: number, userId: number, enable: boolean = true): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.setAdmin(userId, enable);
      this.pluginLogger.info(`ICQQ Bot ${this.$id} ${enable ? "设置" : "取消"}管理员 ${userId}（群 ${groupId}）`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`ICQQ Bot ${this.$id} 设置管理员失败:`, error);
      throw error;
    }
  }

  async setCard(groupId: number, userId: number, card: string): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.setCard(userId, card);
      this.pluginLogger.info(`ICQQ Bot ${this.$id} 设置成员 ${userId} 群名片为 "${card}"（群 ${groupId}）`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`ICQQ Bot ${this.$id} 设置群名片失败:`, error);
      throw error;
    }
  }

  async setTitle(groupId: number, userId: number, title: string, duration: number = -1): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.setTitle(userId, title, duration);
      this.pluginLogger.info(`ICQQ Bot ${this.$id} 设置成员 ${userId} 头衔为 "${title}"（群 ${groupId}）`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`ICQQ Bot ${this.$id} 设置头衔失败:`, error);
      throw error;
    }
  }

  async setGroupName(groupId: number, name: string): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.setName(name);
      this.pluginLogger.info(`ICQQ Bot ${this.$id} 设置群名为 "${name}"（群 ${groupId}）`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`ICQQ Bot ${this.$id} 设置群名失败:`, error);
      throw error;
    }
  }

  async sendAnnounce(groupId: number, content: string): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.announce(content);
      this.pluginLogger.info(`ICQQ Bot ${this.$id} 发送群公告（群 ${groupId}）`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`ICQQ Bot ${this.$id} 发送群公告失败:`, error);
      throw error;
    }
  }

  async pokeMember(groupId: number, userId: number): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.pokeMember(userId);
      this.pluginLogger.info(`ICQQ Bot ${this.$id} 戳了戳 ${userId}（群 ${groupId}）`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`ICQQ Bot ${this.$id} 戳一戳失败:`, error);
      throw error;
    }
  }

  async getMemberList(groupId: number): Promise<Map<number, MemberInfo>> {
    try {
      const group = this.pickGroup(groupId);
      return await group.getMemberMap();
    } catch (error) {
      this.pluginLogger.error(`ICQQ Bot ${this.$id} 获取群成员列表失败:`, error);
      throw error;
    }
  }

  async getMutedMembers(groupId: number): Promise<any[]> {
    try {
      const group = this.pickGroup(groupId);
      return await group.getMuteMemberList();
    } catch (error) {
      this.pluginLogger.error(`ICQQ Bot ${this.$id} 获取禁言列表失败:`, error);
      throw error;
    }
  }

  async setAnonymous(groupId: number, enable: boolean = true): Promise<boolean> {
    try {
      const group = this.pickGroup(groupId);
      const result = await group.allowAnony(enable);
      this.pluginLogger.info(`ICQQ Bot ${this.$id} ${enable ? "开启" : "关闭"}匿名（群 ${groupId}）`);
      return result;
    } catch (error) {
      this.pluginLogger.error(`ICQQ Bot ${this.$id} 设置匿名失败:`, error);
      throw error;
    }
  }

  async getGroupFiles(groupId: number): Promise<any> {
    try {
      const group = this.pickGroup(groupId);
      return await group.fs.ls();
    } catch (error) {
      this.pluginLogger.error(`ICQQ Bot ${this.$id} 获取群文件列表失败:`, error);
      throw error;
    }
  }

  async $recallMessage(id: string): Promise<void> {
    await this.deleteMsg(id);
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    switch (options.type) {
      case "private": {
        const result = await this.sendPrivateMsg(
          Number(options.id),
          IcqqBot.toSendable(options.content),
        );
        this.pluginLogger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
        return result.message_id.toString();
      }
      case "group": {
        const result = await this.sendGroupMsg(
          Number(options.id),
          IcqqBot.toSendable(options.content),
        );
        this.pluginLogger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
        return result.message_id.toString();
      }
      default:
        throw new Error(`unsupported channel type ${options.type}`);
    }
  }
}

export namespace IcqqBot {
  const allowTypes = [
    "text", "face", "image", "record", "audio", "dice", "rps", "video",
    "file", "location", "share", "json", "at", "reply", "long_msg",
    "button", "markdown", "xml",
  ];

  export function toSegments(message: Sendable): MessageSegment[] {
    if (!Array.isArray(message)) message = [message];
    return message
      .filter((item, index) => typeof item === "string" || (item as any).type !== "long_msg" || index !== 0)
      .map((item): MessageSegment => {
        if (typeof item === "string") return { type: "text", data: { text: item } };
        const { type, ...data } = item as any;
        return { type, data };
      });
  }
}

export namespace IcqqBot {
  const allowTypes = [
    "text", "face", "image", "record", "audio", "dice", "rps", "video",
    "file", "location", "share", "json", "at", "reply", "long_msg",
    "button", "markdown", "xml",
  ];

  export function toSendable(content: SendContent): Sendable {
    if (!Array.isArray(content)) content = [content];
    return content.map((seg): MessageElem => {
      if (typeof seg === "string") return { type: "text", text: seg };
      let { type, data } = seg as any;
      if (typeof type === "function") type = type.name;
      if(['image','video','audio'].includes(type)) data.file=data.file||data.url||data.src
      if (!allowTypes.includes(type)) return { type: "text", text: segment.toString(seg) };
      return { type, ...data } as MessageElem;
    });
  }
}
