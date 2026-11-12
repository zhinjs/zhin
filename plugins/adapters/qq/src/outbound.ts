/**
 * QQ 官方出站富媒体归一化：把渲染后的 payload 转为 qq-official-bot 可识别的
 * Sendable 结构（文本串 + 消息段）。移植自 legacy 版 outbound-media /
 * outbound-markdown / outbound-keyboard。
 *
 * 移植面：
 * - image：http(s) URL 直发（data.url）；base64://、data:...;base64、本地路径
 *   归一到 data.file，由 SDK formatMediaData 走媒体上传（v2 /files）。
 * - markdown：data.content 原文，或 custom_template_id + params 模板。
 * - keyboard：data.rows 按钮矩阵展开为 button 段（SDK processButtons 组装
 *   keyboard 载荷）；按钮消息必须带 markdown，且一条消息只承载一个 markdown、
 *   msg_type=2 时 content 不展示，故含按钮或内联 markdown 时文本与内联 markdown
 *   段按顺序合并为同一 markdown 段（模板 markdown 原样透传）。
 *   data.id 模板键盘原样透传。
 * - card：群聊/单聊图文卡片（msg_type=8，type=tuwen）。一条消息只能有这一张卡片，
 *   可附带 reply。字段和长度见 qq-v2.ts。
 * - mention / at：`target` 或 `user_id` 为 `all` 时编码成 `<qqbot-at-everyone />`。
 *   与 markdown 同条时写进 markdown.content（官方要求带 markdown 时 content 必须为空）；
 *   纯文本时交给 SDK 的 at 段写入 content。
 * canonical share 只有四字段都齐、且不是音乐分享时，才转成同一张图文卡片；
 * 缺字段仍 not_sent，避免静默丢掉标题、描述或 URL。
 * 其他未识别段保持既有 data.text fallback；正常发送另受声明的 supported 白名单约束。
 */
import { formatCompact, getLogger } from '@zhin.js/logger';
import { EndpointDeliveryError, isMediaRef } from '@zhin.js/im-contract';
import type { QqWireSegment } from './protocol.js';
import { probeImageSize, type QqImageSize } from './image-size.js';
import { QQ_AT_EVERYONE, parseQqTuwenContent, qqAtUserMarkup, type QqTuwenContent } from './qq-v2.js';

export { QQ_AT_EVERYONE };

const logger = getLogger('qq');

/** qq-official-bot Sendable 的最小结构子集（字符串模板或消息段）。 */
export interface QqOutboundElem {
  readonly type: string;
  readonly data: Record<string, unknown>;
}

export type QqOutboundMessage = string | QqOutboundElem | readonly (string | QqOutboundElem)[];

interface QqOutboundButtonSpec {
  readonly id?: string;
  readonly label?: string;
  readonly payload?: string;
  readonly url?: string;
  readonly disabled?: boolean;
  readonly style?: 'primary' | 'danger' | 'secondary';
  readonly mode?: string;
  readonly command?: { readonly enter?: boolean; readonly reply?: boolean };
}

/**
 * 解析 image/audio/video/file 段的投递源（canonical MediaRef 唯一来源）：
 * - kind=url → data.url 直发；
 * - kind=base64 / path / file → data.file，由 SDK formatMediaData 走媒体上传（v2 /files）。
 */
export function resolveMediaFile(data: Record<string, unknown>): string | undefined {
  const media = data.media;
  if (!isMediaRef(media)) return undefined;
  if (media.kind === 'url') return undefined;
  if (media.kind === 'base64') {
    return media.value.startsWith('base64://') ? media.value : `base64://${media.value}`;
  }
  return media.value;
}

function normalizeMediaSegment(seg: QqWireSegment): QqOutboundElem | null {
  const media = (seg.data ?? {}).media;
  if (!isMediaRef(media)) {
    // 无 canonical 媒体引用：无法投递，降级留痕
    logger.warn(formatCompact({
      op: 'qq_outbound_media_dropped',
      type: seg.type,
      reason: 'missing_media_ref',
    }));
    return null;
  }
  if (media.kind === 'url') {
    return { type: seg.type, data: { url: media.value } };
  }
  const file = resolveMediaFile(seg.data ?? {});
  if (!file) {
    logger.warn(formatCompact({
      op: 'qq_outbound_media_dropped',
      type: seg.type,
      reason: 'missing_source',
    }));
    return null;
  }
  return { type: seg.type, data: { file } };
}

function markdownTemplateId(data: Record<string, unknown>): string | undefined {
  return typeof data.custom_template_id === 'string' && data.custom_template_id
    ? data.custom_template_id
    : typeof data.template_id === 'string' && data.template_id
      ? data.template_id
      : undefined;
}

function normalizeMarkdownSegment(seg: QqWireSegment): QqOutboundElem | null {
  const data = seg.data ?? {};
  const templateId = markdownTemplateId(data);
  if (templateId) {
    return {
      type: 'markdown',
      data: {
        custom_template_id: templateId,
        params: Array.isArray(data.params) ? data.params : [],
      },
    };
  }
  const content = String(data.content ?? data.text ?? '');
  if (!content.trim()) {
    logger.warn(formatCompact({ op: 'qq_outbound_markdown_dropped', reason: 'empty_content' }));
    return null;
  }
  return { type: 'markdown', data: { content } };
}

function coreButtonToQq(btn: QqOutboundButtonSpec): Record<string, unknown> {
  const isCommand = btn.mode === 'command';
  const action: Record<string, unknown> = {
    type: isCommand ? 2 : btn.url ? 0 : 1,
    permission: { type: 2 },
    data: btn.url ?? btn.payload ?? '',
    click_limit: btn.disabled ? 0 : 10,
    unsupport_tips: btn.disabled ? '该按钮不可用' : '',
  };
  if (isCommand) {
    if (btn.command?.enter != null) action.enter = btn.command.enter;
    if (btn.command?.reply != null) action.reply = btn.command.reply;
  }
  return {
    id: btn.id ?? '',
    render_data: {
      label: btn.label ?? '',
      visited_label: btn.label ?? '',
      style: btn.style === 'primary' ? 1 : btn.style === 'danger' ? 2 : 0,
    },
    action,
  };
}

/** keyboard 段 → 模板键盘（data.id）或 button 行段（data.rows） */
function expandKeyboardSegment(seg: QqWireSegment): QqOutboundElem[] {
  const data = seg.data ?? {};
  if (typeof data.id === 'string' && data.id) {
    return [{ type: 'keyboard', data: { id: data.id } }];
  }
  if (!Array.isArray(data.rows)) {
    logger.warn(formatCompact({ op: 'qq_outbound_keyboard_dropped', reason: 'missing_rows' }));
    return [];
  }
  const out: QqOutboundElem[] = [];
  for (const row of data.rows) {
    if (!Array.isArray(row)) continue;
    out.push({
      type: 'button',
      data: {
        buttons: row.map((btn) => coreButtonToQq((btn ?? {}) as QqOutboundButtonSpec)),
      },
    });
  }
  return out;
}

function mentionIdentity(type: string, data: Record<string, unknown>): { readonly all: true } | { readonly id: string } | undefined {
  const raw = type === 'mention' ? data.target : data.user_id ?? data.qq ?? data.id;
  if (raw == null || raw === '') return undefined;
  const id = String(raw);
  return id === 'all' ? { all: true } : { id };
}

/** 音乐分享和其他不完整 share 保持拒绝；四字段齐全的链接卡转成 tuwen。 */
function shareAsCard(seg: QqWireSegment): QqWireSegment {
  const data = seg.data ?? {};
  if (data.audio || data.platform || data.config || data.content) {
    throw new EndpointDeliveryError('unsupported_operation', 'QQ canonical share cards are not implemented', 'not_sent');
  }
  const title = data.title;
  const description = data.description;
  const url = data.url;
  const image = data.image;
  if (typeof title !== 'string' || !title || typeof description !== 'string' || !description
    || typeof url !== 'string' || !url || typeof image !== 'string' || !image) {
    throw new EndpointDeliveryError('unsupported_operation', 'QQ canonical share cards are not implemented', 'not_sent');
  }
  return { type: 'card', data: { type: 'tuwen', content: { title, description, url, pic_url: image } } };
}

function replyElem(data: Record<string, unknown>): QqOutboundElem | undefined {
  const id = data.message_id ?? data.id ?? data.event_id;
  if (id == null || id === '') return undefined;
  return {
    type: 'reply',
    data: data.event_id != null ? { event_id: String(data.event_id) } : { id: String(id) },
  };
}

/**
 * 图文卡片独占正文槽位。没有卡片时返回 undefined，调用方继续走原有编码。
 * 混入文本、markdown、媒体或第二张卡片时直接拒绝。
 */
function cardMessage(segments: readonly (string | QqWireSegment)[]): QqOutboundMessage | undefined {
  const prepared = segments.map(item => typeof item !== 'string' && item.type === 'share' ? shareAsCard(item) : item);
  if (!prepared.some(item => typeof item !== 'string' && item.type === 'card')) return undefined;
  const replies: QqOutboundElem[] = [];
  let content: QqTuwenContent | undefined;
  for (const item of prepared) {
    if (typeof item === 'string') {
      if (item.length > 0) throw new EndpointDeliveryError('unsupported_operation', 'QQ 图文卡片不能与其他正文放在同一条消息里', 'not_sent');
      continue;
    }
    if (item.type === 'reply') {
      const reply = replyElem(item.data ?? {});
      if (reply) replies.push(reply);
      continue;
    }
    if (item.type !== 'card') {
      throw new EndpointDeliveryError('unsupported_operation', 'QQ 图文卡片不能与其他正文放在同一条消息里', 'not_sent');
    }
    if (content) throw new EndpointDeliveryError('unsupported_operation', 'QQ 一条消息只能发送一张图文卡片', 'not_sent');
    content = parseQqTuwenContent(item.data);
  }
  if (!content) throw new EndpointDeliveryError('unsupported_operation', 'QQ 图文卡片缺少 content', 'not_sent');
  const card: QqOutboundElem = { type: 'card', data: { type: 'tuwen', content } };
  return replies.length > 0 ? [...replies, card] : card;
}

function toSegmentList(payload: unknown): Array<string | QqWireSegment> {
  if (Array.isArray(payload)) return payload as Array<string | QqWireSegment>;
  if (payload && typeof payload === 'object' && 'type' in payload) {
    return [payload as QqWireSegment];
  }
  return [];
}

function textFromUnknownSegment(seg: QqWireSegment): string {
  const data = seg.data ?? {};
  return data.text != null ? String(data.text) : '';
}

/**
 * 渲染后 payload → QQ Sendable。
 * 纯文本输入原样返回（与既有行为一致）；含富媒体段时返回段数组。
 */
export function formatOutbound(payload: unknown): QqOutboundMessage {
  if (typeof payload === 'string') return payload;

  const segments = toSegmentList(payload);
  const card = cardMessage(segments);
  if (card) return card;
  if (segments.length === 0) {
    return payload == null
      ? ''
      : typeof payload === 'object'
        ? JSON.stringify(payload)
        : String(payload);
  }

  // 一条 QQ 消息只有一个 markdown 字段（SDK handleMarkdown 后者覆盖前者），且 msg_type=2
  // 时 content 文本不展示。按钮消息必须携带 markdown；含内联 markdown 的消息同理：
  // 文本与内联 markdown 按顺序合并为同一 markdown 段（落在首次出现的位置），避免正文被丢弃。
  // 模板 markdown（custom_template_id）无法拼接，保持原样。
  const hasKeyboard = segments.some(
    (item) => typeof item !== 'string' && item.type === 'keyboard',
  );
  const hasInlineMarkdown = segments.some(
    (item) => typeof item !== 'string' && item.type === 'markdown' && !markdownTemplateId(item.data ?? {}),
  );
  const hasTemplateMarkdown = segments.some(
    (item) => typeof item !== 'string' && item.type === 'markdown' && markdownTemplateId(item.data ?? {}),
  );
  const hasMention = segments.some(
    (item) => typeof item !== 'string' && (item.type === 'mention' || item.type === 'at') && mentionIdentity(item.type, item.data ?? {}),
  );
  // 模板 markdown 没有 content。@ 不能写进 content，否则和 markdown 字段冲突。
  if (hasTemplateMarkdown && hasMention && !hasInlineMarkdown) {
    throw new EndpointDeliveryError('unsupported_operation', 'QQ 模板 markdown 没有 content，不能在同一条消息里 @', 'not_sent');
  }
  const mergeIntoMarkdown = hasKeyboard || hasInlineMarkdown;

  const parts: Array<string | QqOutboundElem> = [];
  let markdownSlot: { type: 'markdown'; data: { content: string } } | undefined;
  let lastPieceWasMarkdown = false;
  const appendMarkdown = (piece: string, isMarkdown: boolean): void => {
    if (!piece) return;
    if (!markdownSlot) {
      markdownSlot = { type: 'markdown', data: { content: '' } };
      parts.push(markdownSlot);
    }
    const current = markdownSlot.data.content;
    const needsBreak = current.trim() !== '' && (isMarkdown || lastPieceWasMarkdown);
    markdownSlot.data.content = needsBreak
      ? `${current.replace(/\s+$/, '')}\n\n${piece.replace(/^\s+/, '')}`
      : current + piece;
    lastPieceWasMarkdown = isMarkdown;
  };
  let textBuf = '';
  const flushText = (): void => {
    if (!textBuf) return;
    if (mergeIntoMarkdown) appendMarkdown(textBuf, false);
    else parts.push(textBuf);
    textBuf = '';
  };

  for (const item of segments) {
    if (typeof item === 'string') {
      textBuf += item;
      continue;
    }
    const data = item.data ?? {};
    switch (item.type) {
      case 'share':
        throw new EndpointDeliveryError('unsupported_operation', 'QQ canonical share cards are not implemented', 'not_sent');
      case 'text':
        textBuf += String(data.text ?? data.content ?? '');
        break;
      case 'mention':
      case 'at': {
        const identity = mentionIdentity(item.type, data);
        if (!identity) break;
        flushText();
        const userId = 'all' in identity ? 'all' : identity.id;
        const markup = userId === 'all' ? QQ_AT_EVERYONE : qqAtUserMarkup(userId);
        if (mergeIntoMarkdown) {
          appendMarkdown(markup, false);
          break;
        }
        parts.push({ type: 'at', data: { user_id: userId } });
        break;
      }
      case 'image':
      case 'audio':
      case 'video':
      case 'file': {
        flushText();
        const media = normalizeMediaSegment(item);
        if (media) parts.push(media);
        break;
      }
      case 'markdown': {
        const markdown = normalizeMarkdownSegment(item);
        if (!markdown) break;
        flushText();
        if (mergeIntoMarkdown && typeof markdown.data.content === 'string') {
          appendMarkdown(markdown.data.content, true);
          break;
        }
        parts.push(markdown);
        break;
      }
      case 'keyboard': {
        flushText();
        parts.push(...expandKeyboardSegment(item));
        break;
      }
      case 'reply': {
        const id = data.message_id ?? data.id ?? data.event_id;
        if (id == null || id === '') break;
        flushText();
        parts.push({
          type: 'reply',
          data: data.event_id != null
            ? { event_id: String(data.event_id) }
            : { id: String(id) },
        });
        break;
      }
      default:
        // 未识别段：保持既有文本降级
        textBuf += textFromUnknownSegment(item);
        break;
    }
  }
  flushText();
  if (markdownSlot && !markdownSlot.data.content.trim()) parts.splice(parts.indexOf(markdownSlot), 1);

  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  return parts;
}

/** SDK 能作为 msg_type=7 富媒体发送的段 */
const SPLIT_MEDIA_TYPES = new Set(['image', 'audio', 'video']);
/** 走 msg_type=2 的 markdown/按钮段 */
const MARKDOWN_MESSAGE_TYPES = new Set(['markdown', 'keyboard', 'button']);

export interface FormatOutboundMessagesOptions {
  /** 公网图片 URL → 尺寸；有尺寸的图片才能嵌入 markdown（见 collectOutboundImageSizes）。 */
  readonly imageSizes?: ReadonlyMap<string, QqImageSize>;
}

function requireKeyboardMarkdown(messages: QqOutboundMessage[]): QqOutboundMessage[] {
  if (!messages.length) throw new EndpointDeliveryError('unsupported_operation', 'QQ payload has no sendable content', 'not_sent');
  for (const message of messages) {
    const parts: readonly (string | QqOutboundElem)[] = Array.isArray(message) ? message : [message as string | QqOutboundElem];
    if (parts.some(part => typeof part !== 'string' && (part.type === 'keyboard' || part.type === 'button'))
      && !parts.some(part => typeof part !== 'string' && part.type === 'markdown')) {
      throw new EndpointDeliveryError('unsupported_operation', 'QQ keyboard requires Markdown in the same physical message', 'not_sent');
    }
  }
  return messages;
}

/**
 * Preserve the original segment order before formatOutbound merges Markdown.
 * Public images with known dimensions become inline Markdown at their original
 * position. Other media form physical-message barriers; reply routing is copied
 * to every resulting message, without moving text across a media barrier.
 */
export function formatOutboundMessages(payload: unknown, options: FormatOutboundMessagesOptions = {}): QqOutboundMessage[] {
  const items = toSegmentList(payload);
  if (items.some(item => typeof item !== 'string' && (item.type === 'card' || item.type === 'share'))) {
    return [formatOutbound(items)];
  }
  const rich = items.some(item => typeof item !== 'string' && MARKDOWN_MESSAGE_TYPES.has(item.type));
  const media = items.some(item => typeof item !== 'string' && SPLIT_MEDIA_TYPES.has(item.type));
  if (!rich || !media) return requireKeyboardMarkdown([formatOutbound(payload)]);

  const replies = items.filter(item => typeof item !== 'string' && item.type === 'reply');
  const templates = items.some(item => typeof item !== 'string' && item.type === 'markdown' && markdownTemplateId(item.data ?? {}));
  const messages: QqOutboundMessage[] = [];
  let pending: Array<string | QqWireSegment> = [];
  const append = (items: Array<string | QqWireSegment>): void => {
    const message = formatOutbound(items);
    const parts = Array.isArray(message) ? message : [message];
    if (parts.some(part => typeof part === 'string' ? part.length > 0 : part.type !== 'reply')) messages.push(message);
  };
  const flush = (): void => {
    if (!pending.length) return;
    append([...replies, ...pending]);
    pending = [];
  };
  for (const item of items) {
    if (typeof item !== 'string' && item.type === 'reply') continue;
    if (typeof item !== 'string' && SPLIT_MEDIA_TYPES.has(item.type)) {
      const source = item.type === 'image' && isMediaRef(item.data?.media) ? item.data.media : undefined;
      const size = !templates && source?.kind === 'url' ? options.imageSizes?.get(source.value) : undefined;
      if (source?.kind === 'url' && size) {
        pending.push({ type: 'markdown', data: { content: `![图片 #${size.width}px #${size.height}px](${source.value})` } });
      } else {
        flush();
        append([...replies, item]);
      }
    } else {
      pending.push(item);
    }
  }
  flush();
  return requireKeyboardMarkdown(messages);
}

/**
 * 预先探测需要嵌入 markdown 的公网图片尺寸：仅当 payload 同时含图片与 markdown/按钮时，
 * 对 http(s) URL 图片并发读取文件头；失败的图片不入表，formatOutboundMessages 会降级。
 */
export async function collectOutboundImageSizes(
  payload: unknown,
  { probe, signal }: { readonly probe?: (url: string) => Promise<QqImageSize | undefined>; readonly signal?: AbortSignal } = {},
): Promise<Map<string, QqImageSize>> {
  const sizes = new Map<string, QqImageSize>();
  const segments = toSegmentList(payload).filter((item): item is QqWireSegment => typeof item !== 'string');
  if (!segments.some((item) => MARKDOWN_MESSAGE_TYPES.has(item.type))) return sizes;
  const urls = new Set<string>();
  for (const item of segments) {
    const media = item.type === 'image' ? (item.data ?? {}).media : undefined;
    if (isMediaRef(media) && media.kind === 'url' && /^https?:\/\//i.test(media.value)) urls.add(media.value);
  }
  await Promise.all([...urls].map(async (url) => {
    signal?.throwIfAborted();
    const size = await (probe ? probe(url) : probeImageSize(url, { signal }));
    if (size) sizes.set(url, size);
  }));
  return sizes;
}
