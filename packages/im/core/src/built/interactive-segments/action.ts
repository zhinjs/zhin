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

export function formatActionAsRaw(data: ActionSegmentData): string {
  return data.payload;
}
