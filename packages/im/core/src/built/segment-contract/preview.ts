/**
 * Canonical Segment[] log / debug preview (SSOT).
 * @see docs/architecture/segment-content-model.md
 */
import { htmlToFallbackText } from '../html-to-text.js';
import { readMentionName, readMentionTarget } from './mention.js';
import { mediaRefFromLegacyData } from './media.js';
import type { SegmentBase } from './types.js';

const PREVIEW_MAX = 80;

function clip(text: string, max = PREVIEW_MAX): string {
  const normalized = text.trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

function previewMedia(data: Record<string, unknown>): string | undefined {
  const media = mediaRefFromLegacyData(data);
  if (!media) return undefined;
  if (media.kind === 'base64') {
    const mime = media.mime_type ?? 'data';
    return `base64:${mime}[${media.value.length}]`;
  }
  if (media.kind === 'path') {
    const base = media.value.split(/[/\\]/).pop() ?? media.value;
    return clip(base, 48);
  }
  return clip(media.value, 60);
}

function previewMediaSegment(type: string, data: Record<string, unknown>): string {
  const media = previewMedia(data);
  const alt = typeof data.alt === 'string'
    ? data.alt
    : typeof data.name === 'string'
      ? data.name
      : undefined;
  if (media && alt) return `[${type}:${media} alt=${clip(alt, 24)}]`;
  if (media) return `[${type}:${media}]`;
  return `[${type}]`;
}

/** Single canonical segment → compact human-readable preview for logs. */
export function formatSegmentPreview(item: SegmentBase): string {
  const { type } = item;
  const data = item.data ?? {};

  switch (type) {
    case 'text':
      return typeof data.text === 'string' ? data.text : '';
    case 'mention': {
      const target = readMentionTarget(data);
      if (target === 'all') return '@all';
      const name = readMentionName(data);
      if (name) return `@${name}`;
      return `@${target}`;
    }
    case 'at': {
      const target = readMentionTarget(data);
      const name = readMentionName(data);
      if (name) return `@${name}`;
      return `@${target}`;
    }
    case 'image':
    case 'video':
    case 'audio':
    case 'voice':
    case 'record':
    case 'file':
      return previewMediaSegment(type, data);
    case 'face': {
      const id = data.id ?? data.face_id;
      const name = typeof data.name === 'string'
        ? data.name
        : typeof data.text === 'string'
          ? data.text
          : undefined;
      if (id != null && name) return `[face:${id} ${name}]`;
      if (id != null) return `[face:${id}]`;
      if (name) return `{face}(${name})`;
      return '[face]';
    }
    case 'reply': {
      const id = data.message_id ?? data.id;
      return id ? `↩${id}` : '[reply]';
    }
    case 'forward': {
      const id = data.forward_id ?? data.id;
      const title = typeof data.title === 'string' ? data.title : undefined;
      const count = Array.isArray(data.messages) ? data.messages.length : 0;
      let out = `[forward${id ? `:${id}` : ''}`;
      if (title) out += ` ${clip(title, 32)}`;
      if (count > 0) out += ` ×${count}`;
      return `${out}]`;
    }
    case 'link': {
      const url = typeof data.url === 'string' ? data.url : '';
      const text = typeof data.text === 'string' ? data.text : '';
      if (text && url) return clip(`${text} <${url}>`);
      return clip(url || text || '[link]');
    }
    case 'dice':
      return data.result != null ? `{dice}(${data.result})` : '{dice}';
    case 'rps':
      return data.result != null ? `{rps}(${data.result})` : '{rps}';
    case 'html': {
      if (typeof data.text === 'string' && data.text) return clip(data.text);
      if (typeof data.html === 'string') {
        const stripped = htmlToFallbackText(data.html);
        return stripped ? clip(`[html] ${stripped}`) : '[html]';
      }
      return '[html]';
    }
    case 'qrcode': {
      const text = typeof data.text === 'string' ? data.text : '';
      return text ? clip(`[qrcode] ${text}`) : '[qrcode]';
    }
    case 'markdown': {
      const text = typeof data.content === 'string'
        ? data.content
        : typeof data.text === 'string'
          ? data.text
          : '';
      return text ? clip(`[markdown] ${text}`) : '[markdown]';
    }
    case 'tts': {
      const text = typeof data.text === 'string' ? data.text : '';
      return text ? clip(`[tts] ${text}`) : '[tts]';
    }
    case 'keyboard': {
      const rows = Array.isArray(data.rows)
        ? data.rows.length
        : Array.isArray(data.buttons)
          ? data.buttons.length
          : 0;
      return rows > 0 ? `[keyboard:${rows}]` : '[keyboard]';
    }
    case 'thinking': {
      const text = typeof data.text === 'string' ? data.text : '';
      return text ? clip(`[thinking] ${text}`, 60) : '[thinking]';
    }
    case 'tool_call': {
      const name = typeof data.name === 'string' ? data.name : 'tool';
      return `[tool:${name}]`;
    }
    default:
      if (typeof data.text === 'string' && data.text) return `{${type}}(${clip(data.text)})`;
      return `{${type}}`;
  }
}
