import type { MessageElement, SendContent } from '../../types.js';
import { segment } from '../../utils.js';
import { KeyboardSegment } from './keyboard-segment.js';
import {
  KEYBOARD_SEGMENT_TYPE,
  type InteractivePolicy,
  type KeyboardSegmentData,
  isKeyboardSegment,
} from './types.js';

function asKeyboardData(item: MessageElement | KeyboardSegment): KeyboardSegmentData | null {
  if (item instanceof KeyboardSegment) return item.data;
  if (isKeyboardSegment(item)) return item.data as KeyboardSegmentData;
  return null;
}

function toKeyboardElement(data: KeyboardSegmentData): MessageElement {
  return { type: KEYBOARD_SEGMENT_TYPE, data };
}

function asArray(content: SendContent): (string | MessageElement)[] {
  return Array.isArray(content) ? content : [content];
}

function packSegments(out: (string | MessageElement)[]): SendContent {
  if (out.length === 0) return { type: 'text', data: { text: '' } };
  if (out.length === 1) return out[0]!;
  return out;
}

/**
 * keyboard 的有效 fallback 映射：显式 `fallback.map` 优先；否则按按钮顺序
 * 自动编号（与 {@link renderKeyboardAsText} 的自动编号一致，含 disabled 按钮）。
 */
export function effectiveKeyboardFallbackMap(data: KeyboardSegmentData): Record<string, string> {
  const map = data.fallback?.map ?? {};
  if (Object.keys(map).length > 0) return { ...map };
  const out: Record<string, string> = {};
  data.rows.flat().forEach((btn, idx) => {
    out[String(idx + 1)] = btn.payload;
  });
  return out;
}

/** 收集 content 中所有 keyboard 段的有效 fallback 映射（文本降级前调用）。 */
export function collectKeyboardFallbackMaps(
  content: SendContent | undefined,
): Record<string, string>[] {
  if (content == null) return [];
  const maps: Record<string, string>[] = [];
  for (const item of asArray(content)) {
    if (typeof item === 'string') continue;
    const data = asKeyboardData(item);
    if (data) maps.push(effectiveKeyboardFallbackMap(data));
  }
  return maps;
}

/** keyboard 段 → 编号文本（'text' 策略端点的中央降级渲染）。 */
export function renderKeyboardAsText(data: KeyboardSegmentData): string {
  const lines: string[] = [];
  const flat = data.rows.flat();
  if (data.fallback?.hint) {
    lines.push(data.fallback.hint);
  } else {
    lines.push('请选择（回复数字）：');
  }
  const map = data.fallback?.map ?? {};
  const entries = Object.keys(map).length > 0
    ? Object.entries(map).sort(([a], [b]) => Number(a) - Number(b))
    : flat.map((btn, idx) => [String(idx + 1), btn.payload] as const);
  for (const [key, payload] of entries) {
    const btn = flat.find((b) => b.payload === payload);
    const label = btn?.label ?? '·';
    lines.push(`${key}. ${label}${btn?.disabled ? ' (不可用)' : ''}`);
  }
  return lines.join('\n');
}

export function hasKeyboardSegment(content: SendContent | undefined): boolean {
  if (content == null) return false;
  return asArray(content).some((item) => {
    if (typeof item === 'string') return false;
    return item instanceof KeyboardSegment || isKeyboardSegment(item);
  });
}

/** @deprecated 使用 {@link hasKeyboardSegment} */

/** 按 Adapter interactivePolicy 将 keyboard 段转为 native 保留或文本降级 */
export function resolveKeyboardSegments(
  content: SendContent,
  policy: InteractivePolicy,
): SendContent {
  if (!hasKeyboardSegment(content)) return content;

  const items = asArray(content);
  const out: (string | MessageElement)[] = [];

  for (const item of items) {
    if (typeof item === 'string') {
      out.push(item);
      continue;
    }
    const data = item instanceof KeyboardSegment
      ? item.data
      : isKeyboardSegment(item)
        ? (item.data as KeyboardSegmentData)
        : null;
    if (!data) {
      out.push(item);
      continue;
    }
    if (policy === 'native') {
      out.push(toKeyboardElement(data));
      continue;
    }
    out.push(segment.text(renderKeyboardAsText(data)));
  }

  return packSegments(out);
}
