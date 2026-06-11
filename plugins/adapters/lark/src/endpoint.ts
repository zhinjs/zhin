/**
 * 飞书/Lark Endpoint 实现
 */
import { registerFetchRoute, type Router, type RouterContext } from "@zhin.js/host-router/router";
import axios, { type AxiosInstance } from "axios";
import { createHash } from "crypto";
import { formatCompact, Endpoint, Message, MessageSegment, segment, SendContent, SendOptions } from 'zhin.js';
import type { LarkEndpointConfig, LarkMessage, LarkEvent, AccessToken } from "./types.js";
import type { LarkAdapter } from "./adapter.js";
import { normalizeLarkSenderForPermit } from "./platform-permit.js";

export class LarkEndpoint implements Endpoint<LarkEndpointConfig, LarkMessage> {
    $connected: boolean
    private router: any
    private accessToken: AccessToken
    private axiosInstance: AxiosInstance

    get logger() {
    return this.adapter.plugin.logger;
  }

  get $id() {
        return this.$config.name;
    }

    constructor(public adapter: LarkAdapter, router: any, public $config: LarkEndpointConfig) {
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
            config.headers = config.headers;
            config.headers['Authorization'] = `Bearer ${this.accessToken.token}`;
            return config;
        });
        
        // 设置 webhook 路由
        this.setupWebhookRoute();
    }

    private setupWebhookRoute(): void {
        registerFetchRoute(this.router, "POST", this.$config.webhookPath, (ctx: RouterContext) => {
            void this.handleWebhook(ctx);
        });
    }

    private async handleWebhook(ctx: RouterContext): Promise<void> {
        try {
            const body = ctx.request.body;
            
            // 验证请求（如果配置了验证令牌）
            if (this.$config.verificationToken) {
                const token = ctx.get('x-lark-request-token');
                if (token !== this.$config.verificationToken) {
                    this.logger.warn(formatCompact( { op: 'webhook', ok: false, error: 'invalid verification token' }));
                    ctx.status = 403;
                    ctx.body = 'Forbidden';
                    return;
                }
            }
            
            // 签名验证（如果配置了加密密钥）
            if (this.$config.encryptKey) {
                const timestamp = ctx.get('x-lark-request-timestamp');
                const nonce = ctx.get('x-lark-request-nonce');
                const signature = ctx.get('x-lark-signature');
                const bodyStr = JSON.stringify(body);
                
                if (!timestamp || !nonce || !signature || !this.verifySignature(timestamp, nonce, bodyStr, signature)) {
                    this.logger.warn(formatCompact( { op: 'webhook', ok: false, error: 'invalid signature' }));
                    ctx.status = 403;
                    ctx.body = 'Forbidden';
                    return;
                }
            }
            
            const event = body as LarkEvent;
            
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
            this.logger.error('Webhook error:', error);
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
            this.logger.error('Signature verification error:', error);
            return false;
        }
    }

    private chatPermitCache = new Map<string, { at: number; ownerId?: string; managers: string[] }>();

    private async enrichGroupSender(message: Message<LarkMessage>, msg: LarkMessage): Promise<void> {
        if (message.$channel.type !== 'group' || !msg.chat_id) return;
        const senderId = msg.sender?.sender_id?.open_id;
        if (!senderId) return;
        const now = Date.now();
        let ownerId: string | undefined;
        let managers: string[] = [];
        const cached = this.chatPermitCache.get(msg.chat_id);
        if (cached && now - cached.at < 60_000) {
            ownerId = cached.ownerId;
            managers = cached.managers;
        } else {
            try {
                const chat = await this.getChatInfo(msg.chat_id);
                ownerId = chat?.owner_id;
                managers = Array.isArray(chat?.user_manager_id_list) ? chat.user_manager_id_list : [];
                this.chatPermitCache.set(msg.chat_id, { at: now, ownerId, managers });
            } catch {
                return;
            }
        }
        const permit = normalizeLarkSenderForPermit({
            isOwner: ownerId === senderId,
            isAdmin: managers.includes(senderId),
        });
        message.$sender.role = permit.role;
        message.$sender.permissions = permit.permissions;
    }

    private async handleEvent(event: any): Promise<void> {
        // 处理消息事件
        if (event.message) {
            const message = this.$formatMessage(event.message, event);
            await this.enrichGroupSender(message, event.message);
            this.adapter.emit('message.receive', message);
            this.logger.debug(formatCompact( {
              op: 'recv',
              endpoint: this.$config.name,
              channel: message.$channel.type,
              id: message.$channel.id,
              len: segment.raw(message.$content).length,
            }));
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
                this.logger.debug('Access token refreshed successfully');
            } else {
                throw new Error(`Failed to get access token: ${response.data.msg}`);
            }
        } catch (error) {
            this.logger.error('Failed to refresh access token:', error);
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
            $endpoint: this.$config.name,
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
            $recall: async () => {
                await this.$recallMessage(msg.message_id || '');
            },
            $reply: async (content: SendContent): Promise<string> => {
                return await this.adapter.sendMessage({
                    context: 'lark',
                    endpoint: this.$config.name,
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
            this.logger.error('Failed to parse message content:', error);
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

    async $sendMessage(options: SendOptions): Promise<string> {
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
            
            this.logger.debug('Message sent successfully:', response.data.data?.message_id);
            return response.data.data?.message_id || '';
        } catch (error) {
            this.logger.error('Failed to send message:', error);
            throw error;
        }
    }
    async $recallMessage(id:string):Promise<void> {
        await this.axiosInstance.post('/im/v1/messages/recall', {
            message_id: id
        });
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
    // Endpoint 生命周期
    // ================================================================================================

    async $connect(): Promise<void> {
        try {
            // 获取 access token
            await this.refreshAccessToken();
            
            this.$connected = true;
            this.logger.info(formatCompact({ endpoint: this.$config.name }));
            this.logger.info(formatCompact( { op: 'webhook', path: this.$config.webhookPath }));
            
        } catch (error) {
            this.logger.error('Failed to connect Lark bot:', error);
            throw error;
        }
    }

    async $disconnect(): Promise<void> {
        try {
            this.$connected = false;
            this.logger.info(formatCompact( { op: 'disconnect', endpoint: this.$config.name }));
        } catch (error) {
            this.logger.error('Error disconnecting Lark bot:', error);
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
            this.logger.error('Failed to get user info:', error);
            return null;
        }
    }

    // 获取群聊信息
    async getChatInfo(chatId: string): Promise<any> {
        try {
            const response = await this.axiosInstance.get(`/im/v1/chats/${chatId}`);
            return response.data.data;
        } catch (error) {
            this.logger.error('Failed to get chat info:', error);
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
            this.logger.error('Failed to upload file:', error);
            return null;
        }
    }

    // ==================== 群组管理 API ====================

    /**
     * 创建群聊
     * @param name 群名
     * @param userIds 成员 open_id 列表
     * @param ownerId 群主 open_id
     */
    async createChat(name: string, userIds: string[], ownerId?: string): Promise<string | null> {
        try {
            const response = await this.axiosInstance.post('/im/v1/chats', {
                name,
                user_id_list: userIds,
                owner_id: ownerId
            });

            if (response.data.code === 0) {
                this.logger.debug(formatCompact( { op: 'create_chat', chat: response.data.data.chat_id }));
                return response.data.data.chat_id;
            }
            throw new Error(`Failed to create chat: ${response.data.msg}`);
        } catch (error) {
            this.logger.error('Failed to create chat:', error);
            return null;
        }
    }

    /**
     * 更新群信息
     * @param chatId 群聊 ID
     * @param options 更新选项
     */
    async updateChatInfo(chatId: string, options: {
        name?: string;
        description?: string;
    }): Promise<boolean> {
        try {
            const response = await this.axiosInstance.put(`/im/v1/chats/${chatId}`, options);

            if (response.data.code === 0) {
                this.logger.debug(formatCompact( { op: 'update_chat', chat: chatId }));
                return true;
            }
            throw new Error(`Failed to update chat: ${response.data.msg}`);
        } catch (error) {
            this.logger.error('Failed to update chat:', error);
            return false;
        }
    }

    /**
     * 添加群成员
     * @param chatId 群聊 ID
     * @param userIds 用户 ID 列表
     */
    async addChatMembers(chatId: string, userIds: string[]): Promise<boolean> {
        try {
            const response = await this.axiosInstance.post(`/im/v1/chats/${chatId}/members`, {
                id_list: userIds
            });

            if (response.data.code === 0) {
                this.logger.debug(formatCompact( { op: 'add_member', chat: chatId }));
                return true;
            }
            throw new Error(`Failed to add members: ${response.data.msg}`);
        } catch (error) {
            this.logger.error('Failed to add chat members:', error);
            return false;
        }
    }

    /**
     * 移除群成员
     * @param chatId 群聊 ID
     * @param userIds 用户 ID 列表
     */
    async removeChatMembers(chatId: string, userIds: string[]): Promise<boolean> {
        try {
            const response = await this.axiosInstance.delete(`/im/v1/chats/${chatId}/members`, {
                data: { id_list: userIds }
            });

            if (response.data.code === 0) {
                this.logger.debug(formatCompact( { op: 'remove_member', chat: chatId }));
                return true;
            }
            throw new Error(`Failed to remove members: ${response.data.msg}`);
        } catch (error) {
            this.logger.error('Failed to remove chat members:', error);
            return false;
        }
    }

    /**
     * 获取群成员列表
     * @param chatId 群聊 ID
     */
    async getChatMembers(chatId: string): Promise<any[]> {
        try {
            const response = await this.axiosInstance.get(`/im/v1/chats/${chatId}/members`);

            if (response.data.code === 0) {
                return response.data.data.items || [];
            }
            throw new Error(`Failed to get members: ${response.data.msg}`);
        } catch (error) {
            this.logger.error('Failed to get chat members:', error);
            return [];
        }
    }

    /**
     * 解散群聊
     * @param chatId 群聊 ID
     */
    async dissolveChat(chatId: string): Promise<boolean> {
        try {
            const response = await this.axiosInstance.delete(`/im/v1/chats/${chatId}`);

            if (response.data.code === 0) {
                this.logger.debug(formatCompact( { op: 'delete_chat', chat: chatId }));
                return true;
            }
            throw new Error(`Failed to dissolve chat: ${response.data.msg}`);
        } catch (error) {
            this.logger.error('Failed to dissolve chat:', error);
            return false;
        }
    }

    /**
     * 设置群管理员
     * @param chatId 群聊 ID
     * @param userIds 用户 ID 列表
     */
    async setChatManagers(chatId: string, userIds: string[]): Promise<boolean> {
        try {
            const response = await this.axiosInstance.post(`/im/v1/chats/${chatId}/managers/add_managers`, {
                manager_ids: userIds
            });

            if (response.data.code === 0) {
                this.logger.debug(formatCompact( { op: 'set_admin', chat: chatId }));
                return true;
            }
            throw new Error(`Failed to set managers: ${response.data.msg}`);
        } catch (error) {
            this.logger.error('Failed to set chat managers:', error);
            return false;
        }
    }

    /**
     * 移除群管理员
     * @param chatId 群聊 ID
     * @param userIds 用户 ID 列表
     */
    async removeChatManagers(chatId: string, userIds: string[]): Promise<boolean> {
        try {
            const response = await this.axiosInstance.post(`/im/v1/chats/${chatId}/managers/delete_managers`, {
                manager_ids: userIds
            });

            if (response.data.code === 0) {
                this.logger.debug(formatCompact( { op: 'remove_admin', chat: chatId }));
                return true;
            }
            throw new Error(`Failed to remove managers: ${response.data.msg}`);
        } catch (error) {
            this.logger.error('Failed to remove chat managers:', error);
            return false;
        }
    }
}

// 定义 Adapter 类
