/**
 * Email SMTP/IMAP helpers (no legacy Adapter/Endpoint / segment-mapper).
 * Canonicalization is owned by gateway/core before endpoint.send.
 */

import type { Attachment } from 'mailparser';
import { htmlToPlainTextWithBlockBreaks, isMediaRef, type MediaRef } from '@zhin.js/core';
import type { Segment } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('email');

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
  /** IMAP 断线重连基础间隔（指数退避基数），毫秒。 */
  readonly reconnectInterval?: number;
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
  readonly imap: Required<Pick<ImapConfig, 'checkInterval' | 'reconnectInterval' | 'mailbox' | 'markSeen'>> & ImapConfig;
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
      maxFileSize: Math.max(attachmentsSource.maxFileSize || 10 * 1024 * 1024, 1),
      allowedTypes: attachmentsSource.allowedTypes,
    }
    : undefined;
  return {
    context: 'email',
    name,
    smtp,
    imap: {
      ...imap,
      // 数值下限：0/负数会导致 setInterval(0) 风暴
      checkInterval: Math.max(imap.checkInterval ?? 60_000, 1_000),
      reconnectInterval: Math.max(imap.reconnectInterval ?? 5_000, 1_000),
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

/** 已落盘的入站附件（attachments.enabled 下载结果）。 */
export interface SavedEmailAttachment {
  readonly filename: string;
  readonly path: string;
  readonly contentType?: string;
  readonly size?: number;
}

/**
 * 入站邮件 → canonical Segment[]（与 formatInboundContent 纯文本视图同源双轨）。
 * 已落盘附件映射为 image/file 段，MediaRef kind=path 指向下载路径；
 * 未下载的附件（disabled / 被过滤）只保留 content 里的占位文本。
 */
export function formatInboundSegments(
  email: EmailMessage,
  savedAttachments: readonly SavedEmailAttachment[] = [],
): Segment[] {
  const out: Segment[] = [];
  const content = formatInboundContent(email);
  if (content) out.push({ type: 'text', data: { text: content } });
  for (const saved of savedAttachments) {
    const type = saved.contentType?.startsWith('image/') ? 'image' : 'file';
    out.push({
      type,
      data: {
        media: {
          kind: 'path',
          value: saved.path,
          ...(saved.contentType ? { mime_type: saved.contentType } : {}),
        },
        name: saved.filename,
        ...(type === 'image' ? { alt: saved.filename } : {}),
      },
    });
  }
  return out;
}

export function senderDisplayName(from: string): string {
  const name = from.split('<')[0]?.trim();
  return name || from;
}

/**
 * nodemailer 附件的最小形状：url/path 走 `path`（URL 由 nodemailer 拉流、
 * 本地路径读盘），base64 走 `content` + `encoding: 'base64'` 直发。
 */
export type EmailOutboundAttachment =
  | { filename: string; path: string }
  | { filename: string; content: string; encoding: 'base64' };

/**
 * image/audio/video/file 段 → nodemailer 附件（canonical MediaRef 唯一来源）：
 * - kind=url / path → attachment.path；
 * - kind=base64 → attachment.content（data: URL 前缀剥离）；
 * - kind=file（平台不透明引用）邮件无对应概念，丢弃留痕；
 * - 缺 media 同样 warn + 丢弃。
 */
function mediaSegmentToAttachment(
  type: string,
  data: Record<string, unknown>,
): EmailOutboundAttachment | null {
  const media = data.media;
  if (!isMediaRef(media)) {
    logger.warn(formatCompact({
      op: 'email_outbound_media_dropped',
      type,
      reason: 'missing_media_ref',
    }));
    return null;
  }
  if (media.kind === 'file') {
    logger.warn(formatCompact({
      op: 'email_outbound_media_dropped',
      type,
      reason: 'unsupported_kind',
      kind: media.kind,
    }));
    return null;
  }
  const filename = attachmentFileName(type, data, media);
  if (media.kind === 'base64') {
    const value = media.value.startsWith('data:')
      ? media.value.slice(media.value.indexOf(',') + 1)
      : media.value;
    return { filename, content: value, encoding: 'base64' };
  }
  return { filename, path: media.value };
}

function attachmentFileName(
  type: string,
  data: Record<string, unknown>,
  media: MediaRef,
): string {
  if (media.file_name) return media.file_name;
  if (typeof data.name === 'string' && data.name) return data.name;
  if (typeof data.alt === 'string' && data.alt) return data.alt;
  return type === 'image' ? 'image.png' : 'file';
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
  attachments?: EmailOutboundAttachment[];
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
  const attachments: EmailOutboundAttachment[] = [];

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
      case 'audio':
      case 'video':
      case 'file': {
        const attachment = mediaSegmentToAttachment(item.type, data);
        if (attachment) attachments.push(attachment);
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
