import type { MessageElement, MessageSegment, SendContent } from '../../types.js';
import { type KeyboardSegmentData, isKeyboardSegment } from './types.js';
import { KeyboardSegment } from './keyboard-segment.js';
/** OneBot / QQ 系 keyboard 段（各 adapter 在 $sendMessage 中识别） */
export function keyboardToOneBotSegment(data: KeyboardSegmentData): MessageSegment {
  return {
    type: 'keyboard',
    data: {
      rows: data.rows.map((row) =>
        row.map((btn) => ({
          label: btn.label,
          data: btn.payload,
          enter: false,
          action_type: 'callback',
          disable: !!btn.disabled,
        })),
      ),
    },
  };
}

/** @deprecated 使用 {@link keyboardToOneBotSegment} */
export const interactiveToKeyboardSegment = keyboardToOneBotSegment;

function asKeyboardData(item: MessageElement | KeyboardSegment): KeyboardSegmentData | null {
  if (item instanceof KeyboardSegment) return item.data;
  if (isKeyboardSegment(item)) return item.data as KeyboardSegmentData;
  return null;
}

/** 出站前将 core keyboard 段展开为 OneBot keyboard（保留前置 text 等段） */
export function expandKeyboardSegmentsInContent(content: SendContent): SendContent {
  const items = Array.isArray(content) ? content : [content];
  const out: (string | MessageSegment)[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      out.push(item);
      continue;
    }
    if (typeof item.type !== 'string') {
      continue;
    }
    const data = asKeyboardData(item as MessageElement);
    if (data) {
      out.push(keyboardToOneBotSegment(data));
      continue;
    }
    out.push(item as MessageSegment);
  }
  if (out.length === 0) return { type: 'text', data: { text: '' } };
  if (out.length === 1) return out[0]!;
  return out;
}

/** @deprecated 使用 {@link expandKeyboardSegmentsInContent} */
export const expandInteractiveSegmentsInContent = expandKeyboardSegmentsInContent;
