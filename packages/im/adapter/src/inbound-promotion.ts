function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extract reply target message ID from a canonical or OneBot-style `reply` segment.
 */
export function extractReplyIdFromSegment(seg: unknown): string | undefined {
  if (!isRecord(seg) || seg.type !== 'reply' || !isRecord(seg.data)) {
    return undefined;
  }
  const raw = seg.data.message_id ?? seg.data.id;
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw.trim();
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(raw);
  }
  return undefined;
}

/**
 * Extract mention target user ID from a canonical `mention` or OneBot-style `at` segment.
 */
export function extractMentionTargetFromSegment(seg: unknown): string | undefined {
  if (!isRecord(seg) || (seg.type !== 'mention' && seg.type !== 'at') || !isRecord(seg.data)) {
    return undefined;
  }
  const raw = seg.data.target ?? seg.data.user_id ?? seg.data.qq ?? seg.data.id;
  let normalized: string | undefined;
  if (typeof raw === 'string' && raw.trim() !== '') {
    normalized = raw.trim();
  } else if (typeof raw === 'number' && Number.isFinite(raw)) {
    normalized = String(raw);
  }
  if (!normalized) return undefined;
  if (normalized.toLowerCase() === 'all') return 'all';
  return normalized;
}

function matchesSelfUserId(target: string, selfUserId: string): boolean {
  if (target === selfUserId) return true;
  if (/^\d+$/.test(target) && /^\d+$/.test(selfUserId)) {
    return String(Number(target)) === String(Number(selfUserId));
  }
  return false;
}

/**
 * Auto-promote `replyTo` and `mentioned` from inbound `segments` when not explicitly set by the adapter.
 * Never sets `mentioned: false` when unmatched — leaves `mentioned: undefined`.
 */
export function promoteInboundMessagePayload<T>(payload: T, selfUserId: string | undefined): T {
  if (!isRecord(payload) || !Array.isArray(payload.segments) || payload.segments.length === 0) {
    return payload;
  }
  const needReply = payload.replyTo === undefined;
  const normalizedSelfId = typeof selfUserId === 'string' && selfUserId.trim() !== ''
    ? selfUserId.trim()
    : undefined;
  const needMentioned = payload.mentioned === undefined && normalizedSelfId !== undefined;
  if (!needReply && !needMentioned) {
    return payload;
  }

  let promotedReplyId: string | undefined;
  let promotedMentioned = false;

  for (const seg of payload.segments) {
    if (needReply && promotedReplyId === undefined) {
      const replyId = extractReplyIdFromSegment(seg);
      if (replyId !== undefined) {
        promotedReplyId = replyId;
      }
    }
    if (needMentioned && !promotedMentioned && normalizedSelfId !== undefined) {
      const target = extractMentionTargetFromSegment(seg);
      if (target !== undefined && target !== 'all' && matchesSelfUserId(target, normalizedSelfId)) {
        promotedMentioned = true;
      }
    }
    if ((!needReply || promotedReplyId !== undefined) && (!needMentioned || promotedMentioned)) {
      break;
    }
  }

  if (promotedReplyId === undefined && !promotedMentioned) {
    return payload;
  }

  const next: Record<string, unknown> = {
    ...payload,
    ...(promotedReplyId !== undefined ? { replyTo: Object.freeze({ id: promotedReplyId }) } : {}),
    ...(promotedMentioned ? { mentioned: true } : {}),
  };

  return (Object.isFrozen(payload) ? Object.freeze(next) : next) as T;
}
