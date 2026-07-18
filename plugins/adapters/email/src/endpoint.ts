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

export class EmailEndpoint implements EndpointInstance {
  readonly #options: EmailEndpointOptions;
  #smtp: EmailSmtpTransport | null = null;
  #imap: EmailImapTransport | null = null;
  #checkTimer: NodeJS.Timeout | null = null;
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
    if (this.#checkTimer) {
      clearInterval(this.#checkTimer);
      this.#checkTimer = null;
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
    this.#started = false;
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
    const saved: Array<{ filename: string; path: string; contentType?: string; size?: number }> = [];
    for (const attachment of email.attachments) {
      const filename = attachment.filename || `attachment_${Date.now()}`;
      if (config.allowedTypes?.length && !config.allowedTypes.includes(attachment.contentType ?? '')) {
        logger.debug(formatCompact({ op: 'email_attachment_skipped', filename, reason: 'type' }));
        continue;
      }
      if (attachment.size != null && attachment.size > config.maxFileSize) {
        logger.debug(formatCompact({ op: 'email_attachment_skipped', filename, reason: 'size' }));
        continue;
      }
      const filepath = path.join(config.downloadPath, filename);
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
    });
    imap.on('end', () => {
      logger.debug(formatCompact({
        op: 'disconnect',
        endpoint: this.#options.config.name,
        mode: 'imap',
      }));
    });
  }

  #startEmailCheck(): void {
    if (this.#checkTimer) return;
    this.#checkTimer = setInterval(() => {
      void this.#checkForNewEmails();
    }, this.#options.config.imap.checkInterval);
    void this.#checkForNewEmails();
  }

  async #checkForNewEmails(): Promise<void> {
    if (!this.#imap || !this.#started) return;
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
