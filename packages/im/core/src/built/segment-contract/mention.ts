/**
 * Canonical mention field readers (SSOT).
 */

export function readMentionTarget(data: Record<string, unknown> | undefined): string {
  if (!data) return '';
  const raw = data.target ?? data.user_id ?? data.qq ?? data.id;
  if (raw === 'all') return 'all';
  return raw != null ? String(raw) : '';
}

export function readMentionName(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) return undefined;
  const name = data.name ?? data.nickname ?? data.username;
  return typeof name === 'string' && name.trim() ? name.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Resolve @ target from at / mention segment. */
export function readMentionSegmentTarget(seg: {
  type: unknown;
  data?: unknown;
}): string {
  if (seg.type !== 'at' && seg.type !== 'mention') return '';
  return readMentionTarget(isRecord(seg.data) ? seg.data : undefined);
}
