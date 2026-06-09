/**
 * 出站 `html` 消息段兜底：未装 html-renderer 或转图失败时，自动剥离为 text 段。
 */
import type { Plugin } from '../plugin.js';
import type { MessageElement, SendContent, SendOptions } from '../types.js';
import { segment } from '../utils.js';
import { htmlToFallbackText } from './html-to-text.js';

function asArray(content: SendContent): (string | MessageElement)[] {
  return Array.isArray(content) ? content : [content];
}

function resolveHtmlSegmentText(data: Record<string, unknown>): string {
  if (typeof data.text === 'string' && data.text.length > 0) return data.text;
  if (typeof data.html === 'string') return htmlToFallbackText(data.html);
  return '';
}

export function coerceHtmlSegmentsToText(content: SendContent): SendContent {
  const items = asArray(content);
  const out: (string | MessageElement)[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      out.push(item);
      continue;
    }
    if (item?.type === 'html') {
      const text = resolveHtmlSegmentText(item.data ?? {});
      if (text) out.push(segment.text(text));
      continue;
    }
    out.push(item);
  }
  if (out.length === 0) return segment.text('');
  if (out.length === 1) return out[0]!;
  return out;
}

/** 注册链尾 before.sendMessage：将未转换的 html 段降级为 text */
export function registerHtmlSegmentFallback(plugin: Plugin): () => void {
  const handler = (options: SendOptions): SendOptions => {
    const content = options.content;
    if (content == null) return options;
    const items = asArray(content);
    if (!items.some((item) => typeof item !== 'string' && item?.type === 'html')) {
      return options;
    }
    return { ...options, content: coerceHtmlSegmentsToText(content) };
  };
  plugin.root.on('before.sendMessage', handler);
  return () => plugin.root.off('before.sendMessage', handler);
}
