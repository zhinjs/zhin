/**
 * EmailEndpoint — lifecycle, SMTP outbound, IMAP inbound polling.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { simpleParser } from 'mailparser';
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import {
  formatInboundContent,
  formatOutboundMail,
  parseEmailMessage,
  senderDisplayName,
  type EmailMessage,
  type ResolvedEmailConfig,
} from './protocol.js';
import {
  defaultCreateImap,
  defaultCreateSmtp,
  type EmailImapFetchMessage,
  type EmailImapTransport,
  type EmailSmtpTransport,
} from './transport.js';

const logger = getLogger('email');

export interface EmailEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly config: ResolvedEmailConfig;
  readonly createSmtp?: (config: ResolvedEmailConfig['smtp']) => EmailSmtpTransport | Promise<EmailSmtpTransport>;
  readonly createImap?: (config: ResolvedEmailConfig['imap']) => EmailImapTransport;
}

/**
 * Email（SMTP/IMAP）无好友/群/频道等社交图谱概念，
 * 不适用 EndpointManagement 语义端口；本 endpoint 不暴露该端口。
 */
export class EmailEndpoint implements EndpointInstance {
  readonly #options: EmailEndpointOptions;
  #smtp: EmailSmtpTransport | null = null;
  #imap: EmailImapTransport | null = null;
  #checkTimer: NodeJS.Timeout | null = null;
  #reconnectTimer: NodeJS.Timeout | null = null;
  #reconnectAttempts = 0;
  #checking = false;
  #open = false;
  #started = false;

  constructor(options: EmailEndpointOptions) {
    this.#options = options;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    const { smtp, imap, name } = this.#options.config;
    try {
      this.#smtp = await (this.#options.createSmtp?.(smtp) ?? defaultCreateSmtp(smtp));
      await this.#smtp.verify();
      logger.debug(formatCompact({ endpoint: name, mode: 'smtp' }));

      this.#imap = this.#options.createImap?.(imap) ?? defaultCreateImap(imap);
      this.#setupImapListeners(this.#imap);
      await new Promise<void>((resolve, reject) => {
        this.#imap!.once('ready', () => resolve());
        this.#imap!.once('error', (error) => reject(error));
        this.#imap!.connect();
      });
      logger.debug(formatCompact({ endpoint: name, mode: 'imap' }));
      this.#reconnectAttempts = 0;
      this.#startEmailCheck();
    } catch (error) {
      await this.stop();
      logger.error('Failed to connect email services:', error);
      throw error;
    }
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  async stop(): Promise<void> {
    this.#open = false;
    // 先复位 #started，避免 imap.end() 触发的 'end' 事件又武装重连定时器
    this.#started = false;
    if (this.#checkTimer) {
      clearInterval(this.#checkTimer);
      this.#checkTimer = null;
    }
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    if (this.#imap) {
      try {
        this.#imap.end();
      } catch {
        /* ignore */
      }
      this.#imap = null;
    }
    if (this.#smtp) {
      try {
        this.#smtp.close();
      } catch {
        /* ignore */
      }
      this.#smtp = null;
    }
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#options.config.name }));
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    if (!this.#smtp) throw new Error('SMTP transporter not initialized');
    const mailOptions = formatOutboundMail(payload, {
      from: this.#options.config.smtp.auth.user,
      to: target,
    });
    const info = await this.#smtp.sendMail(mailOptions);
    logger.debug(formatCompact({ op: 'email_send', target, messageId: info.messageId }));
    return info.messageId || '';
  }

  /** Test / internal: admit a parsed mail when the endpoint is open. */
  admit(email: EmailMessage): void {
    if (!this.#open) return;
    void this.#admitWithAttachments(email).catch((err) => {
      logger.warn(formatCompact({
        op: 'email_gateway_receive_failed',
        target: email.from,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async #admitWithAttachments(email: EmailMessage): Promise<void> {
    const savedAttachments = await this.#downloadAttachments(email);
    const content = formatInboundContent(email);
    const sender = email.from;
    await this.#options.gateway.receive({
      adapter: this.#options.id,
      target: sender,
      content,
      sender: senderDisplayName(sender),
      id: email.messageId || undefined,
      metadata: Object.freeze({
        subject: email.subject,
        to: email.to,
        cc: email.cc,
        uid: email.uid,
        date: email.date.toISOString(),
        endpoint: this.#options.config.name,
        ...(savedAttachments.length ? { attachments: savedAttachments } : {}),
      }),
    });
  }

  /**
   * attachments.enabled 时把入站附件落盘（恢复旧 downloadAttachment 行为，
   * 附加 maxFileSize / allowedTypes 过滤）；返回落盘结果供 admit metadata 使用。
   */
  async #downloadAttachments(
    email: EmailMessage,
  ): Promise<Array<{ filename: string; path: string; contentType?: string; size?: number }>> {
    const config = this.#options.config.attachments;
    if (!config?.enabled || email.attachments.length === 0) return [];
    await mkdir(config.downloadPath, { recursive: true });
    const downloadRoot = path.resolve(config.downloadPath);
    const saved: Array<{ filename: string; path: string; contentType?: string; size?: number }> = [];
    for (const attachment of email.attachments) {
      // 防路径穿越：发件人可构造 ../../ 等文件名，basename + resolve 后必须落在 downloadPath 内
      const rawName = attachment.filename || `attachment_${Date.now()}`;
      const filename = path.basename(rawName) || `attachment_${Date.now()}`;
      const filepath = path.resolve(downloadRoot, filename);
      if (filepath !== downloadRoot && !filepath.startsWith(downloadRoot + path.sep)) {
        logger.warn(formatCompact({ op: 'email_attachment_skipped', filename: rawName, reason: 'path' }));
        continue;
      }
      if (config.allowedTypes?.length && !config.allowedTypes.includes(attachment.contentType ?? '')) {
        logger.debug(formatCompact({ op: 'email_attachment_skipped', filename, reason: 'type' }));
        continue;
      }
      if (attachment.size != null && attachment.size > config.maxFileSize) {
        logger.debug(formatCompact({ op: 'email_attachment_skipped', filename, reason: 'size' }));
        continue;
      }
      try {
        await writeFile(filepath, attachment.content);
        saved.push({ filename, path: filepath, contentType: attachment.contentType, size: attachment.size });
      } catch (error) {
        logger.warn(formatCompact({
          op: 'email_attachment_download_failed',
          filename,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    return saved;
  }

  #setupImapListeners(imap: EmailImapTransport): void {
    imap.on('mail', () => {
      void this.#checkForNewEmails();
    });
    imap.on('error', (error) => {
      logger.error('IMAP error:', error);
      // imap 通常在 error 后紧跟 end；两处都调度，靠已有定时器去重
      this.#scheduleImapReconnect();
    });
    imap.on('end', () => {
      logger.debug(formatCompact({
        op: 'disconnect',
        endpoint: this.#options.config.name,
        mode: 'imap',
      }));
      this.#scheduleImapReconnect();
    });
  }

  /** IMAP 断线后按指数退避重建连接并恢复监听（基数 reconnectInterval，封顶 5 分钟）。 */
  #scheduleImapReconnect(): void {
    if (!this.#started || this.#reconnectTimer) return;
    const base = this.#options.config.imap.reconnectInterval;
    const delay = Math.min(base * 2 ** this.#reconnectAttempts, 300_000);
    this.#reconnectAttempts += 1;
    logger.warn(formatCompact({
      op: 'imap_reconnect_scheduled',
      endpoint: this.#options.config.name,
      reconnect_ms: delay,
    }));
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.#reconnectImap();
    }, delay);
  }

  async #reconnectImap(): Promise<void> {
    if (!this.#started) return;
    try {
      const imap = this.#options.createImap?.(this.#options.config.imap)
        ?? defaultCreateImap(this.#options.config.imap);
      this.#imap = imap;
      this.#setupImapListeners(imap);
      await new Promise<void>((resolve, reject) => {
        imap.once('ready', () => resolve());
        imap.once('error', (error) => reject(error));
        imap.connect();
      });
      this.#reconnectAttempts = 0;
      logger.info(formatCompact({
        op: 'imap_reconnect',
        endpoint: this.#options.config.name,
        ok: true,
      }));
      void this.#checkForNewEmails();
    } catch (error) {
      logger.warn(formatCompact({
        op: 'imap_reconnect',
        endpoint: this.#options.config.name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      this.#scheduleImapReconnect();
    }
  }

  #startEmailCheck(): void {
    if (this.#checkTimer) return;
    this.#checkTimer = setInterval(() => {
      void this.#checkForNewEmails();
    }, this.#options.config.imap.checkInterval);
    void this.#checkForNewEmails();
  }

  async #checkForNewEmails(): Promise<void> {
    if (!this.#imap || !this.#started || this.#checking) return;
    // 在飞锁：定时器与 mail 事件可能并发触发，串行化避免重复 admit
    this.#checking = true;
    try {
      await new Promise<void>((resolve, reject) => {
        this.#imap!.openBox(this.#options.config.imap.mailbox, false, (error) => {
          if (error) return reject(error);
          this.#imap!.search(['UNSEEN'], (searchError, results) => {
            if (searchError) return reject(searchError);
            if (!results.length) return resolve();
            const fetch = this.#imap!.fetch(results, {
              bodies: '',
              markSeen: this.#options.config.imap.markSeen,
            });
            fetch.on('message', (msg, seqno) => {
              this.#handleImapMessage(msg, seqno);
            });
            fetch.once('error', (fetchError) => reject(fetchError));
            fetch.once('end', () => resolve());
          });
        });
      });
    } catch (error) {
      logger.error('Error checking for new emails:', error);
    } finally {
      this.#checking = false;
    }
  }

  #handleImapMessage(msg: EmailImapFetchMessage, _seqno: number): void {
    let body = '';
    let uid = 0;
    msg.on('body', (stream) => {
      stream.on('data', (chunk: Buffer | string) => {
        body += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      });
    });
    msg.once('attributes', (attrs) => {
      uid = attrs.uid ?? 0;
    });
    msg.once('end', () => {
      void simpleParser(body).then((parsed) => {
        this.admit(parseEmailMessage(parsed, uid));
      }).catch((error) => {
        logger.error('Error parsing email:', error);
      });
    });
  }
}
