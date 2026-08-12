/**
 * Telegram Bot API protocol helpers — no legacy Adapter/Endpoint / segment-mapper.
 * Canonicalization is owned by gateway/core before endpoint.send.
 */

import type { IncomingMessage } from 'node:http';
import { isMediaRef } from '@zhin.js/core';
import type { Segment } from '@zhin.js/core/runtime';
import type { ConversationKind, ConversationRef } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';

const logger = getLogger('telegram');

/** Plugin Runtime owner config (`plugins.<instanceKey>` / schema.json). */
export interface TelegramAdapterConfig {
  readonly id?: string;
  readonly token?: string;
  /** Default true. `false` selects webhook mode (requires httpHostToken). */
  readonly polling?: boolean;
  readonly webhook?: {
    readonly domain?: string;
    readonly path?: string;
    readonly secretToken?: string;
  };
  readonly allowedUpdates?: readonly string[];
  readonly apiBaseUrl?: string;
  /** Transitional: legacy root `endpoints[]` with `context: telegram`. */
  readonly endpoints?: ReadonlyArray<Partial<ResolvedTelegramConfig> & {
    readonly context?: string;
    readonly polling?: boolean;
    readonly webhook?: TelegramAdapterConfig['webhook'];
    readonly allowedUpdates?: readonly string[];
    readonly apiBaseUrl?: string;
  }>;
}

export interface ResolvedTelegramConfig {
  readonly context: 'telegram';
  readonly id: string;
  readonly token: string;
  readonly mode: 'polling' | 'webhook';
  readonly allowedUpdates: readonly string[];
  readonly apiBaseUrl: string;
  readonly webhook?: {
    readonly domain: string;
    readonly path: string;
    readonly secretToken?: string;
  };
}

export interface TelegramUser {
  readonly id: number;
  readonly is_bot?: boolean;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly username?: string;
}

export interface TelegramChat {
  readonly id: number;
  readonly type: 'private' | 'group' | 'supergroup' | 'channel';
  readonly title?: string;
  readonly username?: string;
}

export interface TelegramMessageEntity {
  readonly type: string;
  readonly offset: number;
  readonly length: number;
  readonly url?: string;
  readonly user?: TelegramUser;
}

export interface TelegramPhotoSize {
  readonly file_id: string;
  readonly file_unique_id?: string;
  readonly width?: number;
  readonly height?: number;
  readonly file_size?: number;
}

export interface TelegramMessage {
  readonly message_id: number;
  readonly date: number;
  readonly chat: TelegramChat;
  readonly from?: TelegramUser;
  readonly text?: string;
  readonly caption?: string;
  readonly entities?: readonly TelegramMessageEntity[];
  readonly reply_to_message?: TelegramMessage;
  readonly photo?: readonly TelegramPhotoSize[];
  readonly video?: {
    readonly file_id: string;
    readonly file_unique_id?: string;
    readonly width?: number;
    readonly height?: number;
    readonly duration?: number;
    readonly file_size?: number;
  };
  readonly audio?: {
    readonly file_id: string;
    readonly file_unique_id?: string;
    readonly duration?: number;
    readonly performer?: string;
    readonly title?: string;
    readonly file_size?: number;
  };
  readonly voice?: {
    readonly file_id: string;
    readonly file_unique_id?: string;
    readonly duration?: number;
    readonly file_size?: number;
  };
  readonly document?: {
    readonly file_id: string;
    readonly file_unique_id?: string;
    readonly file_name?: string;
    readonly mime_type?: string;
    readonly file_size?: number;
  };
  readonly sticker?: {
    readonly file_id: string;
    readonly file_unique_id?: string;
    readonly width?: number;
    readonly height?: number;
    readonly is_animated?: boolean;
    readonly is_video?: boolean;
    readonly emoji?: string;
  };
  readonly location?: {
    readonly longitude: number;
    readonly latitude: number;
  };
}

export interface TelegramCallbackQuery {
  readonly id: string;
  readonly from: TelegramUser;
  readonly data?: string;
  readonly message?: TelegramMessage;
}

export interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: TelegramMessage;
  readonly edited_message?: TelegramMessage;
  readonly callback_query?: TelegramCallbackQuery;
}

export interface TelegramChatMember {
  readonly status: string;
  readonly user: TelegramUser;
  readonly can_restrict_members?: boolean;
  readonly can_pin_messages?: boolean;
  readonly can_delete_messages?: boolean;
  readonly can_manage_chat?: boolean;
}

export interface TelegramWireSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface TelegramInlineButton {
  readonly text: string;
  readonly callback_data: string;
}

export type TelegramOutboundAction =
  | {
    readonly method: 'sendMessage';
    readonly params: {
      readonly chat_id: number | string;
      readonly text: string;
      readonly reply_parameters?: { readonly message_id: number };
      readonly reply_markup?: { readonly inline_keyboard: TelegramInlineButton[][] };
    };
  }
  | {
    readonly method: 'sendPhoto';
    readonly params: {
      readonly chat_id: number | string;
      readonly photo: string;
      readonly caption?: string;
      readonly reply_parameters?: { readonly message_id: number };
    };
  }
  | {
    readonly method: 'sendVideo';
    readonly params: {
      readonly chat_id: number | string;
      readonly video: string;
      readonly caption?: string;
      readonly reply_parameters?: { readonly message_id: number };
    };
  }
  | {
    readonly method: 'sendAudio';
    readonly params: {
      readonly chat_id: number | string;
      readonly audio: string;
      readonly caption?: string;
      readonly reply_parameters?: { readonly message_id: number };
    };
  }
  | {
    readonly method: 'sendVoice';
    readonly params: {
      readonly chat_id: number | string;
      readonly voice: string;
      readonly caption?: string;
      readonly reply_parameters?: { readonly message_id: number };
    };
  }
  | {
    readonly method: 'sendDocument';
    readonly params: {
      readonly chat_id: number | string;
      readonly document: string;
      readonly caption?: string;
      readonly reply_parameters?: { readonly message_id: number };
    };
  }
  | {
    readonly method: 'sendSticker';
    readonly params: {
      readonly chat_id: number | string;
      readonly sticker: string;
      readonly reply_parameters?: { readonly message_id: number };
    };
  }
  | {
    readonly method: 'sendLocation';
    readonly params: {
      readonly chat_id: number | string;
      readonly latitude: number;
      readonly longitude: number;
      readonly reply_parameters?: { readonly message_id: number };
    };
  };

export function resolveTelegramConfig(config: TelegramAdapterConfig = {}): ResolvedTelegramConfig {
  const entry = config.endpoints?.find((item) => item.context === 'telegram');
  const token = config.token
    ?? entry?.token
    ?? process.env.TELEGRAM_TOKEN
    ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new TypeError(
      'Telegram adapter requires token (plugins.<key>.token or endpoints with context: telegram)',
    );
  }
  const id = (typeof config.id === 'string' && config.id)
    || (typeof entry?.id === 'string' && entry.id)
    || process.env.TELEGRAM_BOT_NAME
    || 'telegram-bot';
  const polling = config.polling ?? entry?.polling;
  const webhookSource = config.webhook ?? entry?.webhook;
  // Match legacy: polling defaults true; webhook only when polling === false.
  const mode: 'polling' | 'webhook' = polling === false ? 'webhook' : 'polling';
  const apiBaseUrl = (
    config.apiBaseUrl
    ?? entry?.apiBaseUrl
    ?? 'https://api.telegram.org'
  ).replace(/\/$/, '');
  const allowedUpdates = config.allowedUpdates
    ?? entry?.allowedUpdates
    ?? ['message', 'callback_query'];
  const webhook = mode === 'webhook'
    ? {
      domain: webhookSource?.domain ?? '',
      path: normalizeWebhookPath(webhookSource?.path ?? '/telegram/webhook'),
      secretToken: webhookSource?.secretToken
        ?? process.env.TELEGRAM_WEBHOOK_SECRET
        ?? undefined,
    }
    : undefined;
  return {
    context: 'telegram',
    id,
    token,
    mode,
    allowedUpdates: [...allowedUpdates],
    apiBaseUrl,
    webhook,
  };
}

export function normalizeWebhookPath(path: string): string {
  const trimmed = path.trim() || '/telegram/webhook';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function buildWebhookUrl(webhook: NonNullable<ResolvedTelegramConfig['webhook']>): string {
  const domain = webhook.domain.replace(/\/$/, '');
  if (!domain) {
    throw new TypeError('Telegram webhook mode requires webhook.domain');
  }
  return `${domain}${webhook.path}`;
}

export async function readTextBody(
  request: IncomingMessage,
  options: { readonly limit?: number } = {},
): Promise<string> {
  const limit = options.limit ?? 1_048_576;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      request.destroy();
      throw new Error(`Request body exceeds ${limit} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function botApiUrl(config: Pick<ResolvedTelegramConfig, 'apiBaseUrl' | 'token'>, method: string): string {
  return `${config.apiBaseUrl}/bot${config.token}/${method}`;
}

/** Telegram chat.type → canonical 会话 kind（supergroup 即 group，无容器层级故无 parent）。 */
export function resolveTelegramChannelType(
  chatType: TelegramChat['type'],
): ConversationKind {
  if (chatType === 'private') return 'private';
  if (chatType === 'channel') return 'channel';
  return 'group';
}

/**
 * 入站归一化 → ConversationRef：Telegram 无 guild/群组容器层级，
 * kind 直取 chat.type（private/group/supergroup/channel），无 parent。
 */
export function telegramInboundConversation(
  endpointKey: string,
  chat: Pick<TelegramChat, 'id' | 'type'>,
): ConversationRef {
  return {
    endpoint: { id: endpointKey, adapter: endpointKey.split('\0')[0] ?? endpointKey },
    kind: resolveTelegramChannelType(chat.type),
    id: String(chat.id),
  };
}

export function senderDisplayName(user?: TelegramUser): string {
  if (!user) return 'Unknown';
  return user.username || user.first_name || String(user.id);
}

/** Build inbound text for MessageGateway.receive. */
export function formatInboundContent(msg: TelegramMessage): string {
  if (msg.text) return msg.text;
  if (msg.caption) return msg.caption;
  if (msg.photo?.length) return '[image]';
  if (msg.video) return '[video]';
  if (msg.audio) return '[audio]';
  if (msg.voice) return '[voice]';
  if (msg.document) {
    return msg.document.file_name ? `[file: ${msg.document.file_name}]` : '[file]';
  }
  if (msg.sticker) {
    return msg.sticker.emoji ? `[sticker: ${msg.sticker.emoji}]` : '[sticker]';
  }
  if (msg.location) {
    return `[location: ${msg.location.latitude},${msg.location.longitude}]`;
  }
  return '';
}

export function formatCallbackContent(query: TelegramCallbackQuery): string {
  return query.data ? `[action: ${query.data}]` : '[action]';
}

/**
 * 入站消息 → canonical Segment[]（与 formatInboundContent 纯文本视图同源双轨）。
 * Telegram 附件只有不透明 file_id（需 getFile 二次解析，非 URL），
 * 统一进 MediaRef kind=file；photo 取数组末尾（最大尺寸）。
 */
export function formatInboundSegments(msg: TelegramMessage): Segment[] {
  const out: Segment[] = [];
  if (msg.reply_to_message) {
    out.push({
      type: 'reply',
      data: { message_id: String(msg.reply_to_message.message_id) },
    });
  }
  const text = msg.text ?? msg.caption;
  if (text) out.push({ type: 'text', data: { text } });
  if (msg.photo?.length) {
    const largest = msg.photo[msg.photo.length - 1]!;
    out.push({
      type: 'image',
      data: { media: { kind: 'file', value: largest.file_id } },
    });
  }
  if (msg.video) {
    out.push({
      type: 'video',
      data: { media: { kind: 'file', value: msg.video.file_id } },
    });
  }
  if (msg.audio) {
    out.push({
      type: 'audio',
      data: {
        media: { kind: 'file', value: msg.audio.file_id },
        ...(msg.audio.title ? { name: msg.audio.title } : {}),
      },
    });
  }
  if (msg.voice) {
    out.push({
      type: 'voice',
      data: { media: { kind: 'file', value: msg.voice.file_id } },
    });
  }
  if (msg.document) {
    out.push({
      type: 'file',
      data: {
        media: {
          kind: 'file',
          value: msg.document.file_id,
          ...(msg.document.mime_type ? { mime_type: msg.document.mime_type } : {}),
        },
        ...(msg.document.file_name ? { name: msg.document.file_name } : {}),
      },
    });
  }
  if (msg.sticker) {
    out.push({
      type: 'image',
      data: {
        media: { kind: 'file', value: msg.sticker.file_id },
        ...(msg.sticker.emoji ? { alt: msg.sticker.emoji } : {}),
      },
    });
  }
  return out;
}

/**
 * callback_query → action 段（Wave 1 C interactive 约定：
 * {type:'action', data:{id, payload, sourceMessageId?}}），
 * 与 formatCallbackContent / metadata.payload 同源。
 */
export function formatCallbackSegments(query: TelegramCallbackQuery): Segment[] {
  return [{
    type: 'action',
    data: {
      id: query.id,
      payload: query.data ?? '',
      ...(query.message ? { sourceMessageId: String(query.message.message_id) } : {}),
    },
  }];
}

/**
 * 出站待上传媒体（base64 / 本地路径 MediaRef 物化为 multipart 附件）。
 * params 里以 `attach://<attachName>` 占位，endpoint 发送时替换为文件 part。
 */
export interface TelegramOutboundUpload {
  readonly attachName: string;
  readonly filename: string;
  readonly source:
    | { readonly kind: 'base64'; readonly data: string }
    | { readonly kind: 'path'; readonly path: string };
  readonly mimeType?: string;
}

export interface TelegramOutboundPlan {
  readonly actions: TelegramOutboundAction[];
  readonly uploads: readonly TelegramOutboundUpload[];
}

/**
 * Wire-encode an already-rendered outbound payload into Telegram Bot API actions.
 * Segment canonicalization is intentionally not done here.
 */
export function formatOutboundActions(
  target: string | number,
  payload: unknown,
): TelegramOutboundAction[] {
  return formatOutboundPlan(target, payload).actions;
}

/**
 * formatOutboundActions 的上传感知变体：canonical MediaRef kind=base64/path
 * 的媒体段产出 `attach://` 占位 + uploads 清单（endpoint 走 multipart 表单上传）；
 * kind=url/file 保持字符串直发（file 即 Telegram file_id 不透明引用）。
 */
export function formatOutboundPlan(
  target: string | number,
  payload: unknown,
): TelegramOutboundPlan {
  const uploads: TelegramOutboundUpload[] = [];
  return { actions: buildOutboundActions(target, payload, uploads), uploads };
}

function buildOutboundActions(
  target: string | number,
  payload: unknown,
  uploads: TelegramOutboundUpload[],
): TelegramOutboundAction[] {
  const chatId = typeof target === 'number' ? target : (/^-?\d+$/.test(target) ? Number(target) : target);
  if (typeof payload === 'string') {
    const text = payload.trim();
    if (!text) throw new Error('No Telegram content to send');
    return [{ method: 'sendMessage', params: { chat_id: chatId, text } }];
  }

  const items: Array<string | TelegramWireSegment> = Array.isArray(payload)
    ? payload as Array<string | TelegramWireSegment>
    : payload && typeof payload === 'object' && 'type' in (payload as object)
      ? [payload as TelegramWireSegment]
      : [];

  if (items.length === 0) {
    const text = payload == null
      ? ''
      : typeof payload === 'object'
        ? JSON.stringify(payload)
        : String(payload);
    if (!text.trim()) throw new Error('No Telegram content to send');
    return [{ method: 'sendMessage', params: { chat_id: chatId, text: text.trim() } }];
  }

  let textContent = '';
  let replyTo: number | undefined;
  let keyboard: TelegramInlineButton[][] | undefined;
  const actions: TelegramOutboundAction[] = [];

  const replyParams = (): { reply_parameters?: { message_id: number } } => (
    replyTo != null ? { reply_parameters: { message_id: replyTo } } : {}
  );

  /**
   * 媒体来源归一：唯一来源是 canonical `data.media` MediaRef。
   * kind=url/file → 字符串直发（file 即 Telegram file_id 不透明引用）；
   * kind=base64/path → attach:// 占位并登记上传。
   * 无 MediaRef 时 warn + 丢弃（返回 undefined）。
   */
  const mediaSource = (segType: string, data: Record<string, unknown>, defaultName: string): string | undefined => {
    const media = isMediaRef(data.media) ? data.media : undefined;
    if (!media) {
      logger.warn(formatCompact({
        op: 'telegram_outbound_media_dropped',
        type: segType,
        reason: 'missing_media_ref',
      }));
      return undefined;
    }
    if (media.kind === 'file' || media.kind === 'url') return media.value;
    const named = data.name ?? data.filename;
    let filename = typeof named === 'string' && named ? named : undefined;
    if (!filename && media.kind === 'path') {
      const raw = media.value.startsWith('file://') ? media.value.slice('file://'.length) : media.value;
      filename = raw.split(/[\\/]/).filter(Boolean).pop();
    }
    const attachName = `attach${uploads.length}`;
    uploads.push({
      attachName,
      filename: filename ?? defaultName,
      source: media.kind === 'base64'
        ? {
          kind: 'base64',
          data: media.value.startsWith('base64://')
            ? media.value.slice('base64://'.length)
            : media.value,
        }
        : {
          kind: 'path',
          path: media.value.startsWith('file://') ? media.value.slice('file://'.length) : media.value,
        },
      ...(media.mime_type ? { mimeType: media.mime_type } : {}),
    });
    return `attach://${attachName}`;
  };

  for (const item of items) {
    if (typeof item === 'string') {
      textContent += item;
      continue;
    }
    const data = item.data ?? {};
    switch (item.type) {
      case 'text':
        textContent += String(data.text ?? data.content ?? '');
        break;
      case 'at':
        if (data.id) textContent += `@${String(data.name || data.id)}`;
        break;
      case 'reply': {
        const id = Number(data.id ?? data.message_id);
        if (Number.isFinite(id)) replyTo = id;
        break;
      }
      case 'keyboard': {
        const rows = Array.isArray(data.rows) ? data.rows : [];
        keyboard = rows.map((row) => {
          const buttons = Array.isArray(row) ? row : [];
          return buttons.map((btn) => {
            const record = btn && typeof btn === 'object'
              ? btn as { label?: string; text?: string; payload?: string; callback_data?: string }
              : {};
            return {
              text: String(record.label ?? record.text ?? ''),
              callback_data: String(record.payload ?? record.callback_data ?? '').slice(0, 64),
            };
          });
        });
        break;
      }
      case 'image': {
        const photo = mediaSource('image', data, 'image.png');
        if (photo) {
          actions.push({
            method: 'sendPhoto',
            params: {
              chat_id: chatId,
              photo,
              caption: textContent.trim() || undefined,
              ...replyParams(),
            },
          });
          textContent = '';
        }
        break;
      }
      case 'video': {
        const video = mediaSource('video', data, 'video.mp4');
        if (video) {
          actions.push({
            method: 'sendVideo',
            params: {
              chat_id: chatId,
              video,
              caption: textContent.trim() || undefined,
              ...replyParams(),
            },
          });
          textContent = '';
        }
        break;
      }
      case 'audio': {
        const audio = mediaSource('audio', data, 'audio.mp3');
        if (audio) {
          actions.push({
            method: 'sendAudio',
            params: {
              chat_id: chatId,
              audio,
              caption: textContent.trim() || undefined,
              ...replyParams(),
            },
          });
          textContent = '';
        }
        break;
      }
      case 'voice': {
        const voice = mediaSource('voice', data, 'voice.ogg');
        if (voice) {
          actions.push({
            method: 'sendVoice',
            params: {
              chat_id: chatId,
              voice,
              caption: textContent.trim() || undefined,
              ...replyParams(),
            },
          });
          textContent = '';
        }
        break;
      }
      case 'file': {
        const document = mediaSource('file', data, 'file');
        if (document) {
          actions.push({
            method: 'sendDocument',
            params: {
              chat_id: chatId,
              document,
              caption: textContent.trim() || undefined,
              ...replyParams(),
            },
          });
          textContent = '';
        }
        break;
      }
      case 'sticker': {
        const sticker = mediaSource('sticker', data, 'sticker.webp');
        if (sticker) {
          actions.push({
            method: 'sendSticker',
            params: { chat_id: chatId, sticker, ...replyParams() },
          });
        }
        break;
      }
      case 'location': {
        actions.push({
          method: 'sendLocation',
          params: {
            chat_id: chatId,
            latitude: Number(data.latitude ?? 0),
            longitude: Number(data.longitude ?? 0),
            ...replyParams(),
          },
        });
        break;
      }
      default:
        textContent += String(data.text ?? `[${item.type}]`);
    }
  }

  if (actions.length === 0) {
    const text = textContent.trim() || (keyboard ? ' ' : '');
    if (!text && !keyboard) throw new Error('No Telegram content to send');
    return [{
      method: 'sendMessage',
      params: {
        chat_id: chatId,
        text: text || ' ',
        ...replyParams(),
        ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      },
    }];
  }

  if (textContent.trim() || keyboard) {
    actions.unshift({
      method: 'sendMessage',
      params: {
        chat_id: chatId,
        text: textContent.trim() || ' ',
        ...replyParams(),
        ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      },
    });
  }

  return actions;
}
