import { EventEmitter } from 'node:events';
import { createEndpointLifecycle, type EndpointLifecycle, type EndpointSendRequest, type EndpointTransportState } from 'zhin.js/adapter';
/**
 * EmailClient — lifecycle, SMTP outbound, IMAP inbound polling.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { simpleParser } from 'mailparser';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import {
  emailInboundConversation,
  formatInboundContent,
  formatInboundSegments,
  formatOutboundMail,
  parseEmailMessage,
  senderDisplayName,
  type EmailMessage,
  type ResolvedEmailConfig,
  type SavedEmailAttachment,
} from './protocol.js';
import {
  defaultCreateImap,
  defaultCreateSmtp,
  type EmailImapFetchMessage,
  type EmailImapTransport,
  type EmailSmtpTransport,
} from './transport.js';
import { requireSmtpAcceptance, smtpDeliveryError } from './delivery.js';

export interface EmailEndpointOptions {
  readonly id: CapabilityId;
  readonly config: ResolvedEmailConfig;
  readonly createSmtp?: (config: ResolvedEmailConfig['smtp']) => EmailSmtpTransport | Promise<EmailSmtpTransport>;
  readonly createImap?: (config: ResolvedEmailConfig['imap']) => EmailImapTransport;
}

/**
 * Email（SMTP/IMAP）无好友/群/频道等社交图谱概念，
 * 不适用 EndpointManagement 语义端口；本 endpoint 不暴露该端口。
 */
export class EmailClient extends EventEmitter {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: EmailEndpointOptions;
  #smtp: EmailSmtpTransport | null = null;
  #imap: EmailImapTransport | null = null;
  #imapOwner?: object;
  #checkTimer: NodeJS.Timeout | null = null;
  readonly #lifecycle: EndpointLifecycle;
  readonly #seenMail = new Map<string, number>();
  #checkOwner?: object;
  #mailboxValidity?: string;
  readonly #pendingMail = new Map<string, Promise<void>>();
  get transportState(): EndpointTransportState { return this.#lifecycle.state; }
  #open = false;
  #started = false;

  protected configName(): string { return this.#options.config.id; }
  protected executionSignal?: AbortSignal;
  protected setExecutionSignal(signal: AbortSignal): void { this.executionSignal = signal; }
  /** Mailparser has no abort API; stop observing its result when the existing execution retires. */
  #awaitInbound<T>(operation: Promise<T>): Promise<T> {
    const signal = this.executionSignal;
    if (!signal) return operation;
    return new Promise<T>((resolve, reject) => {
      const cancel = () => { signal.removeEventListener('abort', cancel); reject(signal.reason); };
      operation.then(value => { signal.removeEventListener('abort', cancel); resolve(value); },
        error => { signal.removeEventListener('abort', cancel); reject(error); });
      if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
    });
  }
  /** Native protocol work runs here; Endpoint attaches the framework receipt without replacing SDK APIs. */
  protected receiveInboundCallback<T>(receive: () => T | Promise<T>): Promise<T> {
    try { return Promise.resolve(receive()); } catch (error) { return Promise.reject(error); }
  }
  protected publishEvent(name: string, payload: unknown): Promise<unknown> { this.emit(name, payload); return Promise.resolve(); }
  protected publishAccepted(name: string, payload: unknown): Promise<void> { return this.publishEvent(name, payload).then(() => undefined); }
  protected publishPlatform(name: string, event: unknown): Promise<unknown> { this.emit(name, event); return Promise.resolve(); }

  constructor(options: EmailEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('email', options.config.id);
    this.#options = options;
    this.#lifecycle = createEndpointLifecycle({ name: options.config.id, reconnect: { initialIntervalMs: options.config.imap.reconnectInterval, maxIntervalMs: 300_000, jitterMs: 0 } });
  }

  get smtp(): EmailSmtpTransport { if (!this.#smtp) throw new Error('SMTP transporter not connected'); return this.#smtp; }
  get imap(): EmailImapTransport { if (!this.#imap) throw new Error('IMAP client not connected'); return this.#imap; }
  verify(): Promise<unknown> { return this.smtp.verify(); }
  sendMail(options: unknown) { return this.smtp.sendMail(options); }

  protected async connectTransport(signal?: AbortSignal): Promise<void> {
    if (signal) { this.setExecutionSignal(signal); signal.throwIfAborted(); }
    await this.#lifecycle.start(async handle => {
      this.#started = true;
      let cancelled = false;
      const connectionOwner = {};
      let imap: EmailImapTransport | undefined;
      let smtp: EmailSmtpTransport | undefined;
      let rejectConnection: ((error: Error) => void) | undefined;
      const cleanup = () => {
        if (cancelled) return;
        cancelled = true;
        rejectConnection?.(new Error('Email connection stopped'));
        if (this.#imapOwner === connectionOwner) { this.#imap = null; this.#imapOwner = undefined; this.#checkOwner = undefined; }
        if (this.#smtp === smtp) this.#smtp = null;
        try { imap?.end(); } catch { /* best effort */ }
        try { smtp?.close(); } catch { /* best effort */ }
      };
      handle.onForceClose(cleanup);
      try {
        smtp = await (this.#options.createSmtp?.(this.#options.config.smtp) ?? defaultCreateSmtp(this.#options.config.smtp));
        if (cancelled) { smtp.close(); return; }
        this.#smtp = smtp;
        await smtp.verify();
        if (cancelled) { smtp.close(); return; }
        imap = this.#options.createImap?.(this.#options.config.imap) ?? defaultCreateImap(this.#options.config.imap);
        this.#imap = imap; this.#imapOwner = connectionOwner;
        const ownedImap = imap;
        let ready = false;
        await new Promise<void>((resolve, reject) => {
          rejectConnection = reject;
          ownedImap.on('ready', () => { if (cancelled || this.#imapOwner !== connectionOwner) return; ready = true; void this.#emitPlatformEvent('imap.ready', Object.freeze({})); resolve(); });
          ownedImap.on('mail', (count) => { if (!cancelled && this.#imapOwner === connectionOwner) { void this.#emitPlatformEvent('imap.mail', count); void this.#checkForNewEmails(); } });
          const disconnected = (error?: unknown) => {
            if (cancelled || this.#imapOwner !== connectionOwner) return;
            if (!ready) reject(error instanceof Error ? error : new Error('IMAP closed before ready'));
            cleanup(); handle.notifyClosed();
          };
          ownedImap.on('error', error => { if (!cancelled) void this.#emitPlatformEvent('imap.error', error); disconnected(error); });
          ownedImap.on('end', () => { if (!cancelled) void this.#emitPlatformEvent('imap.end', Object.freeze({})); disconnected(); });
          ownedImap.on('close', disconnected);
          ownedImap.connect();
        });
        if (!cancelled) { this.#startEmailCheck(); this.#logger.info(formatCompact({ op: 'connect', endpoint: this.#options.config.id, mode: 'smtp-imap' })); }
      } catch (error) { cleanup(); if (!cancelled || this.#lifecycle.started) throw error; }
    });
  }

  protected openInput(): void {
    this.#open = true;
    void this.#checkForNewEmails();
  }

  protected closeInput(): void {
    this.#open = false;
  }

  protected async disconnectTransport(): Promise<void> {
    this.#open = false;
    // 先复位 #started，避免 imap.end() 触发的 'end' 事件又武装重连定时器
    this.#started = false;
    await this.#lifecycle.stop();
    this.#checkOwner = undefined;
    this.#seenMail.clear();
    this.#pendingMail.clear();
    this.#mailboxValidity = undefined;
    if (this.#checkTimer) { clearInterval(this.#checkTimer); this.#checkTimer = null; }
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
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  protected async sendPayload({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const target = conversation.id;
    const mailOptions = formatOutboundMail(payload, {
      from: this.#options.config.smtp.auth.user,
      to: target,
    });
    try {
      const info = await this.sendMail(mailOptions);
      const messageId = requireSmtpAcceptance(info, target);
      this.#logger.debug(formatCompact({ op: 'email_send', messageId }));
      return messageId;
    } catch (error) {
      const failure = smtpDeliveryError(error);
      this.#logger.warn(formatCompact({ op: 'smtp_delivery_failed', code: failure.code, disposition: failure.disposition }));
      throw failure;
    }
  }

  /** Test / internal: admit a parsed mail when the endpoint is open. */
  admit(email: EmailMessage): void {
    if (!this.#open) return;
    const owner = this.#imapOwner;
    void this.receiveInboundCallback(async () => {
      void this.#emitPlatformEvent('mail', email);
      await this.#admitWithAttachments(email, () => this.inboundReceiptCurrent(() => this.#started && this.#imapOwner === owner));
    }).catch((err) => {
      this.#logger.warn(formatCompact({ op: 'email_gateway_receive_failed', target: email.from,
        error: err instanceof Error ? err.message : String(err) }));
    });
  }

  /** A standalone Client still requires local ingress; a framework receipt owns its accepted continuation. */
  protected inboundReceiptCurrent(current: () => boolean): boolean { return this.#open && current(); }

  async #admitWithAttachments(email: EmailMessage, current: () => boolean = () => this.#open, nativeEvent: unknown = email): Promise<void> {
    const savedAttachments = await this.#awaitInbound(this.#downloadAttachments(email));
    if (!current()) return;
    const content = formatInboundContent(email);
    const sender = email.from;
    const conversation = emailInboundConversation(String(this.#options.id), email);
    await this.publishEvent('message.receive', {
      event: nativeEvent,
      conversation,
      ...(email.messageId ? { message: { conversation, id: email.messageId } } : {}),
      content,
      segments: formatInboundSegments(email, savedAttachments),
      sender: { id: sender, name: senderDisplayName(sender) || undefined },
      endpointId: this.#options.config.id,
      metadata: Object.freeze({
        subject: email.subject,
        to: email.to,
        cc: email.cc,
        uid: email.uid,
        date: email.date.toISOString(),
        ...(savedAttachments.length ? { attachments: savedAttachments } : {}),
      }),
    });
  }

  /**
   * attachments.enabled 时把入站附件落盘（恢复旧 downloadAttachment 行为，
   * 附加 maxFileSize / allowedTypes 过滤）；返回落盘结果供 admit segments/metadata 使用。
   */
  async #downloadAttachments(
    email: EmailMessage,
  ): Promise<SavedEmailAttachment[]> {
    const config = this.#options.config.attachments;
    if (!config?.enabled || email.attachments.length === 0) return [];
    await mkdir(config.downloadPath, { recursive: true });
    const downloadRoot = path.resolve(config.downloadPath);
    const saved: SavedEmailAttachment[] = [];
    for (const attachment of email.attachments) {
      this.executionSignal?.throwIfAborted();
      // 防路径穿越：发件人可构造 ../../ 等文件名，basename + resolve 后必须落在 downloadPath 内
      const rawName = attachment.filename || `attachment_${Date.now()}`;
      const filename = path.basename(rawName) || `attachment_${Date.now()}`;
      const filepath = path.resolve(downloadRoot, filename);
      if (filepath !== downloadRoot && !filepath.startsWith(downloadRoot + path.sep)) {
        this.#logger.warn(formatCompact({ op: 'email_attachment_skipped', filename: rawName, reason: 'path' }));
        continue;
      }
      if (config.allowedTypes?.length && !config.allowedTypes.includes(attachment.contentType ?? '')) {
        this.#logger.debug(formatCompact({ op: 'email_attachment_skipped', filename, reason: 'type' }));
        continue;
      }
      if (attachment.size != null && attachment.size > config.maxFileSize) {
        this.#logger.debug(formatCompact({ op: 'email_attachment_skipped', filename, reason: 'size' }));
        continue;
      }
      try {
        await writeFile(filepath, attachment.content, { signal: this.executionSignal });
        saved.push({ filename, path: filepath, contentType: attachment.contentType, size: attachment.size });
      } catch (error) {
        this.executionSignal?.throwIfAborted();
        this.#logger.warn(formatCompact({
          op: 'email_attachment_download_failed',
          filename,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    return saved;
  }

  async #emitPlatformEvent(name: string, event: unknown): Promise<void> {
    await this.publishPlatform(name, event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'email_platform_event_failed',
        event: name,
        error: error instanceof Error ? error.message : String(error),
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
    const imap = this.#imap; const connectionOwner = this.#imapOwner;
    if (!imap || !this.#started || !this.#open || this.#checkOwner) return;
    const owner = {}; this.#checkOwner = owner;
    const current = () => this.#imapOwner === connectionOwner && this.#imap === imap && this.#started && this.#open;
    const pending: Promise<void>[] = [];
    try {
      await new Promise<void>((resolve, reject) => {
        imap.openBox(this.#options.config.imap.mailbox, false, (error, box) => {
          if (error) return reject(error);
          if (!current()) return resolve();
          const validity = (box as { uidvalidity?: unknown } | undefined)?.uidvalidity;
          if (typeof validity === 'number' || typeof validity === 'string') {
            const identity = String(validity);
            if (this.#mailboxValidity !== identity) { this.#seenMail.clear(); this.#pendingMail.clear(); this.#mailboxValidity = identity; }
          }
          imap.search(['UNSEEN'], (searchError, results) => {
            if (searchError) return reject(searchError);
            if (!current() || !results.length) return resolve();
            const fetch = imap.fetch(results, { bodies: '', markSeen: this.#options.config.imap.markSeen });
            fetch.on('message', (msg) => {
              if (!current()) return;
              const continuation = () => this.inboundReceiptCurrent(() => this.#imapOwner === connectionOwner && this.#imap === imap && this.#started);
              pending.push(this.receiveInboundCallback(() => this.#handleImapMessage(msg, continuation, validity)).catch(error => {
                this.#logger.warn(formatCompact({ op: 'email_admission_failed', error: error instanceof Error ? error.message : String(error) }));
              }));
            });
            fetch.once('error', reject); fetch.once('end', () => resolve());
          });
        });
      });
      await Promise.all(pending);
    } catch (error) { this.#logger.warn(formatCompact({ op: 'email_check_failed', error: error instanceof Error ? error.message : String(error) })); }
    finally { if (this.#checkOwner === owner) this.#checkOwner = undefined; }
  }

  async #handleImapMessage(msg: EmailImapFetchMessage, current: () => boolean, validity: unknown): Promise<void> {
    // Resume decoding from this receipt's await chain, rather than starting it inside a foreign SDK callback.
    const source = await this.#awaitInbound(new Promise<{ body: string; uid: number }>(resolve => {
      let body = ''; let uid = 0;
      msg.on('body', stream => { stream.on('data', (chunk: Buffer | string) => { if (!this.executionSignal?.aborted) body += chunk.toString(); }); });
      msg.once('attributes', attrs => { uid = attrs.uid ?? 0; });
      msg.once('end', () => resolve({ body, uid }));
    }));
    const parsed = await this.#awaitInbound(simpleParser(source.body));
    if (!current()) return;
    const key = (typeof validity === 'number' || typeof validity === 'string') && source.uid > 0
      ? JSON.stringify([this.#options.config.imap.mailbox, String(validity), source.uid]) : undefined;
    const now = Date.now();
    for (const [id, time] of this.#seenMail) if (now - time > 24 * 60 * 60 * 1000) this.#seenMail.delete(id);
    if (key && this.#seenMail.has(key)) return;
    const email = parseEmailMessage(parsed, source.uid);
    const existing = key ? this.#pendingMail.get(key) : undefined;
    if (existing) return existing;
    if (key && this.#seenMail.size + this.#pendingMail.size >= 10_000) throw new Error('Email admission dedup capacity exhausted');
    void this.#emitPlatformEvent('mail', parsed);
    const admission = this.#admitWithAttachments(email, current, parsed);
    if (key) this.#pendingMail.set(key, admission);
    try { await admission; if (key && current()) this.#seenMail.set(key, Date.now()); }
    finally { if (key && this.#pendingMail.get(key) === admission) this.#pendingMail.delete(key); }
  }
}

export type EmailClientEventMap = Record<string, unknown>;
