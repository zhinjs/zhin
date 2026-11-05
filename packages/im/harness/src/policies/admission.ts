/**
 * IM admission as one inbox policy (ADR 0048 §3.1 / §8 H3): ports the
 * semantics of `TurnAdmissionGate` (#725, ADR 0038 §1/§4/§5) onto the
 * Mailbox. What happens to a mail that arrives on a lane:
 *
 * - **Explicit stop** (`isStop`) from the running batch's initiator (or the
 *   master) aborts the running turn and drops the stopping sender's and the
 *   initiator's queued mails; the stop itself never runs. Anyone else:
 *   `forbidden`; nothing running: `not_running`.
 * - **Same sender, nothing delivered yet** (`supersedeSameSender`): a plain
 *   single-sender turn is aborted and its mails are requeued in front with
 *   the new one, so one fresh turn answers everything the user typed.
 * - **Same sender, already queued**: plain text joins the queued group
 *   (burst coalescing).
 * - **Anyone else**: queued FIFO behind the running turn. A member never
 *   aborts, or joins, another member's single turn.
 * - **Merge window** (`merge`): mergeable plain text from different senders
 *   waits in one group, answered once quiet / at `maxWaitMs`.
 * - **Stale reply** (`staleOf`): when a sender of the running turn follows up
 *   into a merge window before anything was delivered, the reply is
 *   discarded and the turn's mails join the follow-up's window, unless the
 *   turn acted or this chain was already discarded once (starvation guard).
 * - **Danmaku window** (`live`): see `live.ts`.
 *
 * `maxQueuedTurns` bounds queued groups (a window counts once); opening one
 * more is `queue_full`. Queue TTL and the hard per-lane mail cap are
 * `MailboxOptions.queueTtlMs` / `maxQueuedPerKey`.
 */
import type {
  InboxEntry,
  InboxPolicy,
  InboxPostDecision,
  InboxReadyDecision,
  InboxRunning,
  InboxStaleDecision,
  InboxView,
} from '../contracts.js';
import { classifyMail, groupInbox, type InboxGroupingOptions } from './groups.js';
import { LIVE_WINDOW_MAX_MESSAGES, liveEvictions, liveWindowDueAt, normalizeLiveWindow, type LiveWindowOptions } from './live.js';
import { inboxMarkers } from './markers.js';
import { mergeWindowDueAt, normalizeMergeWindow, type MergeWindowOptions } from './merge.js';

export const DEFAULT_MAX_QUEUED_TURNS = 5;

export interface InboxPolicyOptions {
  /** Queued (not yet running) groups allowed per lane. */
  readonly maxQueuedTurns: number;
  /** When true, a new mail from the running turn's sender replaces that turn. */
  readonly supersedeSameSender: boolean;
  /** ADR 0038 §1 merge window; omitted = disabled. */
  readonly merge?: MergeWindowOptions;
  /** ADR 0038 §5 danmaku window; omitted = disabled. */
  readonly live?: LiveWindowOptions;
  /** Cap of one danmaku window. Default `LIVE_WINDOW_MAX_MESSAGES`. */
  readonly liveMaxMessages?: number;
}

const FRESH = Object.freeze({ kind: 'fresh' as const });

export function createInboxPolicy(input: InboxPolicyOptions): InboxPolicy {
  const merge = input.merge ? normalizeMergeWindow(input.merge) : undefined;
  const live = input.live ? normalizeLiveWindow(input.live) : undefined;
  const maxQueuedTurns = Math.max(0, Math.floor(input.maxQueuedTurns));
  const liveMax = Math.max(1, Math.floor(input.liveMaxMessages ?? LIVE_WINDOW_MAX_MESSAGES));
  const grouping: InboxGroupingOptions = {
    ...(merge ? { merge: { maxSenders: merge.maxSenders } } : {}),
    live: live !== undefined,
  };
  const groups = (entries: readonly InboxEntry[]) => groupInbox(entries, grouping);

  const runningKind = (running: InboxRunning) => {
    const all = groups(running.batch);
    return all.length === 1 ? all[0]!.kind : 'merge';
  };

  const initiatorOf = (running: InboxRunning): string => inboxMarkers(running.batch[0]!.mail).senderId;

  const supersedes = (senderId: string, plainText: boolean, view: InboxView): boolean => {
    const running = view.running;
    if (!input.supersedeSameSender || !running || running.delivered || !plainText) return false;
    if (runningKind(running) !== 'single') return false;
    const marks = running.batch.map((e) => inboxMarkers(e.mail));
    if (!marks.every((m) => m.senderId === senderId && m.plainText)) return false;
    return !view.pending.some((e) => inboxMarkers(e.mail).senderId === senderId);
  };

  const lastLiveEndedAt = (view: InboxView): number | undefined => {
    const last = view.lastTurn;
    if (!live || !last || last.batch.length === 0) return undefined;
    return classifyMail(last.batch[0]!, grouping) === 'live' ? last.endedAt : undefined;
  };

  return Object.freeze({
    memoryMs: live?.minIntervalMs ?? 0,

    onPost(entry: InboxEntry, view: InboxView): InboxPostDecision {
      const m = inboxMarkers(entry.mail);
      if (m.isStop) {
        const running = view.running;
        if (!running) return { kind: 'reject', code: 'not_running', message: 'nothing is running on this lane' };
        const initiator = initiatorOf(running);
        if (initiator !== m.senderId && !m.isMaster) {
          return { kind: 'reject', code: 'forbidden', message: 'only the turn initiator or the master may stop it' };
        }
        return { kind: 'stop', cancelSenders: [...new Set([m.senderId, initiator])] };
      }
      const before = groups(view.pending);
      const after = groups([...view.pending, entry]);
      const group = after.find((g) => g.entries.includes(entry))!;
      if (group.entries.length > 1) {
        if (group.kind === 'live') {
          const evict = liveEvictions(group.entries, liveMax);
          return evict.length > 0 ? { kind: 'enqueue', merged: true, evict } : { kind: 'enqueue', merged: true };
        }
        return { kind: 'enqueue', merged: true };
      }
      if (group.kind === 'single' && supersedes(m.senderId, m.plainText, view)) return { kind: 'supersede' };
      if (before.length >= maxQueuedTurns) {
        return { kind: 'reject', code: 'queue_full', message: `at most ${maxQueuedTurns} queued turns per lane` };
      }
      return { kind: 'enqueue' };
    },

    ready(view: InboxView): InboxReadyDecision {
      const head = groups(view.pending)[0];
      if (!head) return { kind: 'wait' };
      const batch = head.entries.map((e) => e.mail);
      let due = view.now;
      if (head.kind === 'merge' && merge) due = mergeWindowDueAt(head, merge);
      if (head.kind === 'live' && live) due = liveWindowDueAt(head, lastLiveEndedAt(view), live);
      return due <= view.now ? { kind: 'run', batch } : { kind: 'wait', until: due };
    },

    staleOf(view: InboxView & { readonly running: InboxRunning }): InboxStaleDecision {
      if (!merge) return FRESH;
      const running = view.running;
      const answered = new Set(running.batch.map((e) => inboxMarkers(e.mail).senderId));
      const queued = groups(view.pending);
      const stale: string[] = [];
      for (const e of [...view.pending].sort((a, b) => a.seq - b.seq)) {
        if (e.carriedInto !== undefined || e.seq < running.startSeq) continue;
        if (classifyMail(e.mail, grouping) !== 'merge') continue;
        const s = inboxMarkers(e.mail).senderId;
        if (answered.has(s) && !stale.includes(s)) stale.push(s);
      }
      if (stale.length === 0 || running.delivered) return FRESH;
      if (running.acted) return { kind: 'send', senders: stale, reason: 'acted' };
      if (running.batch.some((e) => e.carriedInto !== undefined)) return { kind: 'send', senders: stale, reason: 'starvation' };
      let target: (typeof queued)[number] | undefined;
      for (let i = queued.length - 1; i >= 0 && !target; i -= 1) {
        if (queued[i]!.kind === 'merge' && queued[i]!.senders.some((s) => stale.includes(s))) target = queued[i];
      }
      if (!target) return FRESH;
      const anchor = target.entries[0]!;
      return { kind: 'discard', senders: stale, carryInto: anchor.carriedInto ?? anchor.mail.id };
    },
  });
}
