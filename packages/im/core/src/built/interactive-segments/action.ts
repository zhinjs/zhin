import type { Message } from '../../message.js';
import type { MessageElement } from '../../types.js';
import { segment } from '../../utils.js';
import {
  ACTION_SEGMENT_TYPE,
  type ActionSegmentData,
  isActionSegment,
} from './types.js';

export function actionSegment(data: ActionSegmentData): MessageElement {
  return { type: ACTION_SEGMENT_TYPE, data };
}

export function getActionFromMessage(message: Message<any>): ActionSegmentData | undefined {
  for (const item of message.$content ?? []) {
    if (typeof item === 'string') continue;
    if (isActionSegment(item)) return item.data;
  }
  return undefined;
}

/** 入站互动 action（按钮点击等），不应计入用户发言/消息统计 */
export function isActionMessage(message: Message<any>): boolean {
  return getActionFromMessage(message) != null;
}

const PAYLOAD_PATTERN = /^[a-z0-9_]+:[^:\s]+:[a-z0-9_-]+$/i;

/** 去掉 @bot、XML at 段、首尾空白（QQ 指令预填文本归一化） */
export function stripInteractiveCommandText(raw: string): string {
  let text = raw.trim();
  text = stripXmlAtSegments(text);
  text = text.replace(/^@\S+\s+/u, '');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function stripXmlAtSegments(text: string): string {
  let out = '';
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.toLowerCase().indexOf('<at ', cursor);
    if (start < 0) break;
    const end = text.indexOf('/>', start + 4);
    if (end < 0) break;
    out += text.slice(cursor, start) + ' ';
    cursor = end + 2;
  }
  return out + text.slice(cursor);
}

/** 从文本降级输入解析 payload（需在 active session 的 fallback.map 中查找） */
export function resolveTextFallbackPayload(
  raw: string,
  map: Record<string, string>,
): string | undefined {
  const trimmed = raw.trim();
  if (map[trimmed]) return map[trimmed];
  const match = trimmed.match(/^(?:ttt\s+)?(\d)$/i);
  if (match && map[match[1]!]) return map[match[1]!];
  return undefined;
}

/**
 * 从用户文本入站解析 interactive payload：
 * 归一化 → 直接匹配 prefix:session:id → fallback 数字映射
 */
export function resolvePayloadFromText(
  raw: string,
  map?: Record<string, string>,
): string | undefined {
  const normalized = stripInteractiveCommandText(raw);
  if (!normalized) return undefined;
  if (PAYLOAD_PATTERN.test(normalized)) return normalized;
  if (map && Object.keys(map).length > 0) {
    return resolveTextFallbackPayload(normalized, map);
  }
  return undefined;
}

export function formatActionAsRaw(data: ActionSegmentData): string {
  return data.payload;
}
