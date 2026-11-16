import { resolvePayloadFromText } from '@zhin.js/core';
import { normalizeChoiceLabel } from './choice-label.js';

/**
 * 从 QQ 指令预填 / 数字 fallback / 按钮文字解析游戏 payload。按钮文字按
 * {@link buildChoiceFallbackMap} 的同一规则归一化（去 emoji / 空白、不区分大小写）。
 */
export function resolveGameTextPayload(
  raw: string,
  map?: Record<string, string>,
): string | undefined {
  const resolved = resolvePayloadFromText(raw, map);
  if (resolved !== undefined || !map) return resolved;
  const key = normalizeChoiceLabel(raw);
  return key && Object.hasOwn(map, key) ? map[key] : undefined;
}
