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
import axios, { AxiosInstance } from 'axios';
import { createHash, createHmac } from 'crypto';

// 声明模块，注册飞书适配器类型
declare module 'zhin.js' {
    interface RegisteredAdapters {
        lark: Adapter<LarkBot>
    }
}

// 飞书配置类型定义
export interface LarkBotConfig extends BotConfig {
    context: 'lark'
    name: string
    appId: string          // 飞书应用 ID
    appSecret: string      // 飞书应用密钥
    encryptKey?: string    // 事件推送加密密钥（可选）
    verificationToken?: string // 事件推送验证令牌（可选）
    webhookPath: string    // Webhook 路径，如 '/lark/webhook'
    // API 配置
    apiBaseUrl?: string    // API 基础 URL，默认为飞书
    isFeishu?: boolean     // 是否为飞书（中国版），默认 false 为 Lark 国际版
}

// 飞书消息类型
export interface LarkMessage {
    message_id?: string
    root_id?: string
    parent_id?: string
    create_time?: string
    update_time?: string
    chat_id?: string
    sender?: {
        sender_id?: {
            user_id?: string
            open_id?: string
            union_id?: string
        }
        sender_type?: string
        tenant_key?: string
    }
    message_type?: string
    content?: string
    mentions?: Array<{
        key?: string
        id?: {
            user_id?: string
            open_id?: string
            union_id?: string
        }
        name?: string
        tenant_key?: string
    }>
}

// 飞书事件类型
interface LarkEvent {
    uuid?: string
    token?: string
    ts?: string
    type?: string
    event?: {
        sender?: any
        message?: LarkMessage
        [key: string]: any
    }
}

// Token 管理
interface AccessToken {
    token: string
    expires_in: number
    timestamp: number
}

// Bot 接口
export interface LarkBot {
    $config: LarkBotConfig
}

// ================================================================================================
// LarkBot 类
// ================================================================================================

export class LarkBot implements Bot<LarkMessage, LarkBotConfig> {
    $connected?: boolean
    private router: any
    private accessToken: AccessToken
    private axiosInstance: AxiosInstance

    constructor(private plugin: Plugin, router: any, public $config: LarkBotConfig) {
        this.router = router;
        this.$connected = false;
        this.accessToken = { token: '', expires_in: 0, timestamp: 0 };
        
        // 设置 API 基础 URL
        const baseURL = $config.apiBaseUrl || ($config.isFeishu ? 
            'https://open.feishu.cn/open-apis' : 
            'https://open.larksuite.com/open-apis'
        );
        
        this.axiosInstance = axios.create({
            baseURL,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json; charset=utf-8'
            }
        });
        
        // 设置请求拦截器，自动添加 access_token
        this.axiosInstance.interceptors.request.use(async (config) => {
            await this.ensureAccessToken();
            config.headers = config.headers || {};
            config.headers['Authorization'] = `Bearer ${this.accessToken.token}`;
            return config;
        });
        
        // 设置 webhook 路由
        this.setupWebhookRoute();
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
            
            // 验证请求（如果配置了验证令牌）
            if (this.$config.verificationToken) {
                const token = headers['x-lark-request-token'] as string;
                if (token !== this.$config.verificationToken) {
                    this.plugin.logger.warn('Invalid verification token in webhook');
                    ctx.status = 403;
                    ctx.body = 'Forbidden';
                    return;
                }
            }
            
            // 签名验证（如果配置了加密密钥）
            if (this.$config.encryptKey) {
                const timestamp = headers['x-lark-request-timestamp'] as string;
                const nonce = headers['x-lark-request-nonce'] as string;
                const signature = headers['x-lark-signature'] as string;
                const bodyStr = JSON.stringify(body);
                
                if (!this.verifySignature(timestamp, nonce, bodyStr, signature)) {
                    this.plugin.logger.warn('Invalid signature in webhook');
                    ctx.status = 403;
                    ctx.body = 'Forbidden';
                    return;
                }
            }
            
            const event: LarkEvent = body;
            
            // URL 验证挑战（首次配置 webhook 时）
            if (event.type === 'url_verification') {
                ctx.body = { challenge: (event as any).challenge };
                return;
            }
            
            // 处理消息事件
            if (event.type === 'event_callback' && event.event) {
                await this.handleEvent(event.event);
            }
            
            ctx.status = 200;
            ctx.body = { code: 0, msg: 'success' };
            
        } catch (error) {
            this.plugin.logger.error('Webhook error:', error);
            ctx.status = 500;
            ctx.body = { code: -1, msg: 'Internal Server Error' };
        }
    }

    private verifySignature(timestamp: string, nonce: string, body: string, signature: string): boolean {
        if (!this.$config.encryptKey) return true;
        
        try {
            const stringToSign = `${timestamp}${nonce}${this.$config.encryptKey}${body}`;
            const calculatedSignature = createHash('sha256').update(stringToSign).digest('hex');
            return calculatedSignature === signature;
        } catch (error) {
            this.plugin.logger.error('Signature verification error:', error);
            return false;
        }
    }

    private async handleEvent(event: any): Promise<void> {
        // 处理消息事件
        if (event.message) {
            const message = this.$formatMessage(event.message, event);
            this.plugin.dispatch('message.receive', message);
            this.plugin.logger.info(`recv ${message.$channel.type}(${message.$channel.id}): ${segment.raw(message.$content)}`);
            this.plugin.dispatch(`message.${message.$channel.type}.receive`, message);
        }
    }

    // ================================================================================================
    // Token 管理
    // ================================================================================================

    private async ensureAccessToken(): Promise<void> {
        const now = Date.now();
        // 提前 5 分钟刷新 token
        if (this.accessToken.token && now < (this.accessToken.timestamp + (this.accessToken.expires_in - 300) * 1000)) {
            return;
        }
        
        await this.refreshAccessToken();
    }

    private async refreshAccessToken(): Promise<void> {
        try {
            const response = await axios.post(
                `${this.$config.apiBaseUrl || (this.$config.isFeishu ? 
                    'https://open.feishu.cn/open-apis' : 
                    'https://open.larksuite.com/open-apis'
                )}/auth/v3/tenant_access_token/internal`,
                {
                    app_id: this.$config.appId,
                    app_secret: this.$config.appSecret
                }
            );
            
            if (response.data.code === 0) {
                this.accessToken = {
                    token: response.data.tenant_access_token,
                    expires_in: response.data.expire,
                    timestamp: Date.now()
                };
                this.plugin.logger.debug('Access token refreshed successfully');
            } else {
                throw new Error(`Failed to get access token: ${response.data.msg}`);
            }
        } catch (error) {
            this.plugin.logger.error('Failed to refresh access token:', error);
            throw error;
        }
    }

    // ================================================================================================
    // 消息格式化
    // ================================================================================================

    $formatMessage(msg: LarkMessage, event?: any): Message<LarkMessage> {
        const content = this.parseMessageContent(msg);
        
        // 确定聊天类型
        const chatType = msg.chat_id?.startsWith('oc_') ? 'group' : 'private';
        
        return Message.from(msg, {
            $id: msg.message_id || Date.now().toString(),
            $adapter: 'lark',
            $bot: this.$config.name,
            $sender: {
                id: msg.sender?.sender_id?.open_id || 'unknown',
                name: msg.sender?.sender_id?.user_id || msg.sender?.sender_id?.open_id || 'Unknown User'
            },
            $channel: {
                id: msg.chat_id || 'unknown',
                type: chatType as any
            },
            $content: content,
            $raw: JSON.stringify(msg),
            $timestamp: msg.create_time ? parseInt(msg.create_time) : Date.now(),
            $reply: async (content: SendContent): Promise<void> => {
                await this.$sendMessage({
                    context: 'lark',
                    bot: this.$config.name,
                    id: msg.chat_id || 'unknown',
                    type: chatType,
                    content: content
                });
            }
        });
    }

    private parseMessageContent(msg: LarkMessage): MessageSegment[] {
        const content: MessageSegment[] = [];
        
        if (!msg.content || !msg.message_type) {
            return content;
        }
        
        try {
            const messageContent = JSON.parse(msg.content);
            
            switch (msg.message_type) {
                case 'text':
                    if (messageContent.text) {
                        content.push(segment('text', { content: messageContent.text }));
                        
                        // 处理 @提及
                        if (msg.mentions) {
                            for (const mention of msg.mentions) {
                                if (mention.key && messageContent.text.includes(mention.key)) {
                                    content.push(segment('at', {
                                        id: mention.id?.open_id,
                                        name: mention.name
                                    }));
                                }
                            }
                        }
                    }
                    break;
                    
                case 'image':
                    content.push(segment('image', {
                        file_key: messageContent.image_key,
                        url: `https://open.feishu.cn/open-apis/im/v1/messages/${msg.message_id}/resources/${messageContent.image_key}`
                    }));
                    break;
                    
                case 'file':
                    content.push(segment('file', {
                        file_key: messageContent.file_key,
                        file_name: messageContent.file_name,
                        file_size: messageContent.file_size
                    }));
                    break;
                    
                case 'audio':
                    content.push(segment('audio', {
                        file_key: messageContent.file_key,
                        duration: messageContent.duration
                    }));
                    break;
                    
                case 'video':
                    content.push(segment('video', {
                        file_key: messageContent.file_key,
                        duration: messageContent.duration,
                        width: messageContent.width,
                        height: messageContent.height
                    }));
                    break;
                    
                case 'sticker':
                    content.push(segment('sticker', {
                        file_key: messageContent.file_key
                    }));
                    break;
                    
                case 'rich_text':
                    // 富文本消息处理（简化）
                    if (messageContent.content) {
                        this.parseRichTextContent(messageContent.content, content);
                    }
                    break;
                    
                case 'post':
                    // 卡片消息处理
                    content.push(segment('card', messageContent));
                    break;
                    
                default:
                    content.push(segment('text', { content: `[不支持的消息类型: ${msg.message_type}]` }));
                    break;
            }
        } catch (error) {
            this.plugin.logger.error('Failed to parse message content:', error);
            content.push(segment('text', { content: '[消息解析失败]' }));
        }
        
        return content;
    }

    private parseRichTextContent(richContent: any, content: MessageSegment[]): void {
        // 简化的富文本解析
        if (Array.isArray(richContent)) {
            for (const block of richContent) {
                if (block.tag === 'text' && block.text) {
                    content.push(segment('text', { content: block.text }));
                } else if (block.tag === 'a' && block.href) {
                    content.push(segment('link', { 
                        url: block.href, 
                        text: block.text || block.href 
                    }));
                } else if (block.tag === 'at' && block.user_id) {
                    content.push(segment('at', { 
                        id: block.user_id,
                        name: block.user_name 
                    }));
                }
            }
        }
    }

    // ================================================================================================
    // 消息发送
    // ================================================================================================

    async $sendMessage(options: SendOptions): Promise<void> {
        const chatId = options.id;
        const content = this.formatSendContent(options.content);
        
        try {
            const response = await this.axiosInstance.post('/im/v1/messages', {
                receive_id: chatId,
                receive_id_type: 'chat_id',
                msg_type: content.msg_type,
                content: content.content
            });
            
            if (response.data.code !== 0) {
                throw new Error(`Failed to send message: ${response.data.msg}`);
            }
            
            this.plugin.logger.debug('Message sent successfully:', response.data.data?.message_id);
        } catch (error) {
            this.plugin.logger.error('Failed to send message:', error);
            throw error;
        }
    }

    private formatSendContent(content: SendContent): { msg_type: string, content: string } {
        if (typeof content === 'string') {
            return {
                msg_type: 'text',
                content: JSON.stringify({ text: content })
            };
        }
        
        if (Array.isArray(content)) {
            const textParts: string[] = [];
            let hasMedia = false;
            let mediaContent: any = null;
            
            for (const item of content) {
                if (typeof item === 'string') {
                    textParts.push(item);
                } else {
                    const segment = item as MessageSegment;
                    switch (segment.type) {
                        case 'text':
                            textParts.push(segment.data.content || segment.data.text || '');
                            break;
                            
                        case 'at':
                            textParts.push(`<at user_id="${segment.data.id}">${segment.data.name || segment.data.id}</at>`);
                            break;
                            
                        case 'image':
                            if (!hasMedia) {
                                hasMedia = true;
                                mediaContent = {
                                    msg_type: 'image',
                                    content: JSON.stringify({
                                        image_key: segment.data.file_key || segment.data.key
                                    })
                                };
                            }
                            break;
                            
                        case 'file':
                            if (!hasMedia) {
                                hasMedia = true;
                                mediaContent = {
                                    msg_type: 'file',
                                    content: JSON.stringify({
                                        file_key: segment.data.file_key || segment.data.key
                                    })
                                };
                            }
                            break;
                            
                        case 'card':
                            if (!hasMedia) {
                                hasMedia = true;
                                mediaContent = {
                                    msg_type: 'interactive',
                                    content: JSON.stringify(segment.data)
                                };
                            }
                            break;
                    }
                }
            }
            
            // 优先发送媒体内容
            if (hasMedia && mediaContent) {
                return mediaContent;
            }
            
            // 否则发送文本内容
            return {
                msg_type: 'text',
                content: JSON.stringify({ text: textParts.join('') })
            };
        }
        
        return {
            msg_type: 'text',
            content: JSON.stringify({ text: String(content) })
        };
    }

    // ================================================================================================
    // Bot 生命周期
    // ================================================================================================

    async $connect(): Promise<void> {
        try {
            // 获取 access token
            await this.refreshAccessToken();
            
            this.$connected = true;
            this.plugin.logger.info(`Lark bot connected: ${this.$config.name}`);
            this.plugin.logger.info(`Webhook URL: ${this.$config.webhookPath}`);
            
        } catch (error) {
            this.plugin.logger.error('Failed to connect Lark bot:', error);
            throw error;
        }
    }

    async $disconnect(): Promise<void> {
        try {
            this.$connected = false;
            this.plugin.logger.info('Lark bot disconnected');
        } catch (error) {
            this.plugin.logger.error('Error disconnecting Lark bot:', error);
        }
    }

    // ================================================================================================
    // 工具方法
    // ================================================================================================

    // 获取用户信息
    async getUserInfo(userId: string, userIdType: 'open_id' | 'user_id' | 'union_id' = 'open_id'): Promise<any> {
        try {
            const response = await this.axiosInstance.get(`/contact/v3/users/${userId}`, {
                params: { user_id_type: userIdType }
            });
            
            return response.data.data?.user;
        } catch (error) {
            this.plugin.logger.error('Failed to get user info:', error);
            return null;
        }
    }

    // 获取群聊信息
    async getChatInfo(chatId: string): Promise<any> {
        try {
            const response = await this.axiosInstance.get(`/im/v1/chats/${chatId}`);
            return response.data.data;
        } catch (error) {
            this.plugin.logger.error('Failed to get chat info:', error);
            return null;
        }
    }

    // 上传文件
    async uploadFile(filePath: string, fileType: 'image' | 'file' | 'video' | 'audio' = 'file'): Promise<string | null> {
        try {
            const FormData = require('form-data');
            const fs = require('fs');
            
            const form = new FormData();
            form.append('file', fs.createReadStream(filePath));
            form.append('file_type', fileType);
            
            const response = await this.axiosInstance.post('/im/v1/files', form, {
                headers: {
                    ...form.getHeaders()
                }
            });
            
            if (response.data.code === 0) {
                return response.data.data.file_key;
            }
            
            throw new Error(`Upload failed: ${response.data.msg}`);
        } catch (error) {
            this.plugin.logger.error('Failed to upload file:', error);
            return null;
        }
    }
}

// 注册适配器（需要 router）
useContext('router', (router) => {
    registerAdapter(new Adapter('lark', 
        (plugin: Plugin, config: any) => new LarkBot(plugin, router, config as LarkBotConfig)
    ));
});
