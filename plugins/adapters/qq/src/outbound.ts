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
 *   keyboard 载荷）；按钮消息必须带 markdown，故同行文本合并为 markdown 段。
 *   data.id 模板键盘原样透传。
 * 不可映射的段一律降级为文本并 warn（保持既有 fallback 行为）。
 */
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { QqWireSegment } from './protocol.js';

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
  readonly disabled?: boolean;
  readonly mode?: string;
  readonly command?: { readonly enter?: boolean; readonly reply?: boolean };
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isInlineBase64(value: string): boolean {
  return value.startsWith('base64://') || /^data:[^/]+\/[^;]+;base64,/i.test(value);
}

/**
 * 解析 image/audio/video/file 段的本地或内联 payload。
 * qq-official-bot 的 formatMediaData 对 data.url 直接当远程 URL；
 * base64:// / data:...;base64 / 本地路径须走 data.file 才会解析为 file_data。
 */
export function resolveMediaFile(data: Record<string, unknown>): string | undefined {
  const url = typeof data.url === 'string' ? data.url : undefined;
  const file = typeof data.file === 'string' ? data.file : undefined;
  const base64 = typeof data.base64 === 'string' ? data.base64 : undefined;

  if (file && !isRemoteUrl(file)) return file;
  if (url && isInlineBase64(url)) return url;
  if (url && !isRemoteUrl(url) && (url.startsWith('file://') || url.startsWith('/'))) return url;
  if (base64) return base64.startsWith('base64://') ? base64 : `base64://${base64}`;
  return undefined;
}

function normalizeMediaSegment(seg: QqWireSegment): QqOutboundElem | null {
  const data = { ...(seg.data ?? {}) };
  const file = resolveMediaFile(data);
  if (file) {
    delete data.url;
    delete data.base64;
    data.file = file;
    return { type: seg.type, data };
  }
  const url = typeof data.url === 'string' ? data.url
    : typeof data.file === 'string' ? data.file
      : undefined;
  if (url && isRemoteUrl(url)) {
    delete data.base64;
    return { type: seg.type, data: { ...data, url } };
  }
  // 既无远程 URL 也无本地上传源：无法投递，降级留痕
  logger.warn(formatCompact({
    op: 'qq_outbound_media_dropped',
    type: seg.type,
    reason: 'missing_source',
  }));
  return null;
}

function normalizeMarkdownSegment(seg: QqWireSegment): QqOutboundElem | null {
  const data = seg.data ?? {};
  const templateId = typeof data.custom_template_id === 'string' && data.custom_template_id
    ? data.custom_template_id
    : typeof data.template_id === 'string' && data.template_id
      ? data.template_id
      : undefined;
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
    type: isCommand ? 2 : 1,
    permission: { type: 2 },
    data: btn.payload ?? '',
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
      style: 0,
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

  // QQ 按钮消息必须携带 markdown（msg_type=2），keyboard 存在时文本合并为 markdown 段
  const hasKeyboard = segments.some(
    (item) => typeof item !== 'string' && item.type === 'keyboard',
  );

  const parts: Array<string | QqOutboundElem> = [];
  let textBuf = '';
  const flushText = (): void => {
    if (!textBuf) return;
    parts.push(hasKeyboard
      ? { type: 'markdown', data: { content: textBuf } }
      : textBuf);
    textBuf = '';
  };

  for (const item of segments) {
    if (typeof item === 'string') {
      textBuf += item;
      continue;
    }
    const data = item.data ?? {};
    switch (item.type) {
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
        flushText();
        const markdown = normalizeMarkdownSegment(item);
        if (markdown) parts.push(markdown);
        break;
      }
      case 'keyboard': {
        flushText();
        parts.push(...expandKeyboardSegment(item));
        break;
      }
      case 'reply': {
        const id = data.id ?? data.event_id;
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

  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  return parts;
}
