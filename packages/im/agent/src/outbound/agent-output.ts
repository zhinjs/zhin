import { renderToPlainText, type OutputElement } from '@zhin.js/ai';
import type { Segment } from '@zhin.js/im-contract';

/** IM output belongs to Agent; the reusable AI engine stays transport-neutral. */
export type AgentOutputElement = OutputElement | {
  type: 'message';
  segments: Segment[];
};

const INLINE_URL = /^(?:data:|base64:\/\/)/iu;

/**
 * #1250 第 29 批：内嵌（base64 / data URL）媒体在文本投影里只写占位，绝不写出载荷——这段文本会进入
 * 会话历史（下一轮模型可见）、日志与 trace。
 */
function inlineMediaText(element: OutputElement): string | undefined {
  if (element.type !== 'image' && element.type !== 'audio' && element.type !== 'video' && element.type !== 'file') return undefined;
  const inline = ('base64' in element && !!element.base64) || INLINE_URL.test(element.url.trim());
  if (!inline) return undefined;
  if (element.type === 'image') return element.alt ? `[图片: ${element.alt}]` : '[图片（内嵌数据，已省略）]';
  if (element.type === 'audio') return element.fallbackText || '[语音（内嵌数据，已省略）]';
  if (element.type === 'video') return element.fallbackText || '[视频（内嵌数据，已省略）]';
  return `[文件: ${element.name || 'file'}（内嵌数据，已省略）]`;
}

/** Human-readable projection for logs, metrics and the already-told ledger. */
export function renderAgentOutput(output: readonly AgentOutputElement[]): string {
  return output.map(element => element.type === 'message'
    ? element.segments.map(segment => {
        if (segment.type === 'text') return String(segment.data.text);
        if (segment.type === 'markdown') return String(segment.data.content);
        if (segment.type === 'mention') return `@${segment.data.target}`;
        if (segment.type === 'reaction') return `[reaction ${String((segment.data as { emoji?: unknown }).emoji ?? '')}]`;
        return `[${segment.type}]`;
      }).join('')
    : inlineMediaText(element) ?? renderToPlainText([element])).join('\n');
}

/**
 * Chat messages in send order: every `message` element starts its own message;
 * other elements (tool media, cards, text) join the message before them.
 */
export function splitOutputMessages(output: readonly AgentOutputElement[]): AgentOutputElement[][] {
  const messages: AgentOutputElement[][] = [];
  for (const element of output) {
    if (element.type === 'message' || messages.length === 0) messages.push([element]);
    else messages.at(-1)!.push(element);
  }
  return messages;
}
