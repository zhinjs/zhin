import { segmentsForImDelivery, type MessageElement, type SendContent } from '@zhin.js/core';

function isSegmentLike(value: unknown): value is MessageElement {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as MessageElement).type === 'string'
    && 'data' in value
  );
}

/**
 * 过滤 AI 出站内容，仅保留 IM-visible canonical 段（剔除 thinking / tool_call）。
 * 非 segment 形状（如 JSX MessageComponent）原样保留。
 */
export function filterImDeliveryContent(content: SendContent): SendContent {
  if (typeof content === 'string') return content;

  const items = Array.isArray(content) ? content : [content];
  const filtered: (string | MessageElement)[] = [];

  for (const item of items) {
    if (!isSegmentLike(item)) {
      filtered.push(item);
      continue;
    }
    const visible = segmentsForImDelivery([item]);
    if (visible.length) filtered.push(visible[0]!);
  }

  if (filtered.length === 0) return [];
  if (filtered.length === 1 && !Array.isArray(content)) return filtered[0]!;
  return filtered;
}
