import type { Segment } from './types.js';
import { isCanonicalSegment } from './assert.js';
import { OUTBOUND_SEGMENT_TYPES } from './catalog.js';

/**
 * IM 可见段白名单（thinking / tool_call 等 AI-only 段过滤）。
 * ADR 0064 §1：由出站段目录派生，新增段类型只改目录一处。
 */
const IM_VISIBLE_TYPES: ReadonlySet<string> = new Set(OUTBOUND_SEGMENT_TYPES);

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
