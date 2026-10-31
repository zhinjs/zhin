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
 * canonical share 当前明确 not_sent/unsupported，避免静默丢标题/描述/URL。
 * 其他未识别段保持既有 data.text fallback；正常发送另受声明的 supported 白名单约束。
 */
import { formatCompact, getLogger } from '@zhin.js/logger';
import { EndpointDeliveryError, isMediaRef } from '@zhin.js/im-contract';
import type { QqWireSegment } from './protocol.js';
import { probeImageSize, type QqImageSize } from './image-size.js';

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
      case 'at': {
        const id = String(data.user_id ?? data.qq ?? data.id ?? '');
        if (!id) break;
        flushText();
        parts.push({ type: 'at', data: { user_id: id } });
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

function isElemOf(types: Set<string>) {
  return (part: string | QqOutboundElem): part is QqOutboundElem => typeof part !== 'string' && types.has(part.type);
}

/**
 * 渲染后 payload → 按序发送的 QQ Sendable 列表。
 *
 * QQ 单条消息的 msg_type 只能是一种：富媒体（7，media.file_info）与 markdown/按钮（2）
 * 互斥，SDK 后处理的段会覆盖 msg_type，导致图片被静默丢弃。处理顺序：
 * 1. 公网 URL 图片且已知尺寸：按 QQ markdown 语法 `![图片 #宽px #高px](url)` 嵌入同一
 *    markdown 段（开放平台会下载转存），仍为一条消息；
 * 2. 其余媒体（base64 / 本地渲染图：v2 /files 上传只返回 file_info，拿不到 URL；或尺寸
 *    未知、模板 markdown 无法拼接）降级为独立富媒体消息先发，markdown + 按钮作为最后一条
 *    （返回其消息 ID）。reply 段随每条消息携带，保持被动回复。
 * 不含媒体与 markdown/按钮冲突时与 formatOutbound 一致（单条）。
 */
export function formatOutboundMessages(payload: unknown, options: FormatOutboundMessagesOptions = {}): QqOutboundMessage[] {
  const body = formatOutbound(payload);
  if (!Array.isArray(body)) return [body as QqOutboundMessage];
  const elems = body as ReadonlyArray<string | QqOutboundElem>;
  const isMedia = isElemOf(SPLIT_MEDIA_TYPES);
  if (!elems.some(isMedia) || !elems.some(isElemOf(MARKDOWN_MESSAGE_TYPES))) return [body];

  const markdownIndex = elems.findIndex(isElemOf(new Set(['markdown'])));
  const markdownElem = markdownIndex >= 0 ? elems[markdownIndex] as QqOutboundElem : undefined;
  const markdownContent = markdownElem ? markdownElem.data.content : '';
  const embedded = new Set<QqOutboundElem>();
  let merged: QqOutboundElem | undefined;
  if (typeof markdownContent === 'string') {
    const before: string[] = [];
    const after: string[] = [];
    elems.forEach((part, index) => {
      if (!isMedia(part) || part.type !== 'image' || typeof part.data.url !== 'string') return;
      const size = options.imageSizes?.get(part.data.url);
      if (!size) return;
      (markdownIndex < 0 || index < markdownIndex ? before : after)
        .push(`![图片 #${size.width}px #${size.height}px](${part.data.url})`);
      embedded.add(part);
    });
    if (embedded.size > 0) {
      merged = { type: 'markdown', data: { content: [...before, markdownContent, ...after].filter((piece) => piece.trim()).join('\n\n') } };
    }
  }

  const replies = elems.filter(isElemOf(new Set(['reply'])));
  const separate: QqOutboundElem[] = [];
  const rest: Array<string | QqOutboundElem> = [];
  let mergedPlaced = false;
  for (const part of elems) {
    if (merged && (part === markdownElem || (!markdownElem && embedded.has(part as QqOutboundElem)))) {
      if (!mergedPlaced) rest.push(merged);
      mergedPlaced = true;
    } else if (embedded.has(part as QqOutboundElem)) {
      continue;
    } else if (isMedia(part)) {
      separate.push(part);
    } else {
      rest.push(part);
    }
  }
  return [
    ...separate.map((item): QqOutboundMessage => (replies.length ? [...replies, item] : item)),
    rest.length === 1 ? rest[0]! : rest,
  ];
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
