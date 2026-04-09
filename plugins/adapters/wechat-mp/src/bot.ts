/**
 * 微信公众号 Bot 实现
 */
import axios from "axios";
import * as xml2js from "xml2js";
import { createHash, createDecipheriv, createCipheriv, randomBytes } from "crypto";
import { EventEmitter } from "events";
import FormData from "form-data";
import { Bot, Message, SendOptions, SendContent, MessageSegment, segment } from "zhin.js";
import type { Context } from "koa";
import type { Router } from "@zhin.js/http";
import type { WeChatMPConfig, WeChatMessage, WeChatAPIResponse, TokenResponse } from "./types.js";
import type { WeChatMPAdapter } from "./adapter.js";

export class WeChatMPBot extends EventEmitter implements Bot<WeChatMPConfig, WeChatMessage> {
    $config: WeChatMPConfig;
    $connected: boolean = false;
    router: Router;
    
    private accessToken: string | null = null;
    private tokenExpireTime: number = 0;

    get logger() {
    return this.adapter.plugin.logger;
  }

  get $id() {
        return this.$config.name;
    }

    constructor(public adapter: WeChatMPAdapter, router: Router, config: WeChatMPConfig) {
        super();
        this.$config = config;
        this.router = router;
        
        // 设置默认值
        this.$config.encrypt = this.$config.encrypt || false;
    }

    private setupRoutes(): void {
        const path = this.$config.path;
        
        // 微信服务器验证 (GET)
        this.router.get(path, (ctx: Context) => {
            this.handleVerification(ctx);
        });
        
        // 接收微信消息 (POST) 
        this.router.post(path, (ctx: Context) => {
            this.handleMessage(ctx);
        });
    }

    async $connect(): Promise<void> {
        try {
            // 获取access_token
            await this.refreshAccessToken();
            
            // 设置路由
            this.setupRoutes();
            
            // 定期刷新access_token
            this.startTokenRefreshTimer();
            
            this.logger.info(`WeChat MP bot connected: ${this.$config.name}`);
            this.logger.info(`Webhook URL: ${this.$config.path}`);
            this.$connected= true;
        } catch (error) {
            this.logger.error('Failed to connect WeChat MP bot:', error);
            throw error;
        }
    }

    async $disconnect(): Promise<void> {
        if (this.tokenRefreshTimer) {
            clearInterval(this.tokenRefreshTimer);
            this.tokenRefreshTimer = undefined;
        }
        this.$connected = false;
        this.logger.info('WeChat MP bot disconnected');
    }

    private handleVerification(ctx: Context): void {
        const { signature, timestamp, nonce, echostr } = ctx.query;
        
        if (this.verifySignature(
            signature as string, 
            timestamp as string, 
            nonce as string
        )) {
            this.logger.info('WeChat verification successful');
            ctx.body = echostr;
        } else {
            this.logger.error('WeChat verification failed');
            ctx.status = 403;
            ctx.body = 'Forbidden';
        }
    }

    private async handleMessage(ctx: Context): Promise<void> {
        try {
            const { signature, timestamp, nonce, msg_signature, encrypt_type } = ctx.query;
            
            // 验证签名
            if (!this.verifySignature(
                signature as string,
                timestamp as string, 
                nonce as string
            )) {
                this.logger.error('Invalid signature');
                ctx.status = 403;
                ctx.body = 'Forbidden';
                return;
            }
            
            // 获取原始XML数据
            let xmlBody = (ctx as any).request.rawBody || (ctx as any).body;
            let xmlString = xmlBody?.toString() || '';

            // AES 加密模式：先解密
            if (this.$config.encrypt && encrypt_type === 'aes' && this.$config.encodingAESKey) {
                xmlString = await this.decryptMessage(
                    xmlString,
                    msg_signature as string,
                    timestamp as string,
                    nonce as string
                );
            }

            const wechatMessage = await this.parseXMLMessage(xmlString);
            
            if (wechatMessage) {
                const message = this.$formatMessage(wechatMessage);
                this.adapter.emit('message.receive', message);
                
                // 处理被动回复
                let replyXML = await this.handlePassiveReply(wechatMessage, message);

                // AES 加密模式：加密回复
                if (replyXML && this.$config.encrypt && this.$config.encodingAESKey) {
                    replyXML = this.encryptMessage(replyXML);
                }

                ctx.set('Content-Type', 'text/xml');
                ctx.body = replyXML || 'success';
            } else {
                ctx.body = 'success';
            }
        } catch (error) {
            this.logger.error('Error handling WeChat message:', error);
            ctx.body = 'success';
        }
    }

    private verifySignature(signature: string, timestamp: string, nonce: string): boolean {
        const token = this.$config.token;
        const arr = [token, timestamp, nonce].sort();
        const str = arr.join('');
        const hash = createHash('sha1').update(str).digest('hex');
        return hash === signature;
    }

    private async parseXMLMessage(xmlString: string): Promise<WeChatMessage | null> {
        try {
            const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
            const result = await parser.parseStringPromise(xmlString);
            return result.xml as WeChatMessage;
        } catch (error) {
            this.logger.error('Error parsing XML:', error);
            return null;
        }
    }

    $formatMessage(wechatMsg: WeChatMessage): Message<WeChatMessage> {
        const channelType = 'private'; // 公众号消息都是私聊
        const channelId = wechatMsg.FromUserName;
        
        // 解析消息内容
        const content = WeChatMPBot.parseMessageContent(wechatMsg);
        
        const result = Message.from(wechatMsg, {
            $id: wechatMsg.MsgId || `${wechatMsg.CreateTime}`,
            $adapter: 'wechat-mp',
            $bot: this.$config.name,
            $sender: {
                id: wechatMsg.FromUserName,
                name: wechatMsg.FromUserName
            },
            $channel: {
                id: channelId,
                type: channelType as any
            },
            $raw: JSON.stringify(wechatMsg),
            $timestamp: wechatMsg.CreateTime * 1000,
            $content: content,
            $recall: async () => {
                await this.$recallMessage(result.$id)
            },
            $reply: async (content: SendContent): Promise<string> => {
                return await this.adapter.sendMessage({
                    context: this.$config.context,
                    bot: this.$config.name,
                    id: wechatMsg.FromUserName,
                    type: 'private',
                    content
                });
            }
        });
        
        return result;
    }

    static parseMessageContent(wechatMsg: WeChatMessage): MessageSegment[] {
        const segments: MessageSegment[] = [];
        
        switch (wechatMsg.MsgType) {
            case 'text':
                if (wechatMsg.Content) {
                    segments.push(segment.text(wechatMsg.Content));
                }
                break;
                
            case 'image':
                segments.push(segment('image', {
                    url: wechatMsg.PicUrl,
                    mediaId: wechatMsg.MediaId
                }));
                break;
                
            case 'voice':
                segments.push(segment('voice', {
                    mediaId: wechatMsg.MediaId,
                    format: wechatMsg.Format,
                    recognition: wechatMsg.Recognition
                }));
                break;
                
            case 'video':
            case 'shortvideo':
                segments.push(segment('video', {
                    mediaId: wechatMsg.MediaId,
                    thumbMediaId: wechatMsg.ThumbMediaId
                }));
                break;
                
            case 'location':
                segments.push(segment('location', {
                    latitude: wechatMsg.Location_X,
                    longitude: wechatMsg.Location_Y,
                    scale: wechatMsg.Scale,
                    label: wechatMsg.Label
                }));
                break;
                
            case 'link':
                segments.push(segment('link', {
                    title: wechatMsg.Title,
                    description: wechatMsg.Description,
                    url: wechatMsg.Url
                }));
                break;
                
            case 'event':
                segments.push(segment('event', {
                    event: wechatMsg.Event,
                    eventKey: wechatMsg.EventKey
                }));
                break;
                
            default:
                segments.push(segment.text(`[不支持的消息类型: ${wechatMsg.MsgType}]`));
        }
        
        return segments.length > 0 ? segments : [segment.text('(空消息)')];
    }

    async $sendMessage(options: SendOptions): Promise<string> {
        try {
            // 公众号主动发送消息需要通过客服消息API
            const msgId = await this.sendCustomerServiceMessage(options);
            return msgId;
        } catch (error) {
            this.logger.error('Failed to send WeChat message:', error);
            throw error;
        }
    }
    async $recallMessage(id: string): Promise<void> {
        // 公众号不支持撤回消息
    }

    private async sendCustomerServiceMessage(options: SendOptions): Promise<string> {
        if (!this.accessToken) {
            await this.refreshAccessToken();
        }
        
        const url = `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${this.accessToken}`;
        
        const messageData = this.formatSendContent(options);
        
        const response = await axios.post(url, messageData);
        const result = response.data as WeChatAPIResponse;
        
        if (result.errcode && result.errcode !== 0) {
            throw new Error(`WeChat API error: ${result.errcode} - ${result.errmsg}`);
        }

        return result.msgid?.toString() || `cs_${Date.now()}`;
    }

    private formatSendContent(options: SendOptions): any {
        const messageData: any = {
            touser: options.id,
            msgtype: 'text',
            text: {
                content: ''
            }
        };
        
        if (typeof options.content === 'string') {
            messageData.text.content = options.content;
        } else if (Array.isArray(options.content)) {
            const textParts: string[] = [];
            let hasMedia = false;
            
            for (const item of options.content) {
                if (typeof item === 'string') {
                    textParts.push(item);
                } else {
                    const segment = item as MessageSegment;
                    switch (segment.type) {
                        case 'text':
                            const textContent = segment.data.text || segment.data.content || '';
                            textParts.push(textContent);
                            break;
                            
                        case 'image':
                            if (!hasMedia && segment.data.mediaId) {
                                messageData.msgtype = 'image';
                                messageData.image = { media_id: segment.data.mediaId };
                                delete messageData.text;
                                hasMedia = true;
                            }
                            break;
                            
                        case 'voice':
                            if (!hasMedia && segment.data.mediaId) {
                                messageData.msgtype = 'voice';
                                messageData.voice = { media_id: segment.data.mediaId };
                                delete messageData.text;
                                hasMedia = true;
                            }
                            break;
                            
                        case 'video':
                            if (!hasMedia && segment.data.mediaId) {
                                messageData.msgtype = 'video';
                                messageData.video = {
                                    media_id: segment.data.mediaId,
                                    title: segment.data.title || '',
                                    description: segment.data.description || ''
                                };
                                delete messageData.text;
                                hasMedia = true;
                            }
                            break;
                    }
                }
            }
            
            if (!hasMedia && textParts.length > 0) {
                messageData.text.content = textParts.join('\n');
            }
        }
        
        return messageData;
    }

    private async handlePassiveReply(wechatMsg: WeChatMessage, message: Message<WeChatMessage>): Promise<string> {
        // 事件类型消息的自动回复
        if (wechatMsg.MsgType === 'event') {
            switch (wechatMsg.Event) {
                case 'subscribe':
                    this.logger.info(`User subscribed: ${wechatMsg.FromUserName}${wechatMsg.EventKey ? `, scene: ${wechatMsg.EventKey}` : ''}`);
                    return this.buildTextReply(wechatMsg, '感谢关注！');
                case 'unsubscribe':
                    this.logger.info(`User unsubscribed: ${wechatMsg.FromUserName}`);
                    return '';
                case 'SCAN':
                    this.logger.info(`User scanned QR: ${wechatMsg.FromUserName}, scene: ${wechatMsg.EventKey}`);
                    return '';
                case 'LOCATION':
                    this.logger.debug(`User location: ${wechatMsg.FromUserName}, lat=${wechatMsg.Location_X}, lng=${wechatMsg.Location_Y}`);
                    return '';
                case 'CLICK':
                    this.logger.debug(`Menu click: ${wechatMsg.EventKey}`);
                    return '';
                case 'VIEW':
                    this.logger.debug(`Menu view: ${wechatMsg.EventKey}`);
                    return '';
            }
        }
        
        return '';
    }

    private buildTextReply(wechatMsg: WeChatMessage, content: string): string {
        const replyMsg = {
            xml: {
                ToUserName: wechatMsg.FromUserName,
                FromUserName: wechatMsg.ToUserName,
                CreateTime: Math.floor(Date.now() / 1000),
                MsgType: 'text',
                Content: content
            }
        };
        
        const builder = new xml2js.Builder({ rootName: 'xml', headless: true });
        return builder.buildObject(replyMsg);
    }

    private async refreshAccessToken(): Promise<void> {
        const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${this.$config.appId}&secret=${this.$config.appSecret}`;
        
        try {
            const response = await axios.get<TokenResponse>(url);
            const data = response.data;
            
            if (data.access_token) {
                this.accessToken = data.access_token;
                this.tokenExpireTime = Date.now() + (data.expires_in - 300) * 1000; // 提前5分钟刷新
                this.logger.info('Access token refreshed successfully');
            } else {
                throw new Error('Failed to get access token');
            }
        } catch (error) {
            this.logger.error('Failed to refresh access token:', error);
            throw error;
        }
    }

    private tokenRefreshTimer?: ReturnType<typeof setInterval>;

    private startTokenRefreshTimer(): void {
        // 每小时检查一次token是否需要刷新
        this.tokenRefreshTimer = setInterval(async () => {
            if (Date.now() >= this.tokenExpireTime) {
                try {
                    await this.refreshAccessToken();
                } catch (error) {
                    this.logger.error('Failed to refresh access token in timer:', error);
                }
            }
        }, 3600000); // 1小时
    }

    // 获取用户信息
    async getUserInfo(openid: string): Promise<any> {
        if (!this.accessToken) {
            await this.refreshAccessToken();
        }
        
        const url = `https://api.weixin.qq.com/cgi-bin/user/info?access_token=${this.accessToken}&openid=${openid}&lang=zh_CN`;
        
        const response = await axios.get(url);
        return response.data;
    }

    /**
     * 上传多媒体文件到微信服务器
     * @param type 媒体类型：image(图片)、voice(语音)、video(视频)、thumb(缩略图)
     * @param buffer 文件 Buffer
     * @param filename 文件名（可选，用于确定文件类型）
     * @returns 微信服务器返回的 media_id
     */
    async uploadMedia(
        type: 'image' | 'voice' | 'video' | 'thumb',
        buffer: Buffer,
        filename?: string
    ): Promise<string> {
        try {
            // 确保有有效的 access_token
            if (!this.accessToken) {
                await this.refreshAccessToken();
            }
            const token = this.accessToken;
            const url = `https://api.weixin.qq.com/cgi-bin/media/upload?access_token=${token}&type=${type}`;
            
            // 创建 FormData
            const form = new FormData();
            
            // 根据类型确定文件扩展名
            const ext = this.getFileExtension(type, filename);
            const mediaFilename = filename || `media.${ext}`;
            
            // 添加文件到 FormData
            form.append('media', buffer, {
                filename: mediaFilename,
                contentType: this.getContentType(type),
            });
            
            // 发送上传请求
            const response = await axios.post(url, form, {
                headers: {
                    ...form.getHeaders(),
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
            });
            
            if (response.data.errcode) {
                throw new Error(
                    `微信媒体上传失败: ${response.data.errmsg} (错误码: ${response.data.errcode})`
                );
            }
            
            return response.data.media_id;
        } catch (error) {
            this.logger.error('上传媒体文件失败:', error);
            throw error;
        }
    }
    
    /**
     * 获取文件扩展名
     */
    private getFileExtension(type: string, filename?: string): string {
        if (filename) {
            const match = filename.match(/\.([^.]+)$/);
            if (match) return match[1];
        }
        
        // 默认扩展名
        const defaultExt: Record<string, string> = {
            image: 'jpg',
            voice: 'mp3',
            video: 'mp4',
            thumb: 'jpg',
        };
        
        return defaultExt[type] || 'bin';
    }
    
    /**
     * 获取 Content-Type
     */
    private getContentType(type: string): string {
        const contentTypes: Record<string, string> = {
            image: 'image/jpeg',
            voice: 'audio/mpeg',
            video: 'video/mp4',
            thumb: 'image/jpeg',
        };
        
        return contentTypes[type] || 'application/octet-stream';
    }

    // ── AES 加解密（安全模式） ──────────────────────────────

    private getAESKey(): Buffer {
        const key = this.$config.encodingAESKey!;
        return Buffer.from(key + '=', 'base64');
    }

    /**
     * 解密微信推送的加密消息
     */
    private async decryptMessage(
        encryptedXml: string,
        msgSignature: string,
        timestamp: string,
        nonce: string
    ): Promise<string> {
        // 从外层 XML 提取 Encrypt 字段
        const parsed = await this.parseXMLMessage(encryptedXml);
        const encrypt = (parsed as any)?.Encrypt;
        if (!encrypt) throw new Error('Missing Encrypt field in encrypted message');

        // 校验 msg_signature
        const expected = createHash('sha1')
            .update([this.$config.token, timestamp, nonce, encrypt].sort().join(''))
            .digest('hex');
        if (expected !== msgSignature) {
            throw new Error('msg_signature verification failed');
        }

        // AES-256-CBC 解密
        const aesKey = this.getAESKey();
        const iv = aesKey.subarray(0, 16);
        const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
        decipher.setAutoPadding(false);

        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(encrypt, 'base64')),
            decipher.final()
        ]);

        // 去除 PKCS#7 填充
        const pad = decrypted[decrypted.length - 1];
        const content = decrypted.subarray(0, decrypted.length - pad);

        // 格式: 16 bytes random + 4 bytes msgLen (network order) + msg + appId
        const msgLen = content.readUInt32BE(16);
        const xmlContent = content.subarray(20, 20 + msgLen).toString('utf8');
        const appId = content.subarray(20 + msgLen).toString('utf8');

        if (appId !== this.$config.appId) {
            throw new Error(`AppID mismatch: expected ${this.$config.appId}, got ${appId}`);
        }

        return xmlContent;
    }

    /**
     * 加密被动回复消息
     */
    private encryptMessage(replyXml: string): string {
        const aesKey = this.getAESKey();
        const iv = aesKey.subarray(0, 16);

        // 组装明文: 16 bytes random + 4 bytes msgLen + msg + appId
        const random = randomBytes(16);
        const msgBuf = Buffer.from(replyXml, 'utf8');
        const appIdBuf = Buffer.from(this.$config.appId, 'utf8');
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(msgBuf.length, 0);

        const plaintext = Buffer.concat([random, lenBuf, msgBuf, appIdBuf]);

        // PKCS#7 填充
        const blockSize = 32;
        const padLen = blockSize - (plaintext.length % blockSize);
        const padBuf = Buffer.alloc(padLen, padLen);
        const padded = Buffer.concat([plaintext, padBuf]);

        // AES-256-CBC 加密
        const cipher = createCipheriv('aes-256-cbc', aesKey, iv);
        cipher.setAutoPadding(false);
        const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
        const encryptStr = encrypted.toString('base64');

        // 签名
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const nonce = randomBytes(8).toString('hex');
        const signature = createHash('sha1')
            .update([this.$config.token, timestamp, nonce, encryptStr].sort().join(''))
            .digest('hex');

        return [
            '<xml>',
            `<Encrypt><![CDATA[${encryptStr}]]></Encrypt>`,
            `<MsgSignature><![CDATA[${signature}]]></MsgSignature>`,
            `<TimeStamp>${timestamp}</TimeStamp>`,
            `<Nonce><![CDATA[${nonce}]]></Nonce>`,
            '</xml>'
        ].join('\n');
    }
}

// 定义 Adapter 类
