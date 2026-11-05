/**
 * Danmaku window (ADR 0038 §5) as an inbox policy part.
 *
 * Every danmaku of a lane waits in one window that closes `windowMs` after
 * its first mail, but never sooner than `minIntervalMs` after the lane's
 * previous danmaku turn ended. No sender limit; the window keeps the newest
 * `LIVE_WINDOW_MAX_MESSAGES` mails (older ones are evicted, counted in
 * `InboxTurnFacts.evicted`), and one turn answers it.
 */
import type { InboxEntry, MailId } from '../contracts.js';
import type { InboxGroup } from './groups.js';
import { inboxMarkers } from './markers.js';

export interface LiveWindowOptions {
  /** Answer the window this long after its first danmaku. */
  readonly windowMs: number;
  /** Never start a danmaku turn sooner than this after the lane's previous one ended. */
  readonly minIntervalMs: number;
}

/** Danmaku one window keeps for the model; older ones are evicted. */
export const LIVE_WINDOW_MAX_MESSAGES = 100;

export function normalizeLiveWindow(options: LiveWindowOptions): LiveWindowOptions {
  return Object.freeze({
    windowMs: Math.max(0, options.windowMs),
    minIntervalMs: Math.max(0, options.minIntervalMs),
  });
}

/** When a live group may be answered; `lastLiveEndedAt` = end of the lane's previous danmaku turn. */
export function liveWindowDueAt(
  group: Pick<InboxGroup, 'openedAt'>,
  lastLiveEndedAt: number | undefined,
  options: LiveWindowOptions,
): number {
  return Math.max(group.openedAt + options.windowMs, lastLiveEndedAt === undefined ? 0 : lastLiveEndedAt + options.minIntervalMs);
}

/**
 * Mails to evict so a live group keeps at most `max` mails: the earliest
 * sender's oldest mail goes first (as the former gate did), so memory stays
 * bounded however busy the room is.
 */
export function liveEvictions(entries: readonly InboxEntry[], max: number = LIVE_WINDOW_MAX_MESSAGES): readonly MailId[] {
  const excess = entries.length - Math.max(0, max);
  if (excess <= 0) return [];
  const order: string[] = [];
  const by = new Map<string, MailId[]>();
  for (const e of entries) {
    const s = inboxMarkers(e.mail).senderId;
    let list = by.get(s);
    if (!list) {
      list = [];
      by.set(s, list);
      order.push(s);
    }
    list.push(e.mail.id);
  }
  const out: MailId[] = [];
  for (const s of order) {
    for (const id of by.get(s)!) {
      if (out.length >= excess) return out;
      out.push(id);
    }
  }
  return out;
}
