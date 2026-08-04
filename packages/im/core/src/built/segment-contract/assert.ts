import type { Segment } from './types.js';
import { isStrictCanonicalSegment } from './validate.js';

const STRICT_CANONICAL_TYPES = new Set([
  'text', 'mention', 'image', 'audio', 'video', 'file', 'reply', 'forward', 'face', 'dice', 'rps',
]);

// These are Core-owned wire extensions rather than canonical data types. Keep
// their gradual contracts isolated here; third-party extensions must be
// namespaced so a future canonical type cannot silently collide with them.
const CORE_EXTENSION_TYPES = new Set([
  'action', 'html', 'keyboard', 'link', 'markdown', 'qrcode', 'record', 'tts', 'voice',
]);

const extensionTypePattern = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)+$/u;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 内建 canonical 类型始终走 schema 严格校验。Core 预留扩展和命名空间扩展
 * 只承诺稳定顶层形状；裸未知类型会被拒绝，避免拼写错误绕过 canonical 校验。
 */
export function isCanonicalSegment(value: unknown): value is Segment {
  if (!isPlainObject(value) || typeof value.type !== 'string') return false;
  if (!isPlainObject(value.data)) return false;
  if (value.platform !== undefined && !isPlainObject(value.platform)) return false;

  if (STRICT_CANONICAL_TYPES.has(value.type)) return isStrictCanonicalSegment(value);
  return CORE_EXTENSION_TYPES.has(value.type) || extensionTypePattern.test(value.type);
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
