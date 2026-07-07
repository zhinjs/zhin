import type { MessageElement, Segment } from '@zhin.js/core';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMentionTarget(data: Record<string, unknown>): string {
  const raw = data.target ?? data.user_id ?? data.qq ?? data.id;
  if (raw === 'all') return 'all';
  return raw != null ? String(raw) : '';
}

function normalizeMentionData(data: Record<string, unknown>): { target: string; name?: string } {
  const target = readMentionTarget(data);
  const name = typeof data.name === 'string' && data.name ? data.name : undefined;
  return name ? { target, name } : { target };
}

/** 入站 / 内部 content → canonical Segment[] */
export function toCanonicalSegments(content: readonly MessageElement[] | readonly unknown[]): Segment[] {
  const out: Segment[] = [];
  for (const item of content) {
    if (typeof item === 'string') {
      out.push({ type: 'text', data: { text: item } });
      continue;
    }
    if (!isRecord(item) || typeof item.type !== 'string' || !isRecord(item.data)) {
      continue;
    }
    if (item.type === 'at' || item.type === 'mention') {
      const mention: Segment = {
        type: 'mention',
        data: normalizeMentionData(item.data),
        ...(item.platform && isRecord(item.platform) ? { platform: item.platform } : {}),
      };
      out.push(mention);
      continue;
    }
    out.push(item as Segment);
  }
  return out;
}

/** 出站 wire JSON（Sandbox 与 Console 一致，保留 canonical mention） */
export function fromCanonicalSegments(segments: readonly Segment[]): MessageElement[] {
  return segments.map((seg) => ({ ...seg }));
}
