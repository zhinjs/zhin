import {
    Bot,
    usePlugin,
    Adapter,
    Plugin,
    Message,
    SendOptions,
    SendContent,
    MessageSegment,
    segment,
} from "zhin.js";
import type { Context } from 'koa';
import { createHmac } from 'crypto';

// 类型扩展 - 使用 zhin.js 模式
declare module "zhin.js" {
    namespace Plugin {
        interface Contexts {
            router: import("@zhin.js/http").Router;
        }
    }

    interface Adapters {
        dingtalk: DingTalkAdapter;
    }
}

const plugin = usePlugin();
const { provide, useContext } = plugin;

// 钉钉配置类型定义
export interface DingTalkBotConfig {
    context: 'dingtalk'
    name: string
    appKey: string          // 钉钉应用 AppKey
    appSecret: string       // 钉钉应用 AppSecret
    webhookPath: string     // Webhook 路径，如 '/dingtalk/webhook'
    robotCode?: string      // 机器人编码（企业内部应用）
    // API 配置
    apiBaseUrl?: string     // API 基础 URL，默认为钉钉开放平台
}

// 钉钉消息类型
export interface DingTalkMessage {
    msgtype?: string
    text?: {
        content?: string
    }
    msgId?: string
    createAt?: number
    conversationType?: string  // '1':单聊, '2':群聊
    conversationId?: string
    senderId?: string
    senderNick?: string
    senderCorpId?: string
    sessionWebhook?: string
    chatbotCorpId?: string
    chatbotUserId?: string
    isAdmin?: boolean
    senderStaffId?: string
    atUsers?: Array<{
        dingtalkId?: string
        staffId?: string
    }>
    content?: any
}

// 钉钉事件类型
interface DingTalkEvent {
    msgtype?: string
    text?: any
    conversationId?: string
    atUsers?: any[]
    chatbotUserId?: string
    msgId?: string
    senderNick?: string
    isAdmin?: boolean
    senderStaffId?: string
    sessionWebhook?: string
    createAt?: number
    senderCorpId?: string
    conversationType?: string
    senderId?: string
    [key: string]: any
}

// Token 管理
interface AccessToken {
    token: string
    expires_in: number
    timestamp: number
}

// ================================================================================================
// DingTalkBot 类
// ================================================================================================

export class DingTalkBot implements Bot<DingTalkBotConfig, DingTalkMessage> {
    $connected: boolean
    private router: any
    private accessToken: AccessToken
    private baseURL: string
    private sessionWebhooks: Map<string, string> = new Map() // conversationId -> webhook

    get $id() {
        return this.$config.name;
    }

    constructor(public adapter: DingTalkAdapter, router: any, public $config: DingTalkBotConfig) {
        this.router = router;
        this.$connected = false;
        this.accessToken = { token: '', expires_in: 0, timestamp: 0 };

        // 设置 API 基础 URL
        this.baseURL = $config.apiBaseUrl || 'https://oapi.dingtalk.com';

        // 设置 webhook 路由
        this.setupWebhookRoute();
    }

    // 封装 fetch 请求方法
    private async request(path: string, options: {
        method?: 'GET' | 'POST',
        params?: Record<string, any>,
        body?: any
    } = {}): Promise<any> {
        await this.ensureAccessToken();

        const { method = 'GET', params = {}, body } = options;

        // 添加 access_token 到查询参数
        const urlParams = new URLSearchParams({
            ...params,
            access_token: this.accessToken.token
        });

        const url = `${this.baseURL}${path}?${urlParams.toString()}`;

        const fetchOptions: RequestInit = {
            method,
            headers: {
                'Content-Type': 'application/json; charset=utf-8'
            }
        };

        if (body && method === 'POST') {
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

            // 钉钉签名验证
            const timestamp = headers['timestamp'] as string;
            const sign = headers['sign'] as string;

            if (timestamp && sign) {
                if (!this.verifySignature(timestamp, sign)) {
                    plugin.logger.warn('Invalid signature in webhook');
                    ctx.status = 403;
                    ctx.body = { code: -1, msg: 'Forbidden' };
                    return;
                }
            }

            const event: DingTalkEvent = body;

            // 处理消息事件
            if (event.msgtype) {
                await this.handleEvent(event);
            }

            ctx.status = 200;
            ctx.body = { code: 0, msg: 'success' };

        } catch (error) {
            plugin.logger.error('Webhook error:', error);
            ctx.status = 500;
            ctx.body = { code: -1, msg: 'Internal Server Error' };
        }
    }

    private verifySignature(timestamp: string, sign: string): boolean {
        try {
            const stringToSign = `${timestamp}\n${this.$config.appSecret}`;
            const hmac = createHmac('sha256', this.$config.appSecret);
            hmac.update(stringToSign);
            const calculatedSign = hmac.digest('base64');
            return calculatedSign === sign;
        } catch (error) {
            plugin.logger.error('Signature verification error:', error);
            return false;
        }
    }

    private async handleEvent(event: DingTalkEvent): Promise<void> {
        // 存储会话 webhook（用于回复消息）
        if (event.sessionWebhook && event.conversationId) {
            this.sessionWebhooks.set(event.conversationId, event.sessionWebhook);
        }

        // 处理消息事件
        const message = this.$formatMessage(event as any);
        this.adapter.emit('message.receive', message);
        plugin.logger.info(`${this.$config.name} recv  ${message.$channel.type}(${message.$channel.id}): ${segment.raw(message.$content)}`);
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
            const baseURL = this.$config.apiBaseUrl || 'https://oapi.dingtalk.com';
            const params = new URLSearchParams({
                appkey: this.$config.appKey,
                appsecret: this.$config.appSecret
            });

            const url = `${baseURL}/gettoken?${params.toString()}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.errcode === 0) {
                this.accessToken = {
                    token: data.access_token,
                    expires_in: data.expires_in,
                    timestamp: Date.now()
                };
                plugin.logger.debug('Access token refreshed successfully');
            } else {
                throw new Error(`Failed to get access token: ${data.errmsg}`);
            }
        } catch (error) {
            plugin.logger.error('Failed to refresh access token:', error);
            throw error;
        }
    }

    // ================================================================================================
    // 消息格式化
    // ================================================================================================

    $formatMessage(msg: DingTalkMessage): Message<DingTalkMessage> {
        const content = this.parseMessageContent(msg);

        // 确定聊天类型: '1'为单聊, '2'为群聊
        const chatType = msg.conversationType === '2' ? 'group' : 'private';

        return Message.from(msg, {
            $id: msg.msgId || Date.now().toString(),
            $adapter: 'dingtalk',
            $bot: this.$config.name,
            $sender: {
                id: msg.senderId || msg.senderStaffId || 'unknown',
                name: msg.senderNick || msg.senderId || 'Unknown User'
            },
            $channel: {
                id: msg.conversationId || 'unknown',
                type: chatType as any
            },
            $content: content,
            $raw: JSON.stringify(msg),
            $timestamp: msg.createAt || Date.now(),
            $recall: async () => {
                await this.$recallMessage(msg.msgId || '');
            },
            $reply: async (content: SendContent): Promise<string> => {
                return await this.adapter.sendMessage({
                    context: 'dingtalk',
                    bot: this.$config.name,
                    id: msg.conversationId || msg.senderId || 'unknown',
                    type: chatType,
                    content: content
                });
            }
        });
    }

    private parseMessageContent(msg: DingTalkMessage): MessageSegment[] {
        const content: MessageSegment[] = [];

        if (!msg.msgtype) {
            return content;
        }

        try {
            switch (msg.msgtype) {
                case 'text':
                    if (msg.text?.content) {
                        content.push(segment('text', { content: msg.text.content }));

                        // 处理 @提及
                        if (msg.atUsers && msg.atUsers.length > 0) {
                            for (const atUser of msg.atUsers) {
                                content.push(segment('at', {
                                    id: atUser.dingtalkId || atUser.staffId,
                                    name: atUser.dingtalkId || atUser.staffId
                                }));
                            }
                        }
                    }
                    break;

                case 'picture':
                    if (msg.content) {
                        content.push(segment('image', {
                            url: msg.content.downloadCode || msg.content.pictureDownloadCode,
                            file: msg.content.downloadCode || msg.content.pictureDownloadCode
                        }));
                    }
                    break;

                case 'file':
                    if (msg.content) {
                        content.push(segment('file', {
                            file: msg.content.downloadCode,
                            name: msg.content.fileName,
                            size: msg.content.fileSize
                        }));
                    }
                    break;

                case 'audio':
                    if (msg.content) {
                        content.push(segment('audio', {
                            file: msg.content.downloadCode,
                            duration: msg.content.duration
                        }));
                    }
                    break;

                case 'video':
                    if (msg.content) {
                        content.push(segment('video', {
                            file: msg.content.downloadCode,
                            duration: msg.content.duration,
                            size: msg.content.videoSize
                        }));
                    }
                    break;

                case 'richText':
                    // 富文本消息处理（简化）
                    if (msg.content?.richText) {
                        for (const item of msg.content.richText) {
                            if (item.text) {
                                content.push(segment('text', { content: item.text }));
                            }
                        }
                    }
                    break;

                case 'markdown':
                    if (msg.content?.text) {
                        content.push(segment('markdown', {
                            content: msg.content.text,
                            title: msg.content.title
                        }));
                    }
                    break;

                default:
                    content.push(segment('text', { content: `[不支持的消息类型: ${msg.msgtype}]` }));
                    break;
            }
        } catch (error) {
            plugin.logger.error('Failed to parse message content:', error);
            content.push(segment('text', { content: '[消息解析失败]' }));
        }

        return content;
    }

    // ================================================================================================
    // 消息发送
    // ================================================================================================

    async $sendMessage(options: SendOptions): Promise<string> {
        const conversationId = options.id;
        const content = this.formatSendContent(options.content);

        try {
            // 优先使用会话 webhook 发送消息（更快，更准确）
            const sessionWebhook = this.sessionWebhooks.get(conversationId);
            if (sessionWebhook) {
                const response = await fetch(sessionWebhook, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8'
                    },
                    body: JSON.stringify(content)
                });
                const data = await response.json();

                if (data.errcode !== 0) {
                    throw new Error(`Failed to send message via session webhook: ${data.errmsg}`);
                }
                plugin.logger.debug('Message sent via session webhook');
                return data.msgId || Date.now().toString();
            }

            // 否则使用普通机器人发送接口
            const data = await this.request('/robot/send', {
                method: 'POST',
                body: {
                    ...content,
                    robotCode: this.$config.robotCode
                }
            });

            if (data.errcode !== 0) {
                throw new Error(`Failed to send message: ${data.errmsg}`);
            }

            plugin.logger.debug('Message sent successfully');
            return data.msgId || Date.now().toString();
        } catch (error) {
            plugin.logger.error('Failed to send message:', error);
            throw error;
        }
    }

    async $recallMessage(id: string): Promise<void> {
        // 钉钉机器人不支持撤回消息
        plugin.logger.warn('DingTalk robot does not support message recall');
    }

    private formatSendContent(content: SendContent): any {
        if (typeof content === 'string') {
            return {
                msgtype: 'text',
                text: { content }
            };
        }

        if (Array.isArray(content)) {
            const textParts: string[] = [];
            const atMobiles: string[] = [];
            const atUserIds: string[] = [];
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
                            const userId = segment.data.id || segment.data.userId;
                            if (userId) {
                                atUserIds.push(userId);
                                textParts.push(`@${segment.data.name || userId} `);
                            }
                            break;

                        case 'image':
                            if (!hasMedia) {
                                hasMedia = true;
                                mediaContent = {
                                    msgtype: 'picture',
                                    picture: {
                                        picURL: segment.data.url || segment.data.file
                                    }
                                };
                            }
                            break;

                        case 'markdown':
                            if (!hasMedia) {
                                hasMedia = true;
                                mediaContent = {
                                    msgtype: 'markdown',
                                    markdown: {
                                        title: segment.data.title || '消息',
                                        text: segment.data.content || segment.data.text
                                    }
                                };
                            }
                            break;

                        case 'link':
                            if (!hasMedia) {
                                hasMedia = true;
                                mediaContent = {
                                    msgtype: 'link',
                                    link: {
                                        title: segment.data.title || '链接',
                                        text: segment.data.text || segment.data.content || '',
                                        messageUrl: segment.data.url,
                                        picUrl: segment.data.picUrl
                                    }
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
            const result: any = {
                msgtype: 'text',
                text: {
                    content: textParts.join('')
                }
            };

            // 添加 @ 信息
            if (atUserIds.length > 0) {
                result.at = {
                    atUserIds,
                    isAtAll: false
                };
            }

            return result;
        }

        return {
            msgtype: 'text',
            text: {
                content: String(content)
            }
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
            plugin.logger.info(`DingTalk bot connected: ${this.$config.name}`);
            plugin.logger.info(`Webhook URL: ${this.$config.webhookPath}`);

        } catch (error) {
            plugin.logger.error('Failed to connect DingTalk bot:', error);
            throw error;
        }
    }

    async $disconnect(): Promise<void> {
        try {
            this.$connected = false;
            plugin.logger.info('DingTalk bot disconnected');
        } catch (error) {
            plugin.logger.error('Error disconnecting DingTalk bot:', error);
        }
    }

    // ================================================================================================
    // 工具方法
    // ================================================================================================

    // 获取用户信息
    async getUserInfo(userId: string): Promise<any> {
        try {
            const data = await this.request('/topapi/v2/user/get', {
                method: 'POST',
                body: {
                    userid: userId
                }
            });

            if (data.errcode === 0) {
                return data.result;
            }

            throw new Error(`Failed to get user info: ${data.errmsg}`);
        } catch (error) {
            plugin.logger.error('Failed to get user info:', error);
            return null;
        }
    }

    // 获取部门用户列表
    async getDepartmentUsers(deptId: number): Promise<any[]> {
        try {
            const data = await this.request('/topapi/user/listid', {
                method: 'POST',
                body: {
                    dept_id: deptId
                }
            });

            if (data.errcode === 0) {
                return data.result.userid_list || [];
            }

            throw new Error(`Failed to get department users: ${data.errmsg}`);
        } catch (error) {
            plugin.logger.error('Failed to get department users:', error);
            return [];
        }
    }

    // 发送工作通知
    async sendWorkNotice(userIdList: string[], content: any): Promise<boolean> {
        try {
            const data = await this.request('/topapi/message/corpconversation/asyncsend_v2', {
                method: 'POST',
                body: {
                    agent_id: this.$config.robotCode,
                    userid_list: userIdList.join(','),
                    msg: content
                }
            });

            if (data.errcode === 0) {
                plugin.logger.debug('Work notice sent successfully');
                return true;
            }

            throw new Error(`Failed to send work notice: ${data.errmsg}`);
        } catch (error) {
            plugin.logger.error('Failed to send work notice:', error);
            return false;
        }
    }
}

// 定义 Adapter 类
class DingTalkAdapter extends Adapter<DingTalkBot> {
    #router: any;

    constructor(plugin: Plugin, router: any) {
        super(plugin, 'dingtalk', []);
        this.#router = router;
    }

    createBot(config: DingTalkBotConfig): DingTalkBot {
        return new DingTalkBot(this, this.#router, config);
    }
}

// 使用新的 provide() API 注册适配器
useContext('router', (router: any) => {
    provide({
        name: "dingtalk",
        description: "DingTalk Bot Adapter",
        mounted: async (p) => {
            const adapter = new DingTalkAdapter(p, router);
            await adapter.start();
            return adapter;
        },
        dispose: async (adapter) => {
            await adapter.stop();
        },
    });
});