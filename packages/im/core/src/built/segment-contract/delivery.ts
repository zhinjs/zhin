import type { Segment } from './types.js';
import { isCanonicalSegment } from './assert.js';

/** IM 可见段白名单（thinking / tool_call 等 AI-only 段过滤） */
const IM_VISIBLE_TYPES = new Set([
  'text',
  'mention',
  'image',
  'video',
  'audio',
  'voice',
  'record',
  'file',
  'face',
  'reply',
  'forward',
  'link',
  'dice',
  'rps',
  'markdown',
  'html',
  'qrcode',
  'tts',
  'keyboard',
]);

const AI_ONLY_TYPES = new Set(['thinking', 'tool_call']);

/**
 * 过滤 agent / AI 出站段，仅保留可经 IM 投递的 canonical 段。
 */
export function segmentsForImDelivery(segments: readonly unknown[]): Segment[] {
  const out: Segment[] = [];
  for (const item of segments) {
    if (!isCanonicalSegment(item)) continue;
    if (AI_ONLY_TYPES.has(item.type)) continue;
    if (!IM_VISIBLE_TYPES.has(item.type)) continue;
    out.push(item);
  }
  return out;
}
