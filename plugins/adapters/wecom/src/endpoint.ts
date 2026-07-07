/**
 * 企业微信 Endpoint 实现
 */
import { formatCompact, Endpoint, Message, MessageSegment, segment, type SendContent, type SendOptions, expandInteractiveSegmentsInContent,} from 'zhin.js';
import { registerFetchRoute, type Router, type RouterContext } from '@zhin.js/host-router/router';
import { createHash, createDecipheriv } from 'node:crypto';
import type {
  WecomEndpointConfig,
  WecomMessage,
  AccessToken,
  WecomApiResponse,
} from './types.js';
import type { WecomAdapter } from './adapter.js';
import { normalizeWecomSenderForPermit } from './platform-permit.js';
import { fromCanonicalSegments, toCanonicalSegments } from './segment-mapper.js';

export class WecomEndpoint implements Endpoint<WecomEndpointConfig, WecomMessage> {
  $connected: boolean;
  private router: Router;
  private accessToken: AccessToken;
  private baseURL: string;
  private aesKey: Buffer;
  private corpId: string;
  #refreshPromise: Promise<string> | null = null;

  get $id() {
    return this.$config.name;
  }

  get logger() {
    return this.adapter.plugin.logger;
  }

  constructor(
    public adapter: WecomAdapter,
    router: Router,
    public $config: WecomEndpointConfig
  ) {
    this.router = router;
    this.$connected = false;
    this.accessToken = { access_token: '', expires_in: 0, timestamp: 0 };
    this.baseURL = $config.apiBaseUrl || 'https://qyapi.weixin.qq.com';
    this.corpId = $config.corpId;
    this.aesKey = Buffer.from($config.encodingAESKey + '=', 'base64');
    if (this.aesKey.length !== 32) {
      throw new Error(`encodingAESKey must produce a 32-byte key, got ${this.aesKey.length} bytes`);
    }
    this.setupWebhookRoute();
  }

  // ── HTTP helpers ──

  private async request(
    path: string,
    options: {
      method?: 'GET' | 'POST';
      params?: Record<string, string | number>;
      body?: Record<string, unknown>;
    } = {}
  ): Promise<WecomApiResponse> {
    await this.ensureAccessToken();
    const { method = 'GET', params = {}, body } = options;
    const urlParams = new URLSearchParams({
      ...params,
      access_token: this.accessToken.access_token,
    });
    const url = `${this.baseURL}${path}?${urlParams.toString()}`;
    const fetchOptions: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    };
    if (body && method === 'POST') {
      fetchOptions.body = JSON.stringify(body);
    }
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`WeCom API error ${response.status}: ${text}`);
    }
    return await response.json();
  }

  // ── Webhook route ──

  private setupWebhookRoute(): void {
    const webhookPath = this.$config.webhookPath || '/wecom/callback';
    registerFetchRoute(this.router, 'GET', webhookPath, (ctx: RouterContext) => {
      void this.handleVerification(ctx);
    });
    registerFetchRoute(this.router, 'POST', webhookPath, (ctx: RouterContext) => {
      void this.handleWebhook(ctx);
    });
  }

  // ── URL 验证（企业微信首次配置回调 URL 时的 GET 请求）──

  private handleVerification(ctx: RouterContext): void {
    try {
      const { msg_signature, timestamp, nonce, echostr } = ctx.query;
      if (!msg_signature || !timestamp || !nonce || !echostr) {
        ctx.status = 400;
        ctx.body = 'Missing required query parameters';
        return;
      }

      if (!this.verifySignature(msg_signature as string, timestamp as string, nonce as string, echostr as string)) {
        this.logger.warn(formatCompact({ op: 'verify', ok: false, error: 'invalid signature' }));
        ctx.status = 403;
        ctx.body = 'Forbidden';
        return;
      }

      // 解密 echostr 并返回明文
      const decrypted = this.decryptMessage(echostr as string);
      if (!decrypted) {
        ctx.status = 400;
        ctx.body = 'Decryption failed';
        return;
      }
      ctx.status = 200;
      ctx.body = decrypted;
    } catch (error) {
      this.logger.error('URL verification error:', error);
      ctx.status = 500;
      ctx.body = 'Internal Server Error';
    }
  }

  // ── 消息回调处理 ──

  private async handleWebhook(ctx: RouterContext): Promise<void> {
    try {
      const query = ctx.query;
      const msgSignature = query.msg_signature as string;
      const timestamp = query.timestamp as string;
      const nonce = query.nonce as string;

      // 解析 XML body
      const rawBody = typeof ctx.request.body === 'string'
        ? ctx.request.body
        : String(ctx.request.body || '');

      // 从 XML 中提取 Encrypt 字段（使用字符类避免 CodeQL 多项式正则警告）
      const encryptMatch = rawBody.match(/<Encrypt><!\[CDATA\[([^[\]]+)]\]><\/Encrypt>/);
      if (!encryptMatch) {
        this.logger.warn(formatCompact({ op: 'webhook', ok: false, error: 'no Encrypt field' }));
        ctx.status = 200;
        ctx.body = 'success';
        return;
      }
      const encrypted = encryptMatch[1];

      // 验证签名
      if (!this.verifySignature(msgSignature, timestamp, nonce, encrypted)) {
        this.logger.warn(formatCompact({ op: 'webhook', ok: false, error: 'invalid signature' }));
        ctx.status = 403;
        ctx.body = 'Forbidden';
        return;
      }

      // 解密消息
      const decryptedXml = this.decryptMessage(encrypted);
      if (!decryptedXml) {
        ctx.status = 200;
        ctx.body = 'success';
        return;
      }
      const message = this.parseXmlMessage(decryptedXml);
      if (message) {
        await this.handleMessage(message);
      }

      ctx.status = 200;
      ctx.body = 'success';
    } catch (error) {
      this.logger.error('Webhook error:', error);
      ctx.status = 200;
      ctx.body = 'success';
    }
  }

  // ── 签名验证（SHA1 排序拼接）──

  private verifySignature(signature: string, timestamp: string, nonce: string, encrypt: string): boolean {
    try {
      const arr = [this.$config.token, timestamp, nonce, encrypt].sort();
      const str = arr.join('');
      const hash = createHash('sha1').update(str).digest('hex');
      return hash === signature;
    } catch (error) {
      this.logger.error('Signature verification error:', error);
      return false;
    }
  }

  // ── AES-CBC 解密 ──

  private decryptMessage(encrypted: string): string | null {
    const buf = Buffer.from(encrypted, 'base64');
    const iv = this.aesKey.subarray(0, 16);
    const decipher = createDecipheriv('aes-256-cbc', this.aesKey, iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(buf), decipher.final()]);
    // PKCS7 unpad
    const pad = decrypted[decrypted.length - 1];
    const content = decrypted.subarray(0, decrypted.length - pad);
    // 提取: 16 字节随机数 + 4 字节消息长度 + 消息体 + corpId
    const msgLen = content.readUInt32BE(16);
    const msg = content.subarray(20, 20 + msgLen).toString('utf8');
    const extractedCorpId = content.subarray(20 + msgLen).toString('utf8');
    if (extractedCorpId !== this.corpId) {
      this.logger.warn(formatCompact({ op: 'decrypt', ok: false, error: 'corpId mismatch', expected: this.corpId, got: extractedCorpId }));
      return null;
    }
    return msg;
  }

  // ── XML 解析（简易，无外部依赖）──

  private parseXmlMessage(xml: string): WecomMessage | null {
    try {
      const get = (tag: string): string | undefined => {
        // 使用字符类避免 CodeQL 多项式正则警告
        const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([^\\[\\]]*)\\]\\]><\\/${tag}>`))
          || xml.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`));
        return m ? m[1] : undefined;
      };
      const msgType = get('MsgType');
      if (!msgType) return null;

      const msg: WecomMessage = {
        ToUserName: get('ToUserName') || '',
        FromUserName: get('FromUserName') || '',
        CreateTime: Number(get('CreateTime') || Date.now()),
        MsgType: msgType as WecomMessage['MsgType'],
        MsgId: get('MsgId'),
        AgentID: get('AgentID'),
      };

      switch (msgType) {
        case 'text':
          msg.Content = get('Content');
          break;
        case 'image':
          msg.PicUrl = get('PicUrl');
          msg.MediaId = get('MediaId');
          break;
        case 'voice':
          msg.MediaId = get('MediaId');
          msg.Format = get('Format');
          msg.Recognition = get('Recognition');
          break;
        case 'video':
        case 'shortvideo':
          msg.MediaId = get('MediaId');
          msg.ThumbMediaId = get('ThumbMediaId');
          break;
        case 'location':
          msg.Location_X = get('Location_X');
          msg.Location_Y = get('Location_Y');
          msg.Scale = get('Scale');
          msg.Label = get('Label');
          break;
        case 'link':
          msg.Title = get('Title');
          msg.Description = get('Description');
          msg.Url = get('Url');
          break;
        case 'event':
          msg.Event = get('Event');
          msg.EventKey = get('EventKey');
          break;
      }

      return msg;
    } catch (error) {
      this.logger.error('Failed to parse XML message:', error);
      return null;
    }
  }

  // ── 消息处理 ──

  private async handleMessage(msg: WecomMessage): Promise<void> {
    const formatted = this.$formatMessage(msg);
    this.adapter.emit('message.receive', formatted);
    this.logger.debug(formatCompact({
      op: 'recv',
      endpoint: this.$config.name,
      channel: formatted.$channel.type,
      id: formatted.$channel.id,
      len: segment.raw(formatted.$content).length,
    }));
  }

  // ── Access Token 管理 ──

  private async ensureAccessToken(): Promise<void> {
    const now = Date.now();
    if (
      this.accessToken.access_token &&
      now < this.accessToken.timestamp + (this.accessToken.expires_in - 300) * 1000
    ) {
      return;
    }
    if (this.#refreshPromise) {
      await this.#refreshPromise;
      return;
    }
    this.#refreshPromise = this.refreshAccessToken()
      .then(() => this.accessToken.access_token)
      .finally(() => { this.#refreshPromise = null; });
    await this.#refreshPromise;
  }

  private async refreshAccessToken(): Promise<void> {
    try {
      const url = `${this.baseURL}/cgi-bin/gettoken?corpid=${this.corpId}&corpsecret=${this.$config.agentSecret}`;
      const response = await fetch(url);
      const data = await response.json() as WecomApiResponse;
      if (data.errcode === 0) {
        this.accessToken = {
          access_token: data.access_token as string,
          expires_in: data.expires_in as number,
          timestamp: Date.now(),
        };
        this.logger.debug('Access token refreshed successfully');
      } else {
        throw new Error(`Failed to get access token: ${data.errmsg} (${data.errcode})`);
      }
    } catch (error) {
      this.logger.error('Failed to refresh access token:', error);
      throw error;
    }
  }

  // ── $formatMessage ──

  $formatMessage(msg: WecomMessage): Message<WecomMessage> {
    const wire = this.parseMessageContent(msg);
    const content = toCanonicalSegments(wire);
    // 企业微信中群消息与私聊消息的判断:
    // 群消息 FromUserName 以 @chatroom 结尾
    const chatType = msg.FromUserName.endsWith('@chatroom') ? 'group' : 'private';
    // NOTE: v1: look up group admin status via WeCom API
    const permit = normalizeWecomSenderForPermit({ isAdmin: false, isOwner: false });

    return Message.from(msg, {
      $id: msg.MsgId || Date.now().toString(),
      $adapter: 'wecom',
      $endpoint: this.$config.name,
      $sender: {
        id: msg.FromUserName,
        name: msg.FromUserName,
        role: permit.role,
        permissions: permit.permissions,
      },
      $channel: {
        id: chatType === 'group' ? msg.FromUserName : msg.FromUserName,
        type: chatType as any,
      },
      $content: content,
      $raw: JSON.stringify(msg),
      $timestamp: (msg.CreateTime || Math.floor(Date.now() / 1000)) * 1000,
      $recall: async () => {
        await this.$recallMessage(msg.MsgId || '');
      },
      $reply: async (content: SendContent): Promise<string> => {
        return await this.adapter.sendMessage({
          context: 'wecom',
          endpoint: this.$config.name,
          id: msg.FromUserName,
          type: chatType,
          content: content,
        });
      },
    });
  }

  private parseMessageContent(msg: WecomMessage): MessageSegment[] {
    const content: MessageSegment[] = [];
    if (!msg.MsgType) return content;
    try {
      switch (msg.MsgType) {
        case 'text':
          if (msg.Content) {
            content.push(segment('text', { content: msg.Content }));
          }
          break;
        case 'image':
          if (msg.MediaId) {
            content.push(segment('image', {
              file: msg.MediaId,
              url: msg.PicUrl || '',
            }));
          }
          break;
        case 'voice':
          if (msg.MediaId) {
            content.push(segment('audio', {
              file: msg.MediaId,
            }));
            // 语音识别结果
            if (msg.Recognition) {
              content.push(segment('text', { content: msg.Recognition }));
            }
          }
          break;
        case 'video':
        case 'shortvideo':
          if (msg.MediaId) {
            content.push(segment('video', {
              file: msg.MediaId,
            }));
          }
          break;
        case 'location':
          content.push(segment('text', {
            content: `[位置] ${msg.Label || ''} (${msg.Location_X}, ${msg.Location_Y})`,
          }));
          break;
        case 'link':
          content.push(segment('link', {
            title: msg.Title || '',
            content: msg.Description || '',
            url: msg.Url || '',
          }));
          break;
        case 'event':
          content.push(segment('text', {
            content: `[事件] ${msg.Event || ''} ${msg.EventKey || ''}`,
          }));
          break;
        default:
          content.push(segment('text', {
            content: `[不支持的消息类型: ${msg.MsgType}]`,
          }));
          break;
      }
    } catch (error) {
      this.logger.error('Failed to parse message content:', error);
      content.push(segment('text', { content: '[消息解析失败]' }));
    }
    return content;
  }

  // ── $sendMessage ──

  async $sendMessage(options: SendOptions): Promise<string> {
    const targetId = options.id;
    const canonical = expandInteractiveSegmentsInContent(options.content);
    const wire = fromCanonicalSegments(canonical);
    const content = this.formatSendContent(wire);
    try {
      const body: Record<string, unknown> = {
        touser: targetId,
        msgtype: content.msgtype,
        agentid: this.$config.agentSecret,
        [content.msgtype]: content.data,
      };

      // 群消息使用 chatid
      if (targetId.endsWith('@chatroom')) {
        delete body.touser;
        body.chatid = targetId;
      }

      const data = await this.request('/cgi-bin/message/send', {
        method: 'POST',
        body,
      });

      if (data.errcode !== 0) {
        throw new Error(`Failed to send message: ${data.errmsg} (${data.errcode})`);
      }
      this.logger.debug(formatCompact({ op: 'send', endpoint: this.$config.name, to: targetId }));
      return data.msgid as string || Date.now().toString();
    } catch (error) {
      this.logger.error('Failed to send message:', error);
      throw error;
    }
  }

  // ── $recallMessage (企业微信不支持机器人撤回) ──

  async $recallMessage(_id: string): Promise<void> {
    this.logger.warn(formatCompact({ op: 'recall', ok: false, error: 'not supported by wecom' }));
  }

  // ── 发送内容格式化 ──

  private formatSendContent(content: SendContent): { msgtype: string; data: Record<string, unknown> } {
    if (typeof content === 'string') {
      return { msgtype: 'text', data: { content } };
    }
    if (Array.isArray(content)) {
      const textParts: string[] = [];
      let hasMedia = false;
      let mediaType = '';
      let mediaData: Record<string, unknown> | null = null;
      let droppedMediaCount = 0;

      for (const item of content) {
        if (typeof item === 'string') {
          textParts.push(item);
          continue;
        }
        const seg = item as MessageSegment;
        switch (seg.type) {
          case 'text':
            textParts.push(seg.data.content || seg.data.text || '');
            break;
          case 'at':
            // 企业微信 @ 格式: <@userid>
            const userId = seg.data.id || seg.data.userId;
            if (userId) textParts.push(`<@${userId}>`);
            break;
          case 'image':
            if (!hasMedia) {
              hasMedia = true;
              mediaType = 'image';
              mediaData = { media_id: seg.data.file || seg.data.url };
            } else {
              droppedMediaCount++;
            }
            break;
          case 'markdown':
            if (!hasMedia) {
              hasMedia = true;
              mediaType = 'markdown';
              mediaData = { content: seg.data.content || seg.data.text };
            } else {
              droppedMediaCount++;
            }
            break;
          case 'link':
            if (!hasMedia) {
              hasMedia = true;
              mediaType = 'news';
              mediaData = {
                articles: [{
                  title: seg.data.title || '链接',
                  description: seg.data.text || seg.data.content || '',
                  url: seg.data.url,
                  picurl: seg.data.picUrl,
                }],
              };
            } else {
              droppedMediaCount++;
            }
            break;
        }
      }

      if (droppedMediaCount > 0) {
        this.logger.warn(formatCompact({
          op: 'formatSend',
          droppedMedia: droppedMediaCount,
          note: 'WeCom API only supports one media segment per message',
        }));
      }

      if (hasMedia && mediaData) {
        return { msgtype: mediaType, data: mediaData };
      }
      return { msgtype: 'text', data: { content: textParts.join('') } };
    }
    return { msgtype: 'text', data: { content: String(content) } };
  }

  // ── 生命周期 ──

  async $connect(): Promise<void> {
    try {
      await this.refreshAccessToken();
      this.$connected = true;
      this.logger.info(formatCompact({ op: 'connect', endpoint: this.$config.name }));
      this.logger.info(formatCompact({ op: 'webhook', path: this.$config.webhookPath || '/wecom/callback' }));
    } catch (error) {
      this.logger.error('Failed to connect WeCom bot:', error);
      throw error;
    }
  }

  async $disconnect(): Promise<void> {
    this.$connected = false;
    this.logger.info(formatCompact({ op: 'disconnect', endpoint: this.$config.name }));
  }

  // ── 企业微信特有 API ──

  async getUserInfo(userId: string): Promise<WecomApiResponse | null> {
    try {
      const data = await this.request('/cgi-bin/user/get', {
        params: { userid: userId },
      });
      if (data.errcode === 0) return data;
      throw new Error(`Failed to get user info: ${data.errmsg}`);
    } catch (error) {
      this.logger.error('Failed to get user info:', error);
      return null;
    }
  }

  async getDepartmentUsers(deptId: number): Promise<unknown[]> {
    try {
      const data = await this.request('/cgi-bin/user/simplelist', {
        params: { department_id: deptId },
      });
      if (data.errcode === 0) return (data.userlist as unknown[]) || [];
      throw new Error(`Failed to get department users: ${data.errmsg}`);
    } catch (error) {
      this.logger.error('Failed to get department users:', error);
      return [];
    }
  }

  async getDepartmentList(deptId: number = 1): Promise<unknown[]> {
    try {
      const data = await this.request('/cgi-bin/department/list', {
        params: { id: deptId },
      });
      if (data.errcode === 0) return (data.department as unknown[]) || [];
      throw new Error(`Failed to get department list: ${data.errmsg}`);
    } catch (error) {
      this.logger.error('Failed to get department list:', error);
      return [];
    }
  }

  async sendTextMessage(userId: string, content: string): Promise<boolean> {
    try {
      const data = await this.request('/cgi-bin/message/send', {
        method: 'POST',
        body: {
          touser: userId,
          msgtype: 'text',
          agentid: this.$config.agentSecret,
          text: { content },
        },
      });
      if (data.errcode === 0) {
        this.logger.debug('Text message sent successfully');
        return true;
      }
      throw new Error(`Failed to send text message: ${data.errmsg}`);
    } catch (error) {
      this.logger.error('Failed to send text message:', error);
      return false;
    }
  }
}
