/**
 * 入站媒体引用读取 — commMessage 的 canonical 媒体段（extra.media 优先，
 * 否则 extra.segments 经 collectSegmentMedia 收集）。turn 注入与
 * orchestrator 子 agent 入站共用。
 */
import {
  collectSegmentMedia,
  type AgentTurnMessage,
  type Message,
  type SegmentMediaRef,
} from '@zhin.js/core';

/** 从 commMessage 提取入站媒体段（extra.media 优先，否则 extra.segments 收集）。 */
export function readInboundMediaRefs(commMessage: Message): readonly SegmentMediaRef[] {
  const extra = (commMessage as AgentTurnMessage).extra as
    | { media?: unknown; segments?: unknown }
    | undefined;
  if (Array.isArray(extra?.media)) {
    return extra.media as readonly SegmentMediaRef[];
  }
  const segments = Array.isArray(extra?.segments)
    ? (extra.segments as Parameters<typeof collectSegmentMedia>[0])
    : (commMessage as { $content?: unknown }).$content as Parameters<typeof collectSegmentMedia>[0];
  return collectSegmentMedia(segments);
}
