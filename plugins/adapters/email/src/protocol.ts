/**
 * Email SMTP/IMAP helpers (no legacy Adapter/Endpoint / segment-mapper).
 * Canonicalization is owned by gateway/core before endpoint.send.
 */

import type { Attachment } from 'mailparser';
import { htmlToPlainTextWithBlockBreaks } from '@zhin.js/core';

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly auth: {
    readonly user: string;
    readonly pass: string;
  };
}

export interface ImapConfig {
  readonly host: string;
  readonly port: number;
  readonly tls: boolean;
  readonly user: string;
  readonly password: string;
  readonly checkInterval?: number;
  readonly mailbox?: string;
  readonly markSeen?: boolean;
}

export interface EmailAttachmentsConfig {
  readonly enabled: boolean;
  readonly downloadPath?: string;
  readonly maxFileSize?: number;
  readonly allowedTypes?: readonly string[];
}

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface EmailAdapterConfig {
  readonly name?: string;
  readonly smtp?: SmtpConfig;
  readonly imap?: ImapConfig;
  readonly attachments?: EmailAttachmentsConfig;
  /** Transitional: legacy root `endpoints[]` with `context: email`. */
  readonly endpoints?: ReadonlyArray<Partial<ResolvedEmailConfig> & {
    readonly context?: string;
  }>;
}

export interface ResolvedEmailConfig {
  readonly context: 'email';
  readonly name: string;
  readonly smtp: SmtpConfig;
  readonly imap: Required<Pick<ImapConfig, 'checkInterval' | 'mailbox' | 'markSeen'>> & ImapConfig;
  readonly attachments?: {
    readonly enabled: boolean;
    readonly downloadPath: string;
    readonly maxFileSize: number;
    readonly allowedTypes?: readonly string[];
  };
}

export interface EmailMessage {
  readonly messageId: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly cc?: readonly string[];
  readonly bcc?: readonly string[];
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly attachments: readonly Attachment[];
  readonly date: Date;
  readonly uid: number;
}

export interface EmailWireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export function resolveEmailConfig(config: EmailAdapterConfig = {}): ResolvedEmailConfig {
  const entry = config.endpoints?.find((item) => item.context === 'email');
  const smtp = config.smtp ?? entry?.smtp;
  const imap = config.imap ?? entry?.imap;
  if (!smtp?.host || !smtp.auth?.user || !imap?.host || !imap.user) {
    throw new TypeError(
      'Email adapter requires smtp + imap config (plugins.<key>.smtp/imap or endpoints with context: email)',
    );
  }
  const name = (typeof config.name === 'string' && config.name)
    || (typeof entry?.name === 'string' && entry.name)
    || process.env.EMAIL_BOT_NAME
    || 'email-bot';
  const attachmentsSource = config.attachments ?? entry?.attachments;
  const attachments = attachmentsSource?.enabled
    ? {
      enabled: true as const,
      downloadPath: attachmentsSource.downloadPath || './downloads/email',
      maxFileSize: attachmentsSource.maxFileSize || 10 * 1024 * 1024,
      allowedTypes: attachmentsSource.allowedTypes,
    }
    : undefined;
  return {
    context: 'email',
    name,
    smtp,
    imap: {
      ...imap,
      checkInterval: imap.checkInterval ?? 60_000,
      mailbox: imap.mailbox ?? 'INBOX',
      markSeen: imap.markSeen !== false,
    },
    attachments,
  };
}

export function htmlToText(html: string): string {
  return htmlToPlainTextWithBlockBreaks(html);
}

export function addressListText(addr: unknown): string[] {
  if (!addr) return [];
  if (Array.isArray(addr)) {
    return addr.map((item) => addressText(item));
  }
  return [addressText(addr)];
}

function addressText(addr: unknown): string {
  if (!addr || typeof addr !== 'object') return String(addr ?? '');
  const record = addr as { text?: string; address?: string };
  return record.text || record.address || String(addr);
}

export function parseEmailMessage(
  parsed: {
    messageId?: string;
    from?: unknown;
    to?: unknown;
    cc?: unknown;
    bcc?: unknown;
    subject?: string;
    text?: string;
    html?: string | false;
    attachments?: Attachment[];
    date?: Date;
  },
  uid: number,
): EmailMessage {
  return {
    messageId: parsed.messageId || '',
    from: parsed.from ? addressListText(parsed.from)[0] || '' : '',
    to: addressListText(parsed.to),
    cc: addressListText(parsed.cc),
    bcc: addressListText(parsed.bcc),
    subject: parsed.subject || '',
    text: parsed.text || '',
    html: parsed.html ? String(parsed.html) : '',
    attachments: parsed.attachments || [],
    date: parsed.date || new Date(),
    uid,
  };
}

/** Build inbound text for MessageGateway.receive (gateway owns reply routing). */
export function formatInboundContent(email: EmailMessage): string {
  const parts: string[] = [];
  if (email.subject) parts.push(`Subject: ${email.subject}`, '');
  if (email.text) {
    parts.push(email.text);
  } else if (email.html) {
    const fromHtml = htmlToText(email.html);
    if (fromHtml) parts.push(fromHtml);
  }
  for (const attachment of email.attachments) {
    const kind = attachment.contentType?.startsWith('image/') ? 'image' : 'file';
    const name = attachment.filename || 'attachment';
    parts.push(`[${kind}: ${name}]`);
  }
  const text = parts.join('\n').trim();
  return text || '(Empty email)';
}

export function senderDisplayName(from: string): string {
  const name = from.split('<')[0]?.trim();
  return name || from;
}

/**
 * Wire-encode an already-rendered outbound payload into nodemailer options.
 * Segment canonicalization is intentionally not done here.
 */
export function formatOutboundMail(
  payload: unknown,
  options: { readonly from: string; readonly to: string; readonly subject?: string },
): {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{ filename: string; path: string }>;
} {
  const mail = {
    from: options.from,
    to: options.to,
    subject: options.subject ?? 'Message from Bot',
  };

  if (typeof payload === 'string') {
    return { ...mail, text: payload };
  }

  const segments: Array<string | EmailWireSegment> = Array.isArray(payload)
    ? payload as Array<string | EmailWireSegment>
    : payload && typeof payload === 'object' && 'type' in (payload as object)
      ? [payload as EmailWireSegment]
      : [];

  if (segments.length === 0) {
    return {
      ...mail,
      text: payload == null ? '' : typeof payload === 'object'
        ? JSON.stringify(payload)
        : String(payload),
    };
  }

  const textParts: string[] = [];
  const htmlParts: string[] = [];
  const attachments: Array<{ filename: string; path: string }> = [];

  for (const item of segments) {
    if (typeof item === 'string') {
      textParts.push(item);
      htmlParts.push(item.replace(/\n/g, '<br>'));
      continue;
    }
    const data = item.data ?? {};
    switch (item.type) {
      case 'text': {
        const textContent = String(data.text ?? data.content ?? '');
        textParts.push(textContent);
        htmlParts.push(textContent.replace(/\n/g, '<br>'));
        break;
      }
      case 'image':
      case 'file': {
        if (typeof data.url === 'string' && data.url) {
          attachments.push({
            filename: String(data.filename || (item.type === 'image' ? 'image.png' : 'file')),
            path: data.url,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    ...mail,
    ...(textParts.length > 0
      ? { text: textParts.join('\n'), html: htmlParts.join('<br>') }
      : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}
