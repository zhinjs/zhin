/**
 * Canonical Segment[] → 纯文本视图（SSOT）。
 * 入站双轨：结构化段为唯一内部契约，纯文本视图供命令匹配 / AI 兜底消费。
 * @see docs/architecture/segment-content-model.md
 */
import { readMentionName, readMentionTarget } from './mention.js';
import type { Segment } from './types.js';

/**
 * 提取纯文本视图：text 段原文拼接，mention/at 段渲染为 `@name`（无名回退
 * `@target`，`all` → `@all`）；其余段类型不产生文本（媒体 / 回复等结构化
 * 信息经 `segments` 轨道消费，不污染命令输入）。
 */
export function segmentsToPlainText(segments: readonly Segment[]): string {
  let out = '';
  for (const segment of segments) {
    // Segment 含 SegmentBase 兜底成员，type 窄化不能联动窄化 data，统一按字典读
    const data: Record<string, unknown> = segment.data;
    if (segment.type === 'text') {
      if (typeof data.text === 'string') out += data.text;
      continue;
    }
    if (segment.type === 'mention' || segment.type === 'at') {
      const name = readMentionName(data);
      if (name) {
        out += `@${name}`;
        continue;
      }
      const target = readMentionTarget(data);
      if (target) out += `@${target}`;
    }
  }
  return out;
}
