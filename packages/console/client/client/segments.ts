import type { MessageSegment } from './types.js';

/** IM 可见段白名单（与 core segment-contract/delivery 对齐） */
const IM_VISIBLE_TYPES = new Set([
  'text', 'mention', 'image', 'video', 'audio', 'voice', 'record', 'file',
  'face', 'reply', 'forward', 'link', 'dice', 'rps', 'markdown', 'html',
  'qrcode', 'tts', 'keyboard', 'action',
]);

const AI_ONLY_TYPES = new Set(['thinking', 'tool_call']);

function isSegmentLike(value: unknown): value is MessageSegment {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as MessageSegment).type === 'string'
    && 'data' in value
  );
}

/**
 * Inbox / 用户 IM 视图：仅展示 IM-visible 段（剔除 thinking、tool_call）。
 * Agent 面板应使用全量 segments，勿调用此函数。
 */
export function segmentsForImDelivery(segments: readonly unknown[]): MessageSegment[] {
  const out: MessageSegment[] = [];
  for (const item of segments) {
    if (!isSegmentLike(item)) continue;
    if (AI_ONLY_TYPES.has(item.type)) continue;
    if (!IM_VISIBLE_TYPES.has(item.type)) continue;
    out.push(item);
  }
  return out;
}

/** Agent 面板全量 segments（identity，便于双视图 API 对称） */
export function segmentsForAgentPanel(segments: readonly MessageSegment[]): MessageSegment[] {
  return [...segments];
}
