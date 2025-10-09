import TelegramBotApi from "node-telegram-bot-api";
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
import { createWriteStream } from 'fs';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { promises as fs } from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

// 声明模块，注册 telegram 适配器类型
declare module 'zhin.js'{
    interface RegisteredAdapters{
        telegram: Adapter<TelegramBot>
        'telegram-webhook': Adapter<TelegramWebhookBot>
    }
}

// 基础配置
export interface TelegramBaseConfig extends BotConfig {
    token: string
    name: string
    proxy?: {
        host: string
        port: number
        username?: string
        password?: string
    }
    // 文件下载配置
    fileDownload?: {
        enabled: boolean
        downloadPath?: string
        maxFileSize?: number // 最大文件大小（字节）
    }
}

// Polling 模式配置
export type TelegramBotConfig = TelegramBaseConfig & TelegramBotApi.ConstructorOptions & {
    context: 'telegram'
    mode?: 'polling' // 默认为 polling
}

// Webhook 模式配置
export interface TelegramWebhookConfig extends TelegramBaseConfig {
    context: 'telegram-webhook'
    mode: 'webhook'
    webhookPath: string // webhook 路径，如 '/telegram/webhook'
    webhookUrl: string  // 外部访问的 URL，如 'https://yourdomain.com/telegram/webhook'
    secretToken?: string // 可选的密钥令牌
}

// Bot 接口
export interface TelegramBot {
    $config: TelegramBotConfig
}

export interface TelegramWebhookBot {
    $config: TelegramWebhookConfig
}

// 主要的 TelegramBot 类
export class TelegramBot extends TelegramBotApi implements Bot<TelegramBotApi.Message, TelegramBotConfig> {
    $connected?: boolean
    
    constructor(private plugin: Plugin, config: TelegramBotConfig) {
        const options: TelegramBotApi.ConstructorOptions = {
            polling: true,
            ...config
        };
        
        // 如果配置了代理，设置代理
        if (config.proxy) {
            try {
                const proxyUrl = `socks5://${config.proxy.username ? `${config.proxy.username}:${config.proxy.password}@` : ''}${config.proxy.host}:${config.proxy.port}`;
                options.request = {
                    agent: new SocksProxyAgent(proxyUrl)
                } as any;
            } catch (error) {
                // 代理配置失败，继续不使用代理
                console.warn('Failed to configure proxy, continuing without proxy:', error);
            }
        }
        
        super(config.token, options);
        this.$config = config;
        this.$connected = false;
    }

    private async handleTelegramMessage(msg: TelegramBotApi.Message): Promise<void> {
        const message = this.$formatMessage(msg);
        this.plugin.dispatch('message.receive', message);
        this.plugin.logger.info(`recv ${message.$channel.type}(${message.$channel.id}): ${segment.raw(message.$content)}`);
        this.plugin.dispatch(`message.${message.$channel.type}.receive`, message);
    }

    async $connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            // 监听所有消息
            this.on('message', this.handleTelegramMessage.bind(this));
            
            // 监听连接错误
            this.on('polling_error', (error) => {
                this.plugin.logger.error('Telegram polling error:', error);
                this.$connected = false;
                reject(error);
            });

            // 启动轮询，测试连接
            this.startPolling().then(() => {
                this.$connected = true;
                this.plugin.logger.info(`Telegram bot ${this.$config.name} connected successfully`);
                resolve();
            }).catch((error) => {
                this.plugin.logger.error('Failed to start Telegram bot:', error);
                this.$connected = false;
                reject(error);
            });
        });
    }

    async $disconnect(): Promise<void> {
        try {
            await this.stopPolling();
            this.$connected = false;
            this.plugin.logger.info(`Telegram bot ${this.$config.name} disconnected`);
        } catch (error) {
            this.plugin.logger.error('Error disconnecting Telegram bot:', error);
            throw error;
        }
    }

    $formatMessage(msg: TelegramBotApi.Message): Message<TelegramBotApi.Message> {
        // 确定聊天类型和ID
        let channelType: 'private' | 'group' | 'channel';
        let channelId: string;
        
        if (msg.chat.type === 'private') {
            channelType = 'private';
            channelId = msg.chat.id.toString();
        } else if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
            channelType = 'group';
            channelId = msg.chat.id.toString();
        } else if (msg.chat.type === 'channel') {
            channelType = 'channel';
            channelId = msg.chat.id.toString();
        } else {
            channelType = 'private';
            channelId = msg.chat.id.toString();
        }

        // 转换消息内容为 segment 格式（同步）
        const content = this.parseMessageContentSync(msg);
        
        // 在后台异步下载文件（不阻塞消息处理）
        this.downloadMessageFiles(msg).catch(error => {
            this.plugin.logger.warn('Failed to download message files:', error);
        });

        const result = Message.from(msg, {
            $id: msg.message_id.toString(),
            $adapter: 'telegram',
            $bot: this.$config.name,
            $sender: {
                id: msg.from?.id.toString() || msg.chat.id.toString(),
                name: msg.from ? (msg.from.first_name + (msg.from.last_name ? ` ${msg.from.last_name}` : '')) : msg.chat.title || 'Unknown'
            },
            $channel: {
                id: channelId,
                type: channelType
            },
            $content: content,
            $raw: msg.text || msg.caption || '',
            $timestamp: msg.date * 1000, // Telegram 使用秒，转换为毫秒
            $reply: async (content: SendContent, quote?: boolean | string): Promise<void> => {
                if (!Array.isArray(content)) content = [content];
                
                const sendOptions: any = {};
                
                // 处理回复消息
                if (quote) {
                    sendOptions.reply_to_message_id = parseInt(
                        typeof quote === "boolean" ? result.$id : quote
                    );
                }
                
                await this.sendContentToChat(channelId, content, sendOptions);
            }
        });
        
        return result;
    }

    async $sendMessage(options: SendOptions): Promise<void> {
        options = await this.plugin.app.handleBeforeSend(options);
        
        try {
            const chatId = options.id;
            await this.sendContentToChat(chatId, options.content);
            this.plugin.logger.info(`send ${options.type}(${options.id}): ${segment.raw(options.content)}`);
        } catch (error) {
            this.plugin.logger.error('Failed to send Telegram message:', error);
            throw error;
        }
    }

    // 发送内容到聊天
    async sendContentToChat(chatId: string, content: SendContent, extraOptions: any = {}): Promise<void> {
        if (!Array.isArray(content)) content = [content];
        
        const numericChatId = parseInt(chatId);
        let replyToMessageId = extraOptions.reply_to_message_id;
        
        for (const segment of content) {
            if (typeof segment === 'string') {
                await this.sendMessage(numericChatId, segment, {
                    parse_mode: 'HTML',
                    reply_to_message_id: replyToMessageId,
                    ...extraOptions
                });
                replyToMessageId = undefined; // 只有第一条消息回复
                continue;
            }
            
            const { type, data } = segment;
            
            switch (type) {
                case 'text':
                    await this.sendMessage(numericChatId, data.text, {
                        parse_mode: 'HTML',
                        reply_to_message_id: replyToMessageId,
                        ...extraOptions
                    });
                    break;
                    
                case 'image':
                    await this.sendPhoto(numericChatId, data.file || data.url || data.file_id, {
                        caption: data.caption,
                        reply_to_message_id: replyToMessageId,
                        ...extraOptions
                    });
                    break;
                    
                case 'audio':
                    await this.sendAudio(numericChatId, data.file || data.url || data.file_id, {
                        duration: data.duration,
                        performer: data.performer,
                        title: data.title,
                        caption: data.caption,
                        reply_to_message_id: replyToMessageId,
                        ...extraOptions
                    });
                    break;
                    
                case 'voice':
                    await this.sendVoice(numericChatId, data.file || data.url || data.file_id, {
                        duration: data.duration,
                        caption: data.caption,
                        reply_to_message_id: replyToMessageId,
                        ...extraOptions
                    });
                    break;
                    
                case 'video':
                    await this.sendVideo(numericChatId, data.file || data.url || data.file_id, {
                        duration: data.duration,
                        width: data.width,
                        height: data.height,
                        caption: data.caption,
                        reply_to_message_id: replyToMessageId,
                        ...extraOptions
                    });
                    break;
                    
                case 'video_note':
                    await this.sendVideoNote(numericChatId, data.file || data.url || data.file_id, {
                        duration: data.duration,
                        length: data.length,
                        reply_to_message_id: replyToMessageId,
                        ...extraOptions
                    });
                    break;
                    
                case 'document':
                case 'file':
                    await this.sendDocument(numericChatId, data.file || data.url || data.file_id, {
                        caption: data.caption,
                        reply_to_message_id: replyToMessageId,
                        ...extraOptions
                    });
                    break;
                    
                case 'sticker':
                    await this.sendSticker(numericChatId, data.file_id, {
                        reply_to_message_id: replyToMessageId,
                        ...extraOptions
                    });
                    break;
                    
                case 'location':
                    await this.sendLocation(numericChatId, data.latitude, data.longitude, {
                        live_period: data.live_period,
                        heading: data.heading,
                        proximity_alert_radius: data.proximity_alert_radius,
                        reply_to_message_id: replyToMessageId,
                        ...extraOptions
                    });
                    break;
                    
                case 'contact':
                    await this.sendContact(numericChatId, data.phone_number, data.first_name, {
                        last_name: data.last_name,
                        vcard: data.vcard,
                        reply_to_message_id: replyToMessageId,
                        ...extraOptions
                    });
                    break;
                    
                case 'reply':
                    // 回复消息在 extraOptions 中处理
                    replyToMessageId = parseInt(data.id);
                    break;
                    
                case 'at':
                    // @提及转换为文本
                    const mentionText = data.name ? `@${data.name}` : data.text || `@${data.id}`;
                    await this.sendMessage(numericChatId, mentionText, {
                        reply_to_message_id: replyToMessageId,
                        ...extraOptions
                    });
                    break;
                    
                default:
                    // 未知类型，作为文本处理
                    const text = data.text || `[${type}]`;
                    await this.sendMessage(numericChatId, text, {
                        reply_to_message_id: replyToMessageId,
                        ...extraOptions
                    });
            }
            
            replyToMessageId = undefined; // 只有第一条消息回复
        }
    }

    // 获取文件信息并下载（如果启用）
    async getFileInfo(fileId: string) {
        try {
            const file = await this.getFile(fileId);
            const fileUrl = `https://api.telegram.org/file/bot${this.$config.token}/${file.file_path}`;
            
            return {
                file_id: fileId,
                file_unique_id: file.file_unique_id,
                file_size: file.file_size,
                file_path: file.file_path,
                file_url: fileUrl
            };
        } catch (error) {
            this.plugin.logger.error('Failed to get file info:', error);
            return null;
        }
    }

    // 下载文件到本地
    async downloadTelegramFile(fileId: string): Promise<string | null> {
        if (!this.$config.fileDownload?.enabled) {
            return null;
        }

        const fileInfo = await this.getFileInfo(fileId);
        if (!fileInfo) return null;

        const downloadPath = this.$config.fileDownload.downloadPath || './downloads';
        const maxFileSize = this.$config.fileDownload.maxFileSize || 20 * 1024 * 1024; // 20MB

        if (fileInfo.file_size && fileInfo.file_size > maxFileSize) {
            this.plugin.logger.warn(`File too large: ${fileInfo.file_size} bytes`);
            return null;
        }

        try {
            await fs.mkdir(downloadPath, { recursive: true });
            const fileName = `${fileId}_${Date.now()}.${path.extname(fileInfo.file_path || '')}`;
            const localPath = path.join(downloadPath, fileName);

            return new Promise((resolve, reject) => {
                const client = fileInfo.file_url?.startsWith('https:') ? https : http;
                const request = client.get(fileInfo.file_url!, (response) => {
                    if (response.statusCode === 200) {
                        const fileStream = createWriteStream(localPath);
                        response.pipe(fileStream);
                        fileStream.on('finish', () => resolve(localPath));
                        fileStream.on('error', reject);
                    } else {
                        reject(new Error(`HTTP ${response.statusCode}`));
                    }
                });
                request.on('error', reject);
            });
        } catch (error) {
            this.plugin.logger.error('Failed to download file:', error);
            return null;
        }
    }

    // 同步解析 Telegram 消息内容为 segment 格式（不包含文件下载）
    parseMessageContentSync(msg: TelegramBotApi.Message): MessageSegment[] {
        const segments: MessageSegment[] = [];
        
        // 回复消息处理
        if (msg.reply_to_message) {
            segments.push({
                type: 'reply',
                data: {
                    id: msg.reply_to_message.message_id.toString(),
                    message: this.parseMessageContentSync(msg.reply_to_message)
                }
            });
        }
        
        // 文本消息（包含实体处理）
        if (msg.text) {
            segments.push(...this.parseTextWithEntities(msg.text, msg.entities));
        }
        
        // 图片消息
        if (msg.photo && msg.photo.length > 0) {
            const photo = msg.photo[msg.photo.length - 1]; // 取最大尺寸的图片
            
            segments.push({
                type: 'image',
                data: {
                    file_id: photo.file_id,
                    file_unique_id: photo.file_unique_id,
                    width: photo.width,
                    height: photo.height,
                    file_size: photo.file_size
                }
            });
            
            if (msg.caption) {
                segments.push(...this.parseTextWithEntities(msg.caption, msg.caption_entities));
            }
        }
        
        // 音频消息
        if (msg.audio) {
            segments.push({
                type: 'audio',
                data: {
                    file_id: msg.audio.file_id,
                    file_unique_id: msg.audio.file_unique_id,
                    duration: msg.audio.duration,
                    performer: msg.audio.performer,
                    title: msg.audio.title,
                    mime_type: msg.audio.mime_type,
                    file_size: msg.audio.file_size
                }
            });
        }
        
        // 语音消息
        if (msg.voice) {
            segments.push({
                type: 'voice',
                data: {
                    file_id: msg.voice.file_id,
                    file_unique_id: msg.voice.file_unique_id,
                    duration: msg.voice.duration,
                    mime_type: msg.voice.mime_type,
                    file_size: msg.voice.file_size
                }
            });
        }
        
        // 视频消息
        if (msg.video) {
            segments.push({
                type: 'video',
                data: {
                    file_id: msg.video.file_id,
                    file_unique_id: msg.video.file_unique_id,
                    width: msg.video.width,
                    height: msg.video.height,
                    duration: msg.video.duration,
                    mime_type: msg.video.mime_type,
                    file_size: msg.video.file_size
                }
            });
            
            if (msg.caption) {
                segments.push(...this.parseTextWithEntities(msg.caption, msg.caption_entities));
            }
        }
        
        // 视频笔记（圆形视频）
        if (msg.video_note) {
            segments.push({
                type: 'video_note',
                data: {
                    file_id: msg.video_note.file_id,
                    file_unique_id: msg.video_note.file_unique_id,
                    length: msg.video_note.length,
                    duration: msg.video_note.duration,
                    file_size: msg.video_note.file_size
                }
            });
        }
        
        // 文档消息
        if (msg.document) {
            segments.push({
                type: 'document',
                data: {
                    file_id: msg.document.file_id,
                    file_unique_id: msg.document.file_unique_id,
                    file_name: msg.document.file_name,
                    mime_type: msg.document.mime_type,
                    file_size: msg.document.file_size
                }
            });
            
            if (msg.caption) {
                segments.push(...this.parseTextWithEntities(msg.caption, msg.caption_entities));
            }
        }
        
        // 贴纸消息
        if (msg.sticker) {
            segments.push({
                type: 'sticker',
                data: {
                    file_id: msg.sticker.file_id,
                    file_unique_id: msg.sticker.file_unique_id,
                    type: msg.sticker.type,
                    width: msg.sticker.width,
                    height: msg.sticker.height,
                    is_animated: msg.sticker.is_animated,
                    is_video: msg.sticker.is_video,
                    emoji: msg.sticker.emoji,
                    set_name: msg.sticker.set_name,
                    file_size: msg.sticker.file_size
                }
            });
        }
        
        // 位置消息
        if (msg.location) {
            segments.push({
                type: 'location',
                data: {
                    longitude: msg.location.longitude,
                    latitude: msg.location.latitude
                }
            });
        }
        
        // 联系人消息
        if (msg.contact) {
            segments.push({
                type: 'contact',
                data: {
                    phone_number: msg.contact.phone_number,
                    first_name: msg.contact.first_name,
                    last_name: msg.contact.last_name,
                    user_id: msg.contact.user_id,
                    vcard: msg.contact.vcard
                }
            });
        }
        
        return segments.length > 0 ? segments : [{ type: 'text', data: { text: '' } }];
    }

    // 在后台异步下载消息中的文件
    async downloadMessageFiles(msg: TelegramBotApi.Message): Promise<void> {
        if (!this.$config.fileDownload?.enabled) {
            return;
        }

        const fileIds: string[] = [];
        
        // 收集需要下载的文件ID
        if (msg.photo && msg.photo.length > 0) {
            fileIds.push(msg.photo[msg.photo.length - 1].file_id);
        }
        if (msg.audio) {
            fileIds.push(msg.audio.file_id);
        }
        if (msg.voice) {
            fileIds.push(msg.voice.file_id);
        }
        if (msg.video) {
            fileIds.push(msg.video.file_id);
        }
        if (msg.video_note) {
            fileIds.push(msg.video_note.file_id);
        }
        if (msg.document) {
            fileIds.push(msg.document.file_id);
        }
        if (msg.sticker) {
            fileIds.push(msg.sticker.file_id);
        }

        // 并行下载所有文件
        const downloadPromises = fileIds.map(fileId => 
            this.downloadTelegramFile(fileId).catch(error => {
                this.plugin.logger.warn(`Failed to download file ${fileId}:`, error);
                return null;
            })
        );
        
        await Promise.all(downloadPromises);
    }

    // 解析文本实体（@mentions, #hashtags, URLs, etc.）
    parseTextWithEntities(text: string, entities?: TelegramBotApi.MessageEntity[]): MessageSegment[] {
        if (!entities || entities.length === 0) {
            return [{ type: 'text', data: { text } }];
        }

        const segments: MessageSegment[] = [];
        let lastOffset = 0;

        entities.forEach(entity => {
            // 添加实体前的文本
            if (entity.offset > lastOffset) {
                segments.push({
                    type: 'text',
                    data: { text: text.slice(lastOffset, entity.offset) }
                });
            }

            const entityText = text.slice(entity.offset, entity.offset + entity.length);

            switch (entity.type) {
                case 'mention':
                    segments.push({
                        type: 'at',
                        data: { text: entityText }
                    });
                    break;
                case 'text_mention':
                    segments.push({
                        type: 'at',
                        data: {
                            id: entity.user?.id?.toString(),
                            name: entity.user?.first_name,
                            text: entityText
                        }
                    });
                    break;
                case 'hashtag':
                    segments.push({
                        type: 'hashtag',
                        data: { text: entityText }
                    });
                    break;
                case 'url':
                case 'text_link':
                    segments.push({
                        type: 'link',
                        data: {
                            url: entity.url || entityText,
                            text: entityText
                        }
                    });
                    break;
                case 'bold':
                    segments.push({
                        type: 'text',
                        data: { text: `<b>${entityText}</b>` }
                    });
                    break;
                case 'italic':
                    segments.push({
                        type: 'text',
                        data: { text: `<i>${entityText}</i>` }
                    });
                    break;
                case 'code':
                    segments.push({
                        type: 'text',
                        data: { text: `<code>${entityText}</code>` }
                    });
                    break;
                case 'pre':
                    segments.push({
                        type: 'text',
                        data: { text: `<pre>${entityText}</pre>` }
                    });
                    break;
                default:
                    segments.push({
                        type: 'text',
                        data: { text: entityText }
                    });
            }

            lastOffset = entity.offset + entity.length;
        });

        // 添加最后剩余的文本
        if (lastOffset < text.length) {
            segments.push({
                type: 'text',
                data: { text: text.slice(lastOffset) }
            });
        }

        return segments;
    }

    // 工具方法：检查文件是否存在
    static async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
    
    // 工具方法：获取文件扩展名
    static getFileExtension(fileName: string): string {
        return path.extname(fileName).toLowerCase();
    }
    
    // 工具方法：判断是否为图片文件
    static isImageFile(fileName: string): boolean {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
        return imageExtensions.includes(this.getFileExtension(fileName));
    }
    
    // 工具方法：判断是否为音频文件
    static isAudioFile(fileName: string): boolean {
        const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];
        return audioExtensions.includes(this.getFileExtension(fileName));
    }
    
    // 工具方法：判断是否为视频文件
    static isVideoFile(fileName: string): boolean {
        const videoExtensions = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'];
        return videoExtensions.includes(this.getFileExtension(fileName));
    }
    
    // 静态方法：将 SendContent 格式化为纯文本（用于日志显示）
    static formatContentToText(content: SendContent): string {
        if (!Array.isArray(content)) content = [content];
        
        return content.map(segment => {
            if (typeof segment === 'string') return segment;
            
            switch (segment.type) {
                case 'text':
                    return segment.data.text || '';
                case 'at':
                    return `@${segment.data.name || segment.data.id}`;
                case 'image':
                    return '[图片]';
                case 'audio':
                    return '[音频]';
                case 'voice':
                    return '[语音]';
                case 'video':
                    return '[视频]';
                case 'video_note':
                    return '[视频笔记]';
                case 'document':
                case 'file':
                    return '[文件]';
                case 'sticker':
                    return '[贴纸]';
                case 'location':
                    return '[位置]';
                case 'contact':
                    return '[联系人]';
                default:
                    return `[${segment.type}]`;
            }
        }).join('');
    }
}

// ================================================================================================
// TelegramWebhookBot 类（Webhook 模式）
// ================================================================================================

export class TelegramWebhookBot extends TelegramBotApi implements Bot<TelegramBotApi.Message, TelegramWebhookConfig> {
    $connected?: boolean
    private router: any
    
    constructor(private plugin: Plugin, router: any, config: TelegramWebhookConfig) {
        // webhook 模式不需要 polling
        const options: TelegramBotApi.ConstructorOptions = {
            webHook: false,
            polling: false
        };
        
        // 如果配置了代理，设置代理
        if (config.proxy) {
            try {
                const proxyUrl = `socks5://${config.proxy.username ? `${config.proxy.username}:${config.proxy.password}@` : ''}${config.proxy.host}:${config.proxy.port}`;
                options.request = {
                    agent: new SocksProxyAgent(proxyUrl)
                } as any;
            } catch (error) {
                console.warn('Failed to configure proxy, continuing without proxy:', error);
            }
        }
        
        super(config.token, options);
        this.$config = config;
        this.$connected = false;
        this.router = router;
        
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
            // 验证密钥令牌（如果配置了）
            if (this.$config.secretToken) {
                const authHeader = ctx.get('x-telegram-bot-api-secret-token');
                if (authHeader !== this.$config.secretToken) {
                    this.plugin.logger.warn('Invalid secret token in webhook');
                    ctx.status = 403;
                    ctx.body = 'Forbidden';
                    return;
                }
            }

            const update = (ctx.request as any).body;
            
            if (update.message) {
                await this.handleTelegramMessage(update.message);
            }
            
            ctx.status = 200;
            ctx.body = 'OK';
        } catch (error) {
            this.plugin.logger.error('Webhook error:', error);
            ctx.status = 500;
            ctx.body = 'Internal Server Error';
        }
    }

    private async handleTelegramMessage(msg: TelegramBotApi.Message): Promise<void> {
        const message = this.$formatMessage(msg);
        this.plugin.dispatch('message.receive', message);
        this.plugin.logger.info(`recv ${message.$channel.type}(${message.$channel.id}): ${segment.raw(message.$content)}`);
        this.plugin.dispatch(`message.${message.$channel.type}.receive`, message);
    }

    async $connect(): Promise<void> {
        try {
            // 设置 webhook URL
            await this.setWebHook(this.$config.webhookUrl, {
                secret_token: this.$config.secretToken
            });
            
            this.$connected = true;
            this.plugin.logger.info(`Telegram webhook bot connected: ${this.$config.name}`);
            this.plugin.logger.info(`Webhook URL: ${this.$config.webhookUrl}`);
            
        } catch (error) {
            this.plugin.logger.error('Failed to set webhook:', error);
            throw error;
        }
    }

    async $disconnect(): Promise<void> {
        try {
            await this.deleteWebHook();
            this.$connected = false;
            this.plugin.logger.info('Telegram webhook disconnected');
        } catch (error) {
            this.plugin.logger.error('Error disconnecting webhook:', error);
        }
    }

    // 复用原有的消息格式化和发送方法
    $formatMessage(msg: TelegramBotApi.Message): Message<TelegramBotApi.Message> {
        return TelegramBot.prototype.$formatMessage.call(this, msg);
    }

    async $sendMessage(options: SendOptions): Promise<void> {
        return TelegramBot.prototype.$sendMessage.call(this, options);
    }
    
    // 复用文件下载方法
    private async downloadTelegramFile(fileId: string): Promise<string | null> {
        return (TelegramBot.prototype as any).downloadTelegramFile.call(this, fileId);
    }

    // 静态方法引用
    static parseMessageContent = (TelegramBot as any).parseMessageContent;
    static formatSendContent = (TelegramBot as any).formatSendContent;
}

// 注册 polling 模式适配器
registerAdapter(new Adapter('telegram', (plugin: Plugin, config: any) => new TelegramBot(plugin, config as TelegramBotConfig)))

// 注册 webhook 模式适配器（需要 router）
useContext('router', (router) => {
    registerAdapter(new Adapter('telegram-webhook', 
        (plugin: Plugin, config: any) => new TelegramWebhookBot(plugin, router, config as TelegramWebhookConfig)
    ));
});
