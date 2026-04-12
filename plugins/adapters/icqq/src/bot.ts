/**
 * ICQQ Bot：通过 @icqqjs/cli 守护进程 IPC 通信，实现 zhin Bot 接口
 *
 * 不再直接依赖 @icqqjs/icqq 协议库。
 * 登录由 `icqq login` 完成，本 Bot 只负责连接守护进程并收发消息。
 */
import {
  Bot,
  Message,
  SendOptions,
  MessageSegment,
  SendContent,
  segment,
} from "zhin.js";
import type {
  IcqqBotConfig,
  IcqqSenderInfo,
  IpcFriendInfo,
  IpcGroupInfo,
  IpcMemberInfo,
} from "./types.js";
import type { IcqqAdapter } from "./adapter.js";
import { IpcClient } from "./ipc-client.js";
import {
  Actions,
  type IpcMessageEventData,
  type IpcEvent,
} from "./protocol.js";

export class IcqqBot implements Bot<IcqqBotConfig, IpcMessageEventData> {
  $connected = false;
  $config: IcqqBotConfig;
  ipc!: IpcClient;

  /** 缓存的好友列表 */
  friends = new Map<number, IpcFriendInfo>();
  /** 缓存的群列表 */
  groups = new Map<number, IpcGroupInfo>();

  private subscriptions: Array<{ unsubscribe: () => Promise<void> }> = [];

  get $id() {
    return this.$config.name;
  }

  get logger() {
    return this.adapter.plugin.logger;
  }

  constructor(
    public adapter: IcqqAdapter,
    config: IcqqBotConfig,
  ) {
    this.$config = config;
  }

  // ── 连接 ───────────────────────────────────────────────────────────

  async $connect(): Promise<void> {
    const uin = Number(this.$config.name);
    const rpc = this.$config.rpc;

    if (rpc) {
      this.logger.info(`[${this.$id}] 正在通过 RPC 连接 icqq 守护进程 (${rpc.host}:${rpc.port})...`);
      this.ipc = await IpcClient.connectRpc(rpc);
    } else {
      this.logger.info(`[${this.$id}] 正在连接 icqq 守护进程...`);
      this.ipc = await IpcClient.connect(uin);
    }
    this.logger.info(`[${this.$id}] 已连接守护进程${rpc ? " (RPC)" : ""}`);

    // 拉取好友/群列表并缓存
    await this.refreshLists();

    // 订阅所有好友消息
    for (const [uid] of this.friends) {
      const sub = this.ipc.subscribe(
        Actions.SUBSCRIBE,
        { type: "private", id: uid },
        (event) => this.handleEvent(event),
      );
      this.subscriptions.push(sub);
    }

    // 订阅所有群消息
    for (const [gid] of this.groups) {
      const sub = this.ipc.subscribe(
        Actions.SUBSCRIBE,
        { type: "group", id: gid },
        (event) => this.handleEvent(event),
      );
      this.subscriptions.push(sub);
    }

    this.$connected = true;
    this.logger.info(
      `[${this.$id}] 登录成功，好友 ${this.friends.size}，群 ${this.groups.size}`,
    );
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
  }

  // ── 断开 ───────────────────────────────────────────────────────────

  async $disconnect(): Promise<void> {
    for (const sub of this.subscriptions) {
      await sub.unsubscribe().catch(() => {});
    }
    this.subscriptions = [];
    this.ipc?.close();
    this.$connected = false;
    this.logger.info(`[${this.$id}] 已断开连接`);
  }

  // ── 消息处理 ───────────────────────────────────────────────────────

  private handleEvent(event: IpcEvent): void {
    const data = event.data as IpcMessageEventData;
    if (!data || !data.raw_message) return;

    const message = this.$formatMessage(data);
    this.adapter.emit("message.receive", message);
    this.logger.debug(
      `${this.$id} recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`,
    );
  }

  $formatMessage(raw: IpcMessageEventData) {
    const channelId =
      raw.type === "group"
        ? String(raw.group_id ?? raw.from_id)
        : String(raw.from_id);
    const channelType = raw.type === "group" ? "group" : "private";
    // 守护进程推送无 message_id，合成一个
    const syntheticId = `${raw.time}_${raw.user_id}_${channelId}`;

    const senderInfo: IcqqSenderInfo = {
      id: String(raw.user_id),
      name: raw.nickname,
    };

    const result = Message.from(raw, {
      $id: syntheticId,
      $adapter: "icqq" as const,
      $bot: this.$config.name,
      $sender: senderInfo,
      $channel: { id: channelId, type: channelType },
      $content: IcqqBot.parseCqMessage(raw.raw_message),
      $raw: raw.raw_message,
      $timestamp: raw.time * 1000,
      $recall: async () => {
        // 合成 id 无法撤回
        this.logger.warn(
          `[${this.$id}] 收到的消息无法撤回（守护进程推送不含 message_id）`,
        );
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
          bot: this.$config.name,
          content,
        });
      },
    });
    return result;
  }

  // ── 撤回 ───────────────────────────────────────────────────────────

  async $recallMessage(id: string): Promise<void> {
    const resp = await this.ipc.request(Actions.RECALL_MSG, {
      message_id: id,
    });
    if (!resp.ok) {
      this.logger.warn(`[${this.$id}] 撤回消息失败: ${resp.error}`);
    }
  }

  // ── 发送消息 ───────────────────────────────────────────────────────

  async $sendMessage(options: SendOptions): Promise<string> {
    const content = IcqqBot.toCqString(options.content);

    let action: string;
    let params: Record<string, unknown>;

    switch (options.type) {
      case "private":
        action = Actions.SEND_PRIVATE_MSG;
        params = { user_id: Number(options.id), message: content };
        break;
      case "group":
        action = Actions.SEND_GROUP_MSG;
        params = { group_id: Number(options.id), message: content };
        break;
      default:
        throw new Error(`不支持的频道类型: ${options.type}`);
    }

    const resp = await this.ipc.request(action, params);
    if (!resp.ok) {
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
}

// ── CQ 码解析工具 ──────────────────────────────────────────────────

export namespace IcqqBot {
  /**
   * 将 CQ 码原始消息字符串解析为 MessageSegment 数组。
   * 格式: `[type:value]` 或纯文本
   */
  export function parseCqMessage(raw: string): MessageSegment[] {
    const segments: MessageSegment[] = [];
    // 匹配 [type:arg] 或 [type:arg1,arg2=val] 等 CQ 码
    const cqRegex = /\[([a-z_]+)(?::([^\]]*))?\]/g;
    let lastIndex = 0;

    for (const match of raw.matchAll(cqRegex)) {
      // 前面的纯文本
      if (match.index! > lastIndex) {
        const text = raw.slice(lastIndex, match.index!);
        if (text) segments.push({ type: "text", data: { text } });
      }

      const type = match[1];
      const arg = match[2] ?? "";

      switch (type) {
        case "face":
          segments.push({ type: "face", data: { id: Number(arg) } });
          break;
        case "image":
          segments.push({ type: "image", data: { url: arg, file: arg } });
          break;
        case "at":
          if (arg === "all") {
            segments.push({ type: "at", data: { qq: "all" } });
          } else {
            segments.push({ type: "at", data: { qq: arg } });
          }
          break;
        case "dice":
          segments.push({ type: "dice", data: {} });
          break;
        case "rps":
          segments.push({ type: "rps", data: {} });
          break;
        case "record":
        case "audio":
          segments.push({ type: "record", data: { file: arg } });
          break;
        case "video":
          segments.push({ type: "video", data: { file: arg } });
          break;
        case "reply":
          segments.push({ type: "reply", data: { id: arg } });
          break;
        default:
          segments.push({ type, data: { text: `[${type}:${arg}]` } });
          break;
      }

      lastIndex = match.index! + match[0].length;
    }

    // 尾部文本
    if (lastIndex < raw.length) {
      const text = raw.slice(lastIndex);
      if (text) segments.push({ type: "text", data: { text } });
    }

    return segments.length ? segments : [{ type: "text", data: { text: raw } }];
  }

  /**
   * 将 SendContent（MessageSegment[] 或字符串）转为 CQ 码字符串。
   * 守护进程使用 CQ 码字符串格式收发消息。
   */
  export function toCqString(content: SendContent): string {
    if (!Array.isArray(content)) content = [content];
    return content
      .map((seg) => {
        if (typeof seg === "string") return seg;
        const { type, data } = seg as MessageSegment;
        switch (type) {
          case "text":
            return data.text ?? "";
          case "face":
            return `[face:${data.id}]`;
          case "image":
            return `[image:${data.file || data.url || data.src}]`;
          case "at":
            return `[at:${data.qq ?? data.id}]`;
          case "dice":
            return "[dice]";
          case "rps":
            return "[rps]";
          case "record":
          case "audio":
            return `[record:${data.file || data.url}]`;
          case "video":
            return `[video:${data.file || data.url}]`;
          case "reply":
            return `[reply:${data.id}]`;
          default:
            return segment.toString(seg);
        }
      })
      .join("");
  }
}
