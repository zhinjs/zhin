import axios from 'axios';
import * as xml2js from 'xml2js';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import {
    Bot,
    BotConfig,
    Adapter,
    Plugin,
    registerAdapter,
    Message,
    SendOptions,
    SendContent,
    MessageSegment,
    segment,
    useContext
} from "zhin.js";
import type { Context } from 'koa';

// Router 类型声明 (从 @koa/router)
interface Router {
    get(path: string, handler: (ctx: Context) => void): void;
    post(path: string, handler: (ctx: Context) => void): void;
}

// 声明模块，注册微信公众号适配器类型
declare module 'zhin.js' {
    interface RegisteredAdapters {
        'wechat-mp': Adapter<WeChatMPBot>
    }
}

// 微信公众号配置
export interface WeChatMPConfig extends BotConfig {
    context: 'wechat-mp'
    name: string
    appId: string
    appSecret: string
    token: string
    encodingAESKey?: string
    path: string  // webhook路径，必需
    // 是否启用加密模式
    encrypt?: boolean
}

// 微信消息基础接口
export interface WeChatMessage {
    ToUserName: string
    FromUserName: string
    CreateTime: number
    MsgType: string
    MsgId?: string
    Content?: string
    PicUrl?: string
    MediaId?: string
    Format?: string
    Recognition?: string
    ThumbMediaId?: string
    Location_X?: string
    Location_Y?: string
    Scale?: string
    Label?: string
    Title?: string
    Description?: string
    Url?: string
    Event?: string
    EventKey?: string
}

// Access Token 响应
interface TokenResponse {
    access_token: string
    expires_in: number
}

// API 响应基础接口
interface WeChatAPIResponse {
    errcode?: number
    errmsg?: string
}

export class WeChatMPBot extends EventEmitter implements Bot<WeChatMessage, WeChatMPConfig> {
    $config: WeChatMPConfig;
    plugin: Plugin;
    router: Router;
    
    private accessToken: string | null = null;
    private tokenExpireTime: number = 0;
    private isConnected = false;

    constructor(plugin: Plugin, router: Router, config: WeChatMPConfig) {
        super();
        this.$config = config;
        this.plugin = plugin;
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
            
            this.isConnected = true;
            this.plugin.logger.info(`WeChat MP bot connected: ${this.$config.name}`);
            this.plugin.logger.info(`Webhook URL: ${this.$config.path}`);
            
        } catch (error) {
            this.plugin.logger.error('Failed to connect WeChat MP bot:', error);
            throw error;
        }
    }

    async $disconnect(): Promise<void> {
        this.isConnected = false;
        this.plugin.logger.info('WeChat MP bot disconnected');
    }

    private handleVerification(ctx: Context): void {
        const { signature, timestamp, nonce, echostr } = ctx.query;
        
        if (this.verifySignature(
            signature as string, 
            timestamp as string, 
            nonce as string
        )) {
            this.plugin.logger.info('WeChat verification successful');
            ctx.body = echostr;
        } else {
            this.plugin.logger.error('WeChat verification failed');
            ctx.status = 403;
            ctx.body = 'Forbidden';
        }
    }

    private async handleMessage(ctx: Context): Promise<void> {
        try {
            const { signature, timestamp, nonce } = ctx.query;
            
            // 验证签名
            if (!this.verifySignature(
                signature as string,
                timestamp as string, 
                nonce as string
            )) {
                this.plugin.logger.error('Invalid signature');
                ctx.status = 403;
                ctx.body = 'Forbidden';
                return;
            }
            
            // 获取原始XML数据
            const xmlBody = (ctx as any).request.rawBody || (ctx as any).body;
            const wechatMessage = await this.parseXMLMessage(xmlBody?.toString() || '');
            
            if (wechatMessage) {
                const message = this.$formatMessage(wechatMessage);
                this.plugin.dispatch('message.receive', message);
                
                // 处理被动回复
                const replyXML = await this.handlePassiveReply(wechatMessage, message);
                ctx.set('Content-Type', 'text/xml');
                ctx.body = replyXML || 'success';
            } else {
                ctx.body = 'success';
            }
        } catch (error) {
            this.plugin.logger.error('Error handling WeChat message:', error);
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
            this.plugin.logger.error('Error parsing XML:', error);
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
            $reply: async (content: SendContent): Promise<void> => {
                this.plugin.dispatch('message.send', {
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

    async $sendMessage(options: SendOptions): Promise<void> {
        try {
            // 公众号主动发送消息需要通过模板消息或客服消息API
            await this.sendCustomerServiceMessage(options);
        } catch (error) {
            this.plugin.logger.error('Failed to send WeChat message:', error);
            throw error;
        }
    }

    private async sendCustomerServiceMessage(options: SendOptions): Promise<void> {
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
                    return this.buildTextReply(wechatMsg, '感谢关注！');
                case 'unsubscribe':
                    // 取关事件不能回复消息
                    return '';
            }
        }
        
        // 这里可以添加自定义的被动回复逻辑
        // 返回空字符串表示不回复
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
                this.plugin.logger.info('Access token refreshed successfully');
            } else {
                throw new Error('Failed to get access token');
            }
        } catch (error) {
            this.plugin.logger.error('Failed to refresh access token:', error);
            throw error;
        }
    }

    private startTokenRefreshTimer(): void {
        // 每小时检查一次token是否需要刷新
        setInterval(async () => {
            if (Date.now() >= this.tokenExpireTime) {
                try {
                    await this.refreshAccessToken();
                } catch (error) {
                    this.plugin.logger.error('Failed to refresh access token in timer:', error);
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

    // 上传多媒体文件 (暂时禁用，需要处理 FormData 兼容性)
    async uploadMedia(type: 'image' | 'voice' | 'video' | 'thumb', buffer: Buffer): Promise<string> {
        // TODO: 实现文件上传功能
        // 需要处理 Node.js FormData 与浏览器 FormData 的兼容性问题
        throw new Error('Media upload feature is not implemented yet');
    }
}

// 使用路由服务注册适配器
useContext('router', (router: Router) => {
    registerAdapter(new Adapter('wechat-mp', (plugin: Plugin, config: WeChatMPConfig) => new WeChatMPBot(plugin, router, config)));
});
