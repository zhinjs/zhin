import { resolvePayloadFromText } from '@zhin.js/core';

/** 从 QQ 指令预填 / 数字 fallback 解析游戏 payload */
export function resolveGameTextPayload(
  raw: string,
  map?: Record<string, string>,
): string | undefined {
  return resolvePayloadFromText(raw, map);
}
