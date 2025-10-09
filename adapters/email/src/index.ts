import nodemailer from 'nodemailer';
import Imap from 'imap';
import { simpleParser, ParsedMail, Attachment } from 'mailparser';
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
    segment
} from "zhin.js";
import { EventEmitter } from 'events';
import { createWriteStream, promises as fs } from 'fs';
import path from 'path';

// 声明模块，注册 email 适配器类型
declare module 'zhin.js' {
    interface RegisteredAdapters {
        email: Adapter<EmailBot>
    }
}

// SMTP 配置
export interface SmtpConfig {
    host: string;
    port: number;
    secure: boolean;
    auth: {
        user: string;
        pass: string;
    };
}

// IMAP 配置
export interface ImapConfig {
    host: string;
    port: number;
    tls: boolean;
    user: string;
    password: string;
    // 检查新邮件的间隔（毫秒）
    checkInterval?: number;
    // 要监听的邮箱文件夹
    mailbox?: string;
    // 是否标记已读
    markSeen?: boolean;
}

// 配置类型定义
export type EmailBotConfig = BotConfig & {
    context: 'email'
    name: string
    smtp: SmtpConfig
    imap: ImapConfig
    // 附件处理配置
    attachments?: {
        enabled: boolean
        downloadPath?: string
        maxFileSize?: number
        allowedTypes?: string[]
    }
}

// 邮件消息接口
export interface EmailMessage {
    messageId: string
    from: string
    to: string[]
    cc?: string[]
    bcc?: string[]
    subject: string
    text?: string
    html?: string
    attachments: Attachment[]
    date: Date
    uid: number
}

// Bot 类实现
export class EmailBot extends EventEmitter implements Bot<EmailMessage, EmailBotConfig> {
    $config: EmailBotConfig;
    plugin: Plugin;
    
    private smtpTransporter: nodemailer.Transporter | null = null;
    private imapConnection: Imap | null = null;
    private checkTimer: NodeJS.Timeout | null = null;
    private isConnected = false;

    constructor(plugin: Plugin, config: EmailBotConfig) {
        super();
        this.$config = config;
        this.plugin = plugin;
        
        // 设置默认值
        this.$config.imap.checkInterval = this.$config.imap.checkInterval || 60000; // 1分钟
        this.$config.imap.mailbox = this.$config.imap.mailbox || 'INBOX';
        this.$config.imap.markSeen = this.$config.imap.markSeen !== false;
        
        if (this.$config.attachments?.enabled) {
            this.$config.attachments.downloadPath = this.$config.attachments.downloadPath || './downloads/email';
            this.$config.attachments.maxFileSize = this.$config.attachments.maxFileSize || 10 * 1024 * 1024; // 10MB
        }
    }

    async $connect(): Promise<void> {
        try {
            // 初始化 SMTP 传输器
            this.smtpTransporter = nodemailer.createTransport({
                host: this.$config.smtp.host,
                port: this.$config.smtp.port,
                secure: this.$config.smtp.secure,
                auth: this.$config.smtp.auth
            });

            // 验证 SMTP 连接
            await this.smtpTransporter!.verify();
            this.plugin.logger.info(`SMTP connection verified for ${this.$config.smtp.auth.user}`);

            // 初始化 IMAP 连接
            this.imapConnection = new Imap({
                user: this.$config.imap.user,
                password: this.$config.imap.password,
                host: this.$config.imap.host,
                port: this.$config.imap.port,
                tls: this.$config.imap.tls
            });

            // 设置 IMAP 事件监听
            this.setupImapListeners();

            // 连接 IMAP
            await new Promise<void>((resolve, reject) => {
                this.imapConnection!.once('ready', resolve);
                this.imapConnection!.once('error', reject);
                this.imapConnection!.connect();
            });

            this.plugin.logger.info(`IMAP connection established for ${this.$config.imap.user}`);

            // 开始检查邮件
            this.startEmailCheck();
            this.isConnected = true;

        } catch (error) {
            this.plugin.logger.error('Failed to connect email services:', error);
            throw error;
        }
    }

    async $disconnect(): Promise<void> {
        this.isConnected = false;

        // 停止定时检查
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
        }

        // 关闭 IMAP 连接
        if (this.imapConnection) {
            this.imapConnection.end();
            this.imapConnection = null;
        }

        // 关闭 SMTP 连接
        if (this.smtpTransporter) {
            this.smtpTransporter.close();
            this.smtpTransporter = null;
        }

        this.plugin.logger.info('Email bot disconnected');
    }

    private setupImapListeners(): void {
        if (!this.imapConnection) return;

        this.imapConnection.on('mail', (numNewMsgs: number) => {
            this.plugin.logger.debug(`Received ${numNewMsgs} new emails`);
            this.checkForNewEmails();
        });

        this.imapConnection.on('error', (error: any) => {
            this.plugin.logger.error('IMAP error:', error);
        });

        this.imapConnection.on('end', () => {
            this.plugin.logger.info('IMAP connection ended');
        });
    }

    private startEmailCheck(): void {
        if (this.checkTimer) return;

        this.checkTimer = setInterval(() => {
            this.checkForNewEmails();
        }, this.$config.imap.checkInterval!);

        // 立即检查一次
        this.checkForNewEmails();
    }

    private async checkForNewEmails(): Promise<void> {
        if (!this.imapConnection || !this.isConnected) return;

        try {
            await new Promise<void>((resolve, reject) => {
                this.imapConnection!.openBox(this.$config.imap.mailbox!, false, (error, box) => {
                    if (error) return reject(error);

                    // 搜索未读邮件
                    this.imapConnection!.search(['UNSEEN'], (error, results) => {
                        if (error) return reject(error);

                        if (results.length === 0) {
                            return resolve();
                        }

                        // 获取邮件
                        const fetch = this.imapConnection!.fetch(results, {
                            bodies: '',
                            markSeen: this.$config.imap.markSeen
                        });

                        fetch.on('message', (msg, seqno) => {
                            this.handleImapMessage(msg, seqno);
                        });

                        fetch.once('error', reject);
                        fetch.once('end', resolve);
                    });
                });
            });
        } catch (error) {
            this.plugin.logger.error('Error checking for new emails:', error);
        }
    }

    private handleImapMessage(msg: any, seqno: number): void {
        let body = '';
        let uid = 0;

        msg.on('body', (stream: any) => {
            stream.on('data', (chunk: any) => {
                body += chunk.toString('utf8');
            });
        });

        msg.once('attributes', (attrs: any) => {
            uid = attrs.uid;
        });

        msg.once('end', async () => {
            try {
                const parsed = await simpleParser(body);
                const emailMessage = this.parseEmailMessage(parsed, uid);
                const formattedMessage = this.$formatMessage(emailMessage);
                this.emit('message.receive', formattedMessage);
            } catch (error) {
                this.plugin.logger.error('Error parsing email:', error);
            }
        });
    }

    private parseEmailMessage(parsed: ParsedMail, uid: number): EmailMessage {
        const getAddressText = (addr: any): string[] => {
            if (!addr) return [];
            if (Array.isArray(addr)) {
                return addr.map((a: any) => a.text || a.address || a.toString());
            }
            return [addr.text || addr.address || addr.toString()];
        };

        return {
            messageId: parsed.messageId || '',
            from: parsed.from ? getAddressText(parsed.from)[0] || '' : '',
            to: getAddressText(parsed.to),
            cc: getAddressText(parsed.cc),
            bcc: getAddressText(parsed.bcc),
            subject: parsed.subject || '',
            text: parsed.text || '',
            html: parsed.html ? parsed.html.toString() : '',
            attachments: parsed.attachments || [],
            date: parsed.date || new Date(),
            uid
        };
    }

    $formatMessage(emailMsg: EmailMessage): Message<EmailMessage> {
        // 确定频道类型和ID
        const channelType = 'private';
        const channelId = emailMsg.from;

        // 解析邮件内容
        const content = EmailBot.parseEmailContent(emailMsg);

        const result = Message.from(emailMsg, {
            $id: emailMsg.messageId,
            $adapter: 'email',
            $bot: this.$config.name,
            $sender: {
                id: emailMsg.from,
                name: emailMsg.from.split('<')[0].trim() || emailMsg.from
            },
            $channel: {
                id: channelId,
                type: channelType as any
            },
            $raw: JSON.stringify(emailMsg),
            $timestamp: emailMsg.date.getTime(),
            $content: content,
            $reply: async (content: SendContent): Promise<void> => {
                await this.$sendMessage({
                    context: this.$config.context,
                    bot: this.$config.name,
                    id: emailMsg.from,
                    type: 'private',
                    content
                });
            }
        });

        return result;
    }

    static parseEmailContent(email: EmailMessage): MessageSegment[] {
        const segments: MessageSegment[] = [];

        // 添加主题（如果有且不为空）
        if (email.subject) {
            segments.push(segment.text(`Subject: ${email.subject}\n\n`));
        }

        // 添加文本内容
        if (email.text) {
            segments.push(segment.text(email.text));
        }

        // 如果没有纯文本但有HTML，尝试转换
        if (!email.text && email.html) {
            // 简单的HTML到文本转换
            const textFromHtml = email.html
                .replace(/<[^>]*>/g, '') // 移除HTML标签
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .trim();
            
            if (textFromHtml) {
                segments.push(segment.text(textFromHtml));
            }
        }

        // 处理附件
        for (const attachment of email.attachments) {
            if (attachment.contentType?.startsWith('image/')) {
                segments.push(segment('image', {
                    filename: attachment.filename,
                    contentType: attachment.contentType,
                    size: attachment.size
                }));
            } else {
                segments.push(segment('file', {
                    filename: attachment.filename,
                    contentType: attachment.contentType,
                    size: attachment.size
                }));
            }
        }

        return segments.length > 0 ? segments : [segment.text('(Empty email)')];
    }

    async $sendMessage(options: SendOptions): Promise<void> {
        if (!this.smtpTransporter) {
            throw new Error('SMTP transporter not initialized');
        }

        try {
            const mailOptions = await this.formatSendContent(options);
            const info = await this.smtpTransporter.sendMail(mailOptions);
            this.plugin.logger.debug('Email sent:', info.messageId);
        } catch (error) {
            this.plugin.logger.error('Failed to send email:', error);
            throw error;
        }
    }

    private async formatSendContent(options: SendOptions): Promise<nodemailer.SendMailOptions> {
        const mailOptions: nodemailer.SendMailOptions = {
            from: this.$config.smtp.auth.user,
            to: options.id,
            subject: 'Message from Bot'
        };

        if (typeof options.content === 'string') {
            mailOptions.text = options.content;
        } else if (Array.isArray(options.content)) {
            const textParts: string[] = [];
            const htmlParts: string[] = [];
            const attachments: any[] = [];

            for (const item of options.content) {
                if (typeof item === 'string') {
                    textParts.push(item);
                    htmlParts.push(item.replace(/\n/g, '<br>'));
                } else {
                    const segment = item as MessageSegment;
                    switch (segment.type) {
                        case 'text':
                            const textContent = segment.data.text || segment.data.content || '';
                            textParts.push(textContent);
                            htmlParts.push(textContent.replace(/\n/g, '<br>'));
                            break;
                        case 'image':
                            if (segment.data.url) {
                                attachments.push({
                                    filename: segment.data.filename || 'image.png',
                                    path: segment.data.url
                                });
                            }
                            break;
                        case 'file':
                            if (segment.data.url) {
                                attachments.push({
                                    filename: segment.data.filename || 'file',
                                    path: segment.data.url
                                });
                            }
                            break;
                    }
                }
            }

            if (textParts.length > 0) {
                mailOptions.text = textParts.join('\n');
                mailOptions.html = htmlParts.join('<br>');
            }

            if (attachments.length > 0) {
                mailOptions.attachments = attachments;
            }
        }

        // 如果有回复对象，可以在这里处理
        // 邮件适配器暂时不支持回复对象

        return mailOptions;
    }

    // 下载附件到本地
    private async downloadAttachment(attachment: Attachment): Promise<string> {
        if (!this.$config.attachments?.enabled || !this.$config.attachments.downloadPath) {
            throw new Error('Attachment download is not enabled');
        }

        const downloadPath = this.$config.attachments.downloadPath;
        await fs.mkdir(downloadPath, { recursive: true });

        const filename = attachment.filename || `attachment_${Date.now()}`;
        const filepath = path.join(downloadPath, filename);

        return new Promise((resolve, reject) => {
            const writeStream = createWriteStream(filepath);
            writeStream.write(attachment.content);
            writeStream.end();
            
            writeStream.on('finish', () => resolve(filepath));
            writeStream.on('error', reject);
        });
    }
}

// 创建和注册适配器
export default class EmailAdapter extends Adapter<EmailBot> {
    constructor() {
        super('email', EmailBot);
    }
}

// 注册适配器到全局
registerAdapter(new EmailAdapter());
