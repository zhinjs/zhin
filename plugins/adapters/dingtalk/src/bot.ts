/**
 * 钉钉 Bot 实现
 */
import {
  Bot,
  Message,
  SendOptions,
  SendContent,
  MessageSegment,
  segment,
} from "zhin.js";
import type { Context } from "koa";
import { createHmac } from "crypto";
import type {
  DingTalkBotConfig,
  DingTalkMessage,
  DingTalkEvent,
  AccessToken,
} from "./types.js";
import type { DingTalkAdapter } from "./adapter.js";

export class DingTalkBot implements Bot<DingTalkBotConfig, DingTalkMessage> {
  $connected: boolean;
  private router: any;
  private accessToken: AccessToken;
  private baseURL: string;
  private sessionWebhooks: Map<string, string> = new Map();

  get $id() {
    return this.$config.name;
  }

  get logger() {
    return this.adapter.plugin.logger;
  }

  constructor(
    public adapter: DingTalkAdapter,
    router: any,
    public $config: DingTalkBotConfig
  ) {
    this.router = router;
    this.$connected = false;
    this.accessToken = { token: "", expires_in: 0, timestamp: 0 };
    this.baseURL = $config.apiBaseUrl || "https://oapi.dingtalk.com";
    this.setupWebhookRoute();
  }

  private async request(
    path: string,
    options: {
      method?: "GET" | "POST";
      params?: Record<string, any>;
      body?: any;
    } = {}
  ): Promise<any> {
    await this.ensureAccessToken();
    const { method = "GET", params = {}, body } = options;
    const urlParams = new URLSearchParams({
      ...params,
      access_token: this.accessToken.token,
    });
    const url = `${this.baseURL}${path}?${urlParams.toString()}`;
    const fetchOptions: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    };
    if (body && method === "POST") {
      fetchOptions.body = JSON.stringify(body);
    }
    const response = await fetch(url, fetchOptions);
    return await response.json();
  }

  private setupWebhookRoute(): void {
    this.router.post(this.$config.webhookPath, (ctx: Context) => {
      this.handleWebhook(ctx);
    });
  }

  private async handleWebhook(ctx: Context): Promise<void> {
    try {
      const body = (ctx.request as any).body;
      const headers = ctx.request.headers;
      const timestamp = headers["timestamp"] as string;
      const sign = headers["sign"] as string;
      if (timestamp && sign) {
        if (!this.verifySignature(timestamp, sign)) {
          this.logger.warn("Invalid signature in webhook");
          ctx.status = 403;
          ctx.body = { code: -1, msg: "Forbidden" };
          return;
        }
      }
      const event: DingTalkEvent = body;
      if (event.msgtype) {
        await this.handleEvent(event);
      }
      ctx.status = 200;
      ctx.body = { code: 0, msg: "success" };
    } catch (error) {
      this.logger.error("Webhook error:", error);
      ctx.status = 500;
      ctx.body = { code: -1, msg: "Internal Server Error" };
    }
  }

  private verifySignature(timestamp: string, sign: string): boolean {
    try {
      const stringToSign = `${timestamp}\n${this.$config.appSecret}`;
      const hmac = createHmac("sha256", this.$config.appSecret);
      hmac.update(stringToSign);
      const calculatedSign = hmac.digest("base64");
      return calculatedSign === sign;
    } catch (error) {
      this.logger.error("Signature verification error:", error);
      return false;
    }
  }

  private async handleEvent(event: DingTalkEvent): Promise<void> {
    if (event.sessionWebhook && event.conversationId) {
      this.sessionWebhooks.set(event.conversationId, event.sessionWebhook);
    }
    const message = this.$formatMessage(event as any);
    this.adapter.emit("message.receive", message);
    this.logger.info(
      `${this.$config.name} recv  ${message.$channel.type}(${message.$channel.id}): ${segment.raw(message.$content)}`
    );
  }

  private async ensureAccessToken(): Promise<void> {
    const now = Date.now();
    if (
      this.accessToken.token &&
      now <
        this.accessToken.timestamp +
          (this.accessToken.expires_in - 300) * 1000
    ) {
      return;
    }
    await this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<void> {
    try {
      const baseURL =
        this.$config.apiBaseUrl || "https://oapi.dingtalk.com";
      const params = new URLSearchParams({
        appkey: this.$config.appKey,
        appsecret: this.$config.appSecret,
      });
      const url = `${baseURL}/gettoken?${params.toString()}`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.errcode === 0) {
        this.accessToken = {
          token: data.access_token,
          expires_in: data.expires_in,
          timestamp: Date.now(),
        };
        this.logger.debug("Access token refreshed successfully");
      } else {
        throw new Error(`Failed to get access token: ${data.errmsg}`);
      }
    } catch (error) {
      this.logger.error("Failed to refresh access token:", error);
      throw error;
    }
  }

  $formatMessage(msg: DingTalkMessage): Message<DingTalkMessage> {
    const content = this.parseMessageContent(msg);
    const chatType = msg.conversationType === "2" ? "group" : "private";
    return Message.from(msg, {
      $id: msg.msgId || Date.now().toString(),
      $adapter: "dingtalk",
      $bot: this.$config.name,
      $sender: {
        id: msg.senderId || msg.senderStaffId || "unknown",
        name: msg.senderNick || msg.senderId || "Unknown User",
      },
      $channel: {
        id: msg.conversationId || "unknown",
        type: chatType as any,
      },
      $content: content,
      $raw: JSON.stringify(msg),
      $timestamp: msg.createAt || Date.now(),
      $recall: async () => {
        await this.$recallMessage(msg.msgId || "");
      },
      $reply: async (content: SendContent): Promise<string> => {
        return await this.adapter.sendMessage({
          context: "dingtalk",
          bot: this.$config.name,
          id: msg.conversationId || msg.senderId || "unknown",
          type: chatType,
          content: content,
        });
      },
    });
  }

  private parseMessageContent(msg: DingTalkMessage): MessageSegment[] {
    const content: MessageSegment[] = [];
    if (!msg.msgtype) return content;
    try {
      switch (msg.msgtype) {
        case "text":
          if (msg.text?.content) {
            content.push(segment("text", { content: msg.text.content }));
            if (msg.atUsers && msg.atUsers.length > 0) {
              for (const atUser of msg.atUsers) {
                content.push(
                  segment("at", {
                    id: atUser.dingtalkId || atUser.staffId,
                    name: atUser.dingtalkId || atUser.staffId,
                  })
                );
              }
            }
          }
          break;
        case "picture":
          if (msg.content) {
            content.push(
              segment("image", {
                url:
                  msg.content.downloadCode ||
                  msg.content.pictureDownloadCode,
                file:
                  msg.content.downloadCode ||
                  msg.content.pictureDownloadCode,
              })
            );
          }
          break;
        case "file":
          if (msg.content) {
            content.push(
              segment("file", {
                file: msg.content.downloadCode,
                name: msg.content.fileName,
                size: msg.content.fileSize,
              })
            );
          }
          break;
        case "audio":
          if (msg.content) {
            content.push(
              segment("audio", {
                file: msg.content.downloadCode,
                duration: msg.content.duration,
              })
            );
          }
          break;
        case "video":
          if (msg.content) {
            content.push(
              segment("video", {
                file: msg.content.downloadCode,
                duration: msg.content.duration,
                size: msg.content.videoSize,
              })
            );
          }
          break;
        case "richText":
          if (msg.content?.richText) {
            for (const item of msg.content.richText) {
              if (item.text) {
                content.push(segment("text", { content: item.text }));
              }
            }
          }
          break;
        case "markdown":
          if (msg.content?.text) {
            content.push(
              segment("markdown", {
                content: msg.content.text,
                title: msg.content.title,
              })
            );
          }
          break;
        default:
          content.push(
            segment("text", {
              content: `[不支持的消息类型: ${msg.msgtype}]`,
            })
          );
          break;
      }
    } catch (error) {
      this.logger.error("Failed to parse message content:", error);
      content.push(segment("text", { content: "[消息解析失败]" }));
    }
    return content;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    const conversationId = options.id;
    const content = this.formatSendContent(options.content);
    try {
      const sessionWebhook = this.sessionWebhooks.get(conversationId);
      if (sessionWebhook) {
        const response = await fetch(sessionWebhook, {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify(content),
        });
        const data = await response.json();
        if (data.errcode !== 0) {
          throw new Error(
            `Failed to send message via session webhook: ${data.errmsg}`
          );
        }
        this.logger.debug("Message sent via session webhook");
        return data.msgId || Date.now().toString();
      }
      const data = await this.request("/robot/send", {
        method: "POST",
        body: {
          ...content,
          robotCode: this.$config.robotCode,
        },
      });
      if (data.errcode !== 0) {
        throw new Error(`Failed to send message: ${data.errmsg}`);
      }
      this.logger.debug("Message sent successfully");
      return data.msgId || Date.now().toString();
    } catch (error) {
      this.logger.error("Failed to send message:", error);
      throw error;
    }
  }

  async $recallMessage(id: string): Promise<void> {
    this.logger.warn("DingTalk robot does not support message recall");
  }

  private formatSendContent(content: SendContent): any {
    if (typeof content === "string") {
      return { msgtype: "text", text: { content } };
    }
    if (Array.isArray(content)) {
      const textParts: string[] = [];
      const atUserIds: string[] = [];
      let hasMedia = false;
      let mediaContent: any = null;
      for (const item of content) {
        if (typeof item === "string") {
          textParts.push(item);
        } else {
          const seg = item as MessageSegment;
          switch (seg.type) {
            case "text":
              textParts.push(seg.data.content || seg.data.text || "");
              break;
            case "at":
              const userId = seg.data.id || seg.data.userId;
              if (userId) {
                atUserIds.push(userId);
                textParts.push(`@${seg.data.name || userId} `);
              }
              break;
            case "image":
              if (!hasMedia) {
                hasMedia = true;
                mediaContent = {
                  msgtype: "picture",
                  picture: {
                    picURL: seg.data.url || seg.data.file,
                  },
                };
              }
              break;
            case "markdown":
              if (!hasMedia) {
                hasMedia = true;
                mediaContent = {
                  msgtype: "markdown",
                  markdown: {
                    title: seg.data.title || "消息",
                    text: seg.data.content || seg.data.text,
                  },
                };
              }
              break;
            case "link":
              if (!hasMedia) {
                hasMedia = true;
                mediaContent = {
                  msgtype: "link",
                  link: {
                    title: seg.data.title || "链接",
                    text: seg.data.text || seg.data.content || "",
                    messageUrl: seg.data.url,
                    picUrl: seg.data.picUrl,
                  },
                };
              }
              break;
          }
        }
      }
      if (hasMedia && mediaContent) return mediaContent;
      const result: any = {
        msgtype: "text",
        text: { content: textParts.join("") },
      };
      if (atUserIds.length > 0) {
        result.at = { atUserIds, isAtAll: false };
      }
      return result;
    }
    return { msgtype: "text", text: { content: String(content) } };
  }

  async $connect(): Promise<void> {
    try {
      await this.refreshAccessToken();
      this.$connected = true;
      this.logger.info(`DingTalk bot connected: ${this.$config.name}`);
      this.logger.info(`Webhook URL: ${this.$config.webhookPath}`);
    } catch (error) {
      this.logger.error("Failed to connect DingTalk bot:", error);
      throw error;
    }
  }

  async $disconnect(): Promise<void> {
    try {
      this.sessionWebhooks.clear();
      this.$connected = false;
      this.logger.info("DingTalk bot disconnected");
    } catch (error) {
      this.logger.error("Error disconnecting DingTalk bot:", error);
    }
  }

  async getUserInfo(userId: string): Promise<any> {
    try {
      const data = await this.request("/topapi/v2/user/get", {
        method: "POST",
        body: { userid: userId },
      });
      if (data.errcode === 0) return data.result;
      throw new Error(`Failed to get user info: ${data.errmsg}`);
    } catch (error) {
      this.logger.error("Failed to get user info:", error);
      return null;
    }
  }

  async getDepartmentUsers(deptId: number): Promise<any[]> {
    try {
      const data = await this.request("/topapi/user/listid", {
        method: "POST",
        body: { dept_id: deptId },
      });
      if (data.errcode === 0) return data.result.userid_list || [];
      throw new Error(`Failed to get department users: ${data.errmsg}`);
    } catch (error) {
      this.logger.error("Failed to get department users:", error);
      return [];
    }
  }

  async sendWorkNotice(userIdList: string[], content: any): Promise<boolean> {
    try {
      const data = await this.request(
        "/topapi/message/corpconversation/asyncsend_v2",
        {
          method: "POST",
          body: {
            agent_id: this.$config.robotCode,
            userid_list: userIdList.join(","),
            msg: content,
          },
        }
      );
      if (data.errcode === 0) {
        this.logger.debug("Work notice sent successfully");
        return true;
      }
      throw new Error(`Failed to send work notice: ${data.errmsg}`);
    } catch (error) {
      this.logger.error("Failed to send work notice:", error);
      return false;
    }
  }

  async getDepartmentList(deptId: number = 1): Promise<any[]> {
    try {
      const data = await this.request("/topapi/v2/department/listsub", {
        method: "POST",
        body: { dept_id: deptId },
      });
      if (data.errcode === 0) return data.result || [];
      throw new Error(`Failed to get department list: ${data.errmsg}`);
    } catch (error) {
      this.logger.error("Failed to get department list:", error);
      return [];
    }
  }

  async getDepartmentInfo(deptId: number): Promise<any> {
    try {
      const data = await this.request("/topapi/v2/department/get", {
        method: "POST",
        body: { dept_id: deptId },
      });
      if (data.errcode === 0) return data.result;
      throw new Error(`Failed to get department info: ${data.errmsg}`);
    } catch (error) {
      this.logger.error("Failed to get department info:", error);
      return null;
    }
  }

  async createChat(
    name: string,
    ownerUserId: string,
    userIdList: string[]
  ): Promise<string | null> {
    try {
      const data = await this.request("/topapi/chat/create", {
        method: "POST",
        body: {
          name,
          owner: ownerUserId,
          useridlist: userIdList,
        },
      });
      if (data.errcode === 0) {
        this.logger.info(`创建群聊成功: ${data.chatid}`);
        return data.chatid;
      }
      throw new Error(`Failed to create chat: ${data.errmsg}`);
    } catch (error) {
      this.logger.error("Failed to create chat:", error);
      return null;
    }
  }

  async getChatInfo(chatId: string): Promise<any> {
    try {
      const data = await this.request("/topapi/chat/get", {
        method: "POST",
        body: { chatid: chatId },
      });
      if (data.errcode === 0) return data.chat_info;
      throw new Error(`Failed to get chat info: ${data.errmsg}`);
    } catch (error) {
      this.logger.error("Failed to get chat info:", error);
      return null;
    }
  }

  async updateChat(
    chatId: string,
    options: {
      name?: string;
      owner?: string;
      add_useridlist?: string[];
      del_useridlist?: string[];
    }
  ): Promise<boolean> {
    try {
      const data = await this.request("/topapi/chat/update", {
        method: "POST",
        body: { chatid: chatId, ...options },
      });
      if (data.errcode === 0) {
        this.logger.info(`更新群聊成功: ${chatId}`);
        return true;
      }
      throw new Error(`Failed to update chat: ${data.errmsg}`);
    } catch (error) {
      this.logger.error("Failed to update chat:", error);
      return false;
    }
  }
}
