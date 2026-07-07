import type { Segment } from './types.js';
import { isStrictCanonicalSegment } from './validate.js';

const STRICT_CANONICAL_TYPES = new Set([
  'text', 'mention', 'image', 'reply', 'forward', 'face', 'dice', 'rps',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 宽松判断：已知 canonical type 走严格校验；未知 type 仅校验顶层形状（adapter 渐进迁移） */
export function isCanonicalSegment(value: unknown): value is Segment {
  if (!isPlainObject(value) || typeof value.type !== 'string') return false;
  if (!isPlainObject(value.data)) return false;
  if (value.platform !== undefined && !isPlainObject(value.platform)) return false;

  if (!STRICT_CANONICAL_TYPES.has(value.type)) {
    return true;
  }

  return isStrictCanonicalSegment(value);
}

export function assertCanonicalSegments(segments: unknown): asserts segments is Segment[] {
  if (!Array.isArray(segments)) {
    throw new Error('segments must be an array');
  }
  for (let i = 0; i < segments.length; i++) {
    if (!isCanonicalSegment(segments[i])) {
      throw new Error(`segment[${i}] is not canonical`);
    }
  }
}
