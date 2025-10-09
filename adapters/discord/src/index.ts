import {
    Client,
    GatewayIntentBits,
    Message as DiscordMessage,
    TextChannel,
    DMChannel,
    NewsChannel,
    ThreadChannel,
    EmbedBuilder,
    AttachmentBuilder,
    MessageCreateOptions,
    ChannelType,
    User,
    GuildMember,
    SlashCommandBuilder,
    CommandInteraction,
    REST,
    Routes,
    ApplicationCommandData,
    ChatInputCommandInteraction,
    InteractionType,
    InteractionResponseType
} from 'discord.js';
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
import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';

// 声明模块，注册 discord 适配器类型
declare module 'zhin.js' {
    interface RegisteredAdapters {
        discord: Adapter<DiscordBot>
        'discord-interactions': Adapter<DiscordInteractionsBot>
    }
}

// Discord Gateway 模式配置
export type DiscordBotConfig = BotConfig & {
    context: 'discord'
    token: string
    name: string
    intents?: GatewayIntentBits[]
    // Discord 特有配置
    enableSlashCommands?: boolean
    globalCommands?: boolean
    defaultActivity?: {
        name: string
        type: 'PLAYING' | 'STREAMING' | 'LISTENING' | 'WATCHING' | 'COMPETING'
        url?: string
    }
    // Slash Commands 定义
    slashCommands?: ApplicationCommandData[]
}

// Discord Interactions 模式配置
export interface DiscordInteractionsConfig extends BotConfig {
    context: 'discord-interactions'
    token: string
    name: string
    applicationId: string
    publicKey: string  // Discord 应用的 Public Key
    interactionsPath: string  // 交互端点路径，如 '/discord/interactions'
    // 是否同时使用 Gateway（默认 false）
    useGateway?: boolean
    intents?: GatewayIntentBits[]
    // Slash Commands 定义
    slashCommands?: ApplicationCommandData[]
    globalCommands?: boolean
    defaultActivity?: {
        name: string
        type: 'PLAYING' | 'STREAMING' | 'LISTENING' | 'WATCHING' | 'COMPETING'
        url?: string
    }
}

// Bot 接口
export interface DiscordBot {
    $config: DiscordBotConfig
}

export interface DiscordInteractionsBot {
    $config: DiscordInteractionsConfig
}

// Discord 消息类型
type DiscordChannelMessage = DiscordMessage<boolean>;

// 主要的 DiscordBot 类
export class DiscordBot extends Client implements Bot<DiscordChannelMessage, DiscordBotConfig> {
    $connected?: boolean
    private slashCommandHandlers: Map<string, (interaction: ChatInputCommandInteraction) => Promise<void>> = new Map()

    constructor(private plugin: Plugin, public $config: DiscordBotConfig) {
        const intents = $config.intents || [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessageReactions
        ];

        super({ intents });
        this.$connected = false;
    }

    private async handleDiscordMessage(msg: DiscordChannelMessage): Promise<void> {
        // 忽略机器人消息
        if (msg.author.bot) return;

        const message = this.$formatMessage(msg);
        this.plugin.dispatch('message.receive', message);
        this.plugin.logger.info(`recv ${message.$channel.type}(${message.$channel.id}): ${segment.raw(message.$content)}`);
        this.plugin.dispatch(`message.${message.$channel.type}.receive`, message);
    }

    private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const commandName = interaction.commandName;
        const handler = this.slashCommandHandlers.get(commandName);
        
        if (handler) {
            try {
                await handler(interaction);
                this.plugin.logger.info(`Executed slash command: /${commandName} by ${interaction.user.tag}`);
            } catch (error) {
                this.plugin.logger.error(`Error executing slash command /${commandName}:`, error);
                
                const errorMessage = 'An error occurred while executing this command.';
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: errorMessage, ephemeral: true });
                } else {
                    await interaction.reply({ content: errorMessage, ephemeral: true });
                }
            }
        } else {
            this.plugin.logger.warn(`Unknown slash command: /${commandName}`);
            if (!interaction.replied) {
                await interaction.reply({ 
                    content: 'Unknown command.', 
                    ephemeral: true 
                });
            }
        }
    }

    async $connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            // 监听消息事件
            this.on('messageCreate', this.handleDiscordMessage.bind(this));

            // 监听交互事件（Slash Commands）
            if (this.$config.enableSlashCommands) {
                this.on('interactionCreate', async (interaction) => {
                    if (interaction.isChatInputCommand()) {
                        await this.handleSlashCommand(interaction);
                    }
                });
            }

            // 监听就绪事件
            this.once('ready', async () => {
                this.$connected = true;
                this.plugin.logger.info(`Discord bot ${this.$config.name} connected successfully as ${this.user?.tag}`);
                
                // 设置活动状态
                if (this.$config.defaultActivity) {
                    this.user?.setActivity(this.$config.defaultActivity.name, {
                        type: this.getActivityType(this.$config.defaultActivity.type),
                        url: this.$config.defaultActivity.url
                    });
                }

                // 注册 Slash Commands
                if (this.$config.enableSlashCommands && this.$config.slashCommands) {
                    await this.registerSlashCommands();
                }
                
                resolve();
            });

            // 监听错误事件
            this.on('error', (error) => {
                this.plugin.logger.error('Discord client error:', error);
                this.$connected = false;
                reject(error);
            });

            // 登录
            this.login(this.$config.token).catch((error) => {
                this.plugin.logger.error('Failed to login to Discord:', error);
                this.$connected = false;
                reject(error);
            });
        });
    }

    async $disconnect(): Promise<void> {
        try {
            await this.destroy();
            this.$connected = false;
            this.plugin.logger.info(`Discord bot ${this.$config.name} disconnected`);
        } catch (error) {
            this.plugin.logger.error('Error disconnecting Discord bot:', error);
            throw error;
        }
    }

    $formatMessage(msg: DiscordChannelMessage): Message<DiscordChannelMessage> {
        // 确定聊天类型和ID
        let channelType: 'private' | 'group' | 'channel';
        let channelId: string;

        if (msg.channel.type === ChannelType.DM) {
            channelType = 'private';
            channelId = msg.channel.id;
        } else if (msg.channel.type === ChannelType.GroupDM) {
            channelType = 'group';
            channelId = msg.channel.id;
        } else {
            channelType = 'channel';
            channelId = msg.channel.id;
        }

        // 转换消息内容为 segment 格式
        const content = this.parseMessageContent(msg);

        const result = Message.from(msg, {
            $id: msg.id,
            $adapter: 'discord',
            $bot: this.$config.name,
            $sender: {
                id: msg.author.id,
                name: msg.member?.displayName || msg.author.displayName
            },
            $channel: {
                id: channelId,
                type: channelType
            },
            $content: content,
            $raw: msg.content,
            $timestamp: msg.createdTimestamp,
            $reply: async (content: SendContent, quote?: boolean | string): Promise<void> => {
                if (!Array.isArray(content)) content = [content];

                const sendOptions: MessageCreateOptions = {};

                // 处理回复消息
                if (quote) {
                    const replyId = typeof quote === "boolean" ? result.$id : quote;
                    try {
                        const replyMessage = await msg.channel.messages.fetch(replyId);
                        sendOptions.reply = { messageReference: replyMessage };
                    } catch (error) {
                        this.plugin.logger.warn(`Could not find message to reply to: ${replyId}`);
                    }
                }

                await this.sendContentToChannel(msg.channel as any, content, sendOptions);
            }
        });

        return result;
    }

    // 解析 Discord 消息内容为 segment 格式
    parseMessageContent(msg: DiscordChannelMessage): MessageSegment[] {
        const segments: MessageSegment[] = [];

        // 回复消息处理
        if (msg.reference) {
            segments.push({
                type: 'reply',
                data: {
                    id: msg.reference.messageId,
                    channel_id: msg.reference.channelId,
                    guild_id: msg.reference.guildId
                }
            });
        }

        // 文本消息（包含提及、表情等）
        if (msg.content) {
            segments.push(...this.parseTextContent(msg.content, msg));
        }

        // 附件消息
        for (const attachment of msg.attachments.values()) {
            segments.push(...this.parseAttachment(attachment));
        }

        // Embed 消息
        for (const embed of msg.embeds) {
            segments.push({
                type: 'embed',
                data: {
                    title: embed.title,
                    description: embed.description,
                    color: embed.color,
                    url: embed.url,
                    thumbnail: embed.thumbnail,
                    image: embed.image,
                    author: embed.author,
                    footer: embed.footer,
                    fields: embed.fields,
                    timestamp: embed.timestamp
                }
            });
        }

        // 贴纸消息
        for (const sticker of msg.stickers.values()) {
            segments.push({
                type: 'sticker',
                data: {
                    id: sticker.id,
                    name: sticker.name,
                    url: sticker.url,
                    format: sticker.format,
                    tags: sticker.tags
                }
            });
        }

        return segments.length > 0 ? segments : [{ type: 'text', data: { text: '' } }];
    }

    // 解析文本内容，处理提及、频道引用、角色引用等
    parseTextContent(content: string, msg: DiscordChannelMessage): MessageSegment[] {
        const segments: MessageSegment[] = [];
        let lastIndex = 0;

        // 匹配用户提及 <@!?用户ID>
        const userMentionRegex = /<@!?(\d+)>/g;
        // 匹配频道提及 <#频道ID>  
        const channelMentionRegex = /<#(\d+)>/g;
        // 匹配角色提及 <@&角色ID>
        const roleMentionRegex = /<@&(\d+)>/g;
        // 匹配自定义表情 <:名称:ID> 或 <a:名称:ID>
        const emojiRegex = /<a?:(\w+):(\d+)>/g;

        const allMatches: Array<{
            match: RegExpExecArray;
            type: 'user' | 'channel' | 'role' | 'emoji';
        }> = [];

        // 收集所有匹配项
        let match;
        while ((match = userMentionRegex.exec(content)) !== null) {
            allMatches.push({ match, type: 'user' });
        }
        while ((match = channelMentionRegex.exec(content)) !== null) {
            allMatches.push({ match, type: 'channel' });
        }
        while ((match = roleMentionRegex.exec(content)) !== null) {
            allMatches.push({ match, type: 'role' });
        }
        while ((match = emojiRegex.exec(content)) !== null) {
            allMatches.push({ match, type: 'emoji' });
        }

        // 按位置排序
        allMatches.sort((a, b) => a.match.index! - b.match.index!);

        // 处理每个匹配项
        for (const { match, type } of allMatches) {
            const matchStart = match.index!;
            const matchEnd = matchStart + match[0].length;

            // 添加匹配项前的文本
            if (matchStart > lastIndex) {
                const beforeText = content.slice(lastIndex, matchStart);
                if (beforeText.trim()) {
                    segments.push({ type: 'text', data: { text: beforeText } });
                }
            }

            // 添加特殊内容段
            switch (type) {
                case 'user':
                    const userId = match[1];
                    const user = msg.mentions.users.get(userId);
                    segments.push({
                        type: 'at',
                        data: {
                            id: userId,
                            name: user?.username || 'Unknown',
                            text: match[0]
                        }
                    });
                    break;

                case 'channel':
                    const channelId = match[1];
                    const channel = msg.mentions.channels.get(channelId);
                    segments.push({
                        type: 'channel_mention',
                        data: {
                            id: channelId,
                            name: (channel as any)?.name || 'unknown-channel',
                            text: match[0]
                        }
                    });
                    break;

                case 'role':
                    const roleId = match[1];
                    const role = msg.mentions.roles.get(roleId);
                    segments.push({
                        type: 'role_mention',
                        data: {
                            id: roleId,
                            name: role?.name || 'unknown-role',
                            text: match[0]
                        }
                    });
                    break;

                case 'emoji':
                    const emojiName = match[1];
                    const emojiId = match[2];
                    const isAnimated = match[0].startsWith('<a:');
                    segments.push({
                        type: 'emoji',
                        data: {
                            id: emojiId,
                            name: emojiName,
                            animated: isAnimated,
                            url: `https://cdn.discordapp.com/emojis/${emojiId}.${isAnimated ? 'gif' : 'png'}`,
                            text: match[0]
                        }
                    });
                    break;
            }

            lastIndex = matchEnd;
        }

        // 添加最后剩余的文本
        if (lastIndex < content.length) {
            const remainingText = content.slice(lastIndex);
            if (remainingText.trim()) {
                segments.push({ type: 'text', data: { text: remainingText } });
            }
        }

        return segments.length > 0 ? segments : [{ type: 'text', data: { text: content } }];
    }

    // 解析附件
    parseAttachment(attachment: any): MessageSegment[] {
        const segments: MessageSegment[] = [];

        if (attachment.contentType?.startsWith('image/')) {
            segments.push({
                type: 'image',
                data: {
                    id: attachment.id,
                    name: attachment.name,
                    url: attachment.url,
                    proxy_url: attachment.proxyURL,
                    size: attachment.size,
                    width: attachment.width,
                    height: attachment.height,
                    content_type: attachment.contentType
                }
            });
        } else if (attachment.contentType?.startsWith('audio/')) {
            segments.push({
                type: 'audio',
                data: {
                    id: attachment.id,
                    name: attachment.name,
                    url: attachment.url,
                    proxy_url: attachment.proxyURL,
                    size: attachment.size,
                    content_type: attachment.contentType
                }
            });
        } else if (attachment.contentType?.startsWith('video/')) {
            segments.push({
                type: 'video',
                data: {
                    id: attachment.id,
                    name: attachment.name,
                    url: attachment.url,
                    proxy_url: attachment.proxyURL,
                    size: attachment.size,
                    width: attachment.width,
                    height: attachment.height,
                    content_type: attachment.contentType
                }
            });
        } else {
            segments.push({
                type: 'file',
                data: {
                    id: attachment.id,
                    name: attachment.name,
                    url: attachment.url,
                    proxy_url: attachment.proxyURL,
                    size: attachment.size,
                    content_type: attachment.contentType
                }
            });
        }

        return segments;
    }

    async $sendMessage(options: SendOptions): Promise<void> {
        options = await this.plugin.app.handleBeforeSend(options);

        try {
            const channel = await this.channels.fetch(options.id);
            if (!channel || !channel.isTextBased()) {
                throw new Error(`Channel ${options.id} is not a text channel`);
            }

            await this.sendContentToChannel(channel as any, options.content);
            this.plugin.logger.info(`send ${options.type}(${options.id}): ${segment.raw(options.content)}`);
        } catch (error) {
            this.plugin.logger.error('Failed to send Discord message:', error);
            throw error;
        }
    }

    // 发送内容到频道
    async sendContentToChannel(
        channel: TextChannel | DMChannel | NewsChannel | ThreadChannel,
        content: SendContent,
        extraOptions: MessageCreateOptions = {}
    ): Promise<void> {
        if (!Array.isArray(content)) content = [content];

        const messageOptions: MessageCreateOptions = { ...extraOptions };
        let textContent = '';
        const embeds: EmbedBuilder[] = [];
        const files: AttachmentBuilder[] = [];

        for (const segment of content) {
            if (typeof segment === 'string') {
                textContent += segment;
                continue;
            }

            const { type, data } = segment;

            switch (type) {
                case 'text':
                    textContent += data.text || '';
                    break;

                case 'at':
                    textContent += `<@${data.id}>`;
                    break;

                case 'channel_mention':
                    textContent += `<#${data.id}>`;
                    break;

                case 'role_mention':
                    textContent += `<@&${data.id}>`;
                    break;

                case 'emoji':
                    textContent += data.animated ? `<a:${data.name}:${data.id}>` : `<:${data.name}:${data.id}>`;
                    break;

                case 'image':
                case 'audio':
                case 'video':
                case 'file':
                    await this.handleFileSegment(data, files, textContent);
                    break;

                case 'embed':
                    embeds.push(this.createEmbedFromData(data));
                    break;

                default:
                    // 未知类型作为文本处理
                    textContent += data.text || `[${type}]`;
            }
        }

        // 设置消息内容
        if (textContent.trim()) {
            messageOptions.content = textContent.trim();
        }

        if (embeds.length > 0) {
            messageOptions.embeds = embeds.slice(0, 10); // Discord 限制最多10个embed
        }

        if (files.length > 0) {
            messageOptions.files = files;
        }

        // 发送消息
        await channel.send(messageOptions);
    }

    // 处理文件段
    async handleFileSegment(data: any, files: AttachmentBuilder[], textContent: string): Promise<void> {
        if (data.file && await this.fileExists(data.file)) {
            // 本地文件
            files.push(new AttachmentBuilder(createReadStream(data.file), {
                name: data.name || path.basename(data.file)
            }));
        } else if (data.url) {
            // URL 文件
            files.push(new AttachmentBuilder(data.url, {
                name: data.name || 'attachment'
            }));
        } else if (data.buffer) {
            // Buffer 数据
            files.push(new AttachmentBuilder(data.buffer, {
                name: data.name || 'attachment'
            }));
        }
    }

    // 从数据创建 Embed
    createEmbedFromData(data: any): EmbedBuilder {
        const embed = new EmbedBuilder();

        if (data.title) embed.setTitle(data.title);
        if (data.description) embed.setDescription(data.description);
        if (data.color) embed.setColor(data.color);
        if (data.url) embed.setURL(data.url);
        if (data.thumbnail?.url) embed.setThumbnail(data.thumbnail.url);
        if (data.image?.url) embed.setImage(data.image.url);
        if (data.author) embed.setAuthor(data.author);
        if (data.footer) embed.setFooter(data.footer);
        if (data.timestamp) embed.setTimestamp(new Date(data.timestamp));
        if (data.fields && Array.isArray(data.fields)) {
            embed.addFields(data.fields);
        }

        return embed;
    }

    // 工具方法：获取活动类型
    private getActivityType(type: string) {
        const activityTypes = {
            'PLAYING': 0,
            'STREAMING': 1,
            'LISTENING': 2,
            'WATCHING': 3,
            'COMPETING': 5
        };
        return activityTypes[type as keyof typeof activityTypes] || 0;
    }

    // 注册 Slash Commands
    private async registerSlashCommands(): Promise<void> {
        if (!this.$config.slashCommands || !this.user) return;

        try {
            const rest = new REST({ version: '10' }).setToken(this.$config.token);
            
            if (this.$config.globalCommands) {
                // 注册全局命令
                await rest.put(
                    Routes.applicationCommands(this.user.id),
                    { body: this.$config.slashCommands }
                );
                this.plugin.logger.info('Successfully registered global slash commands');
            } else {
                // 为每个服务器注册命令
                for (const guild of this.guilds.cache.values()) {
                    await rest.put(
                        Routes.applicationGuildCommands(this.user.id, guild.id),
                        { body: this.$config.slashCommands }
                    );
                }
                this.plugin.logger.info('Successfully registered guild slash commands');
            }
        } catch (error) {
            this.plugin.logger.error('Failed to register slash commands:', error);
        }
    }

    // 添加 Slash Command 处理器
    addSlashCommandHandler(commandName: string, handler: (interaction: ChatInputCommandInteraction) => Promise<void>) {
        this.slashCommandHandlers.set(commandName, handler);
    }

    // 移除 Slash Command 处理器
    removeSlashCommandHandler(commandName: string): boolean {
        return this.slashCommandHandlers.delete(commandName);
    }

    // 工具方法：检查文件是否存在
    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    // 静态方法：格式化内容为文本（用于日志显示）
    static formatContentToText(content: SendContent): string {
        if (!Array.isArray(content)) content = [content];

        return content.map(segment => {
            if (typeof segment === 'string') return segment;

            switch (segment.type) {
                case 'text':
                    return segment.data.text || '';
                case 'at':
                    return `@${segment.data.name || segment.data.id}`;
                case 'channel_mention':
                    return `#${segment.data.name}`;
                case 'role_mention':
                    return `@${segment.data.name}`;
                case 'image':
                    return '[图片]';
                case 'audio':
                    return '[音频]';
                case 'video':
                    return '[视频]';
                case 'file':
                    return '[文件]';
                case 'embed':
                    return '[嵌入消息]';
                case 'emoji':
                    return `:${segment.data.name}:`;
                default:
                    return `[${segment.type}]`;
            }
        }).join('');
    }
}

// ================================================================================================
// DiscordInteractionsBot 类（Interactions 端点模式）
// ================================================================================================

import * as nacl from 'tweetnacl';

export class DiscordInteractionsBot extends Client implements Bot<any, DiscordInteractionsConfig> {
    $connected?: boolean
    private router: any
    private slashCommandHandlers: Map<string, (interaction: any) => Promise<void>> = new Map()

    constructor(private plugin: Plugin, router: any, public $config: DiscordInteractionsConfig) {
        const intents = $config.intents || [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ];
        
        super({ intents });
        this.$connected = false;
        this.router = router;
        
        // 设置交互端点路由
        this.setupInteractionsEndpoint();
    }

    private setupInteractionsEndpoint(): void {
        // 设置路由处理 Discord Interactions
        this.router.post(this.$config.interactionsPath, (ctx: Context) => {
            this.handleInteraction(ctx);
        });
    }

    private async handleInteraction(ctx: Context): Promise<void> {
        try {
            const signature = ctx.get('x-signature-ed25519');
            const timestamp = ctx.get('x-signature-timestamp');
            const bodyString = JSON.stringify((ctx.request as any).body);

            // 验证请求签名
            if (!this.verifyDiscordSignature(bodyString, signature, timestamp)) {
                this.plugin.logger.warn('Invalid Discord signature');
                ctx.status = 401;
                ctx.body = 'Unauthorized';
                return;
            }

            const interaction = (ctx.request as any).body;

            // 处理不同类型的交互
            if (interaction.type === InteractionType.Ping) {
                // PING - Discord 验证端点
                ctx.body = { type: InteractionResponseType.Pong };
            } else if (interaction.type === InteractionType.ApplicationCommand) {
                // APPLICATION_COMMAND - 应用命令
                const response = await this.handleApplicationCommand(interaction);
                ctx.body = response;
            } else {
                // 其他交互类型
                ctx.status = 400;
                ctx.body = 'Unsupported interaction type';
            }

        } catch (error) {
            this.plugin.logger.error('Interactions error:', error);
            ctx.status = 500;
            ctx.body = 'Internal Server Error';
        }
    }

    private verifyDiscordSignature(body: string, signature: string, timestamp: string): boolean {
        try {
            const publicKey = Buffer.from(this.$config.publicKey, 'hex');
            const sig = Buffer.from(signature, 'hex');
            const message = Buffer.from(timestamp + body, 'utf8');
            
            return nacl.sign.detached.verify(message, sig, publicKey);
        } catch (error) {
            this.plugin.logger.error('Signature verification error:', error);
            return false;
        }
    }

    private async handleApplicationCommand(interaction: any): Promise<any> {
        // 处理应用命令
        const commandName = interaction.data.name;
        
        // 转换为标准消息格式并分发
        const message = this.formatInteractionAsMessage(interaction);
        this.plugin.dispatch('message.receive', message);
        
        // 查找自定义处理器
        const handler = this.slashCommandHandlers.get(commandName);
        if (handler) {
            try {
                await handler(interaction);
            } catch (error) {
                this.plugin.logger.error(`Error in slash command handler for ${commandName}:`, error);
            }
        }

        // 默认响应
        return {
            type: InteractionResponseType.ChannelMessageWithSource,
            data: {
                content: `处理命令: ${commandName}`,
                flags: 64 // EPHEMERAL - 只有用户可见
            }
        };
    }

    private formatInteractionAsMessage(interaction: any): Message<any> {
        const channelType = interaction.guild_id ? 'channel' : 'private';
        const channelId = interaction.channel_id;
        
        // 解析命令参数为内容
        const options = interaction.data.options || [];
        const content = [segment.text(`/${interaction.data.name}`)];
        
        for (const option of options) {
            content.push(segment.text(` ${option.name}:${option.value}`));
        }
        
        return Message.from(interaction, {
            $id: interaction.id,
            $adapter: 'discord-interactions',
            $bot: this.$config.name,
            $sender: {
                id: interaction.user?.id || interaction.member?.user?.id,
                name: interaction.user?.username || interaction.member?.user?.username
            },
            $channel: {
                id: channelId,
                type: channelType as any
            },
            $raw: JSON.stringify(interaction),
            $timestamp: Date.now(),
            $content: content,
            $reply: async (content: SendContent): Promise<void> => {
                // 通过 REST API 发送后续消息
                await this.sendFollowUp(interaction, content);
            }
        });
    }

    private async sendFollowUp(interaction: any, content: SendContent): Promise<void> {
        try {
            const rest = new REST({ version: '10' }).setToken(this.$config.token);
            const messageContent = this.formatSendContent(content);
            
            await rest.post(
                `/webhooks/${this.$config.applicationId}/${interaction.token}`,
                { body: messageContent }
            );
        } catch (error) {
            this.plugin.logger.error('Failed to send follow-up message:', error);
        }
    }

    private formatSendContent(content: SendContent): any {
        if (typeof content === 'string') {
            return { content };
        }
        
        if (Array.isArray(content)) {
            const textParts: string[] = [];
            let embed: any = null;
            
            for (const item of content) {
                if (typeof item === 'string') {
                    textParts.push(item);
                } else {
                    const segment = item as MessageSegment;
                    switch (segment.type) {
                        case 'text':
                            textParts.push(segment.data.text || segment.data.content || '');
                            break;
                        case 'embed':
                            embed = segment.data;
                            break;
                    }
                }
            }
            
            const result: any = {};
            if (textParts.length > 0) {
                result.content = textParts.join('');
            }
            if (embed) {
                result.embeds = [embed];
            }
            
            return result;
        }
        
        return { content: String(content) };
    }

    async $connect(): Promise<void> {
        try {
            // 注册 Slash Commands
            if (this.$config.slashCommands) {
                await this.registerSlashCommands();
            }
            
            // 如果启用 Gateway，连接 Discord Gateway
            if (this.$config.useGateway) {
                await this.login(this.$config.token);
                
                // 设置活动状态
                if (this.$config.defaultActivity) {
                    this.user?.setActivity(this.$config.defaultActivity.name, {
                        type: this.getActivityType(this.$config.defaultActivity.type),
                        url: this.$config.defaultActivity.url
                    });
                }
            }
            
            this.$connected = true;
            this.plugin.logger.info(`Discord interactions bot connected: ${this.$config.name}`);
            this.plugin.logger.info(`Interactions endpoint: ${this.$config.interactionsPath}`);
            
        } catch (error) {
            this.plugin.logger.error('Failed to connect Discord interactions bot:', error);
            throw error;
        }
    }

    async $disconnect(): Promise<void> {
        try {
            if (this.isReady()) {
                await this.destroy();
            }
            this.$connected = false;
            this.plugin.logger.info('Discord interactions bot disconnected');
        } catch (error) {
            this.plugin.logger.error('Error disconnecting Discord interactions bot:', error);
        }
    }

    // Slash Commands 管理
    private async registerSlashCommands(): Promise<void> {
        if (!this.$config.slashCommands) return;

        try {
            const rest = new REST({ version: '10' }).setToken(this.$config.token);
            
            if (this.$config.globalCommands) {
                await rest.put(
                    Routes.applicationCommands(this.$config.applicationId),
                    { body: this.$config.slashCommands }
                );
                this.plugin.logger.info('Successfully registered global slash commands');
            } else {
                this.plugin.logger.info('Note: Guild commands registration requires connecting to Gateway first');
            }
        } catch (error) {
            this.plugin.logger.error('Failed to register slash commands:', error);
        }
    }

    // 添加 Slash Command 处理器
    addSlashCommandHandler(commandName: string, handler: (interaction: any) => Promise<void>): void {
        this.slashCommandHandlers.set(commandName, handler);
    }

    // 移除 Slash Command 处理器
    removeSlashCommandHandler(commandName: string): boolean {
        return this.slashCommandHandlers.delete(commandName);
    }

    // 工具方法
    private getActivityType(type: string): any {
        const activityTypes: any = {
            'PLAYING': 0,
            'STREAMING': 1,
            'LISTENING': 2,
            'WATCHING': 3,
            'COMPETING': 5
        };
        return activityTypes[type] || 0;
    }

    // 简化实现 - 只支持基本消息格式化和发送
    $formatMessage(msg: any): Message<any> {
        return this.formatInteractionAsMessage(msg);
    }

    async $sendMessage(options: SendOptions): Promise<void> {
        // 简化实现 - 通过 REST API 发送消息
        try {
            const rest = new REST({ version: '10' }).setToken(this.$config.token);
            const messageContent = this.formatSendContent(options.content);
            
            await rest.post(
                Routes.channelMessages(options.id),
                { body: messageContent }
            );
        } catch (error) {
            this.plugin.logger.error('Failed to send message:', error);
        }
    }
}

// 注册 Gateway 模式适配器
registerAdapter(new Adapter('discord', (plugin: Plugin, config: any) => new DiscordBot(plugin, config as DiscordBotConfig)))

// 注册 Interactions 端点模式适配器（需要 router）
useContext('router', (router) => {
    registerAdapter(new Adapter('discord-interactions',
        (plugin: Plugin, config: any) => new DiscordInteractionsBot(plugin, router, config as DiscordInteractionsConfig)
    ));
});
