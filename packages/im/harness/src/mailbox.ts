/**
 * Mailbox scheduler (ADR 0048 §3.1, H3).
 *
 * Semantics:
 * - Key = (mail.to, laneOf(mail)). A lane defaults to the mail's engagement,
 *   so without explicit lanes one actor runs one turn per engagement at a
 *   time. At most one turn runs per key; different keys run in parallel,
 *   bounded by `maxConcurrentTurns` across all keys.
 * - Fairness: when a slot frees, idle keys are offered the slot in global
 *   arrival order of their oldest queued mail, so a busy key cannot starve
 *   the others. A key whose policy says `wait` does not hold a slot.
 * - Policy (`InboxPolicy`, all members optional): `onPost` decides what a new
 *   mail does (enqueue / supersede / stop / reject), `ready` picks the next
 *   batch of an idle key or asks to wait until a time (merge and danmaku
 *   windows), `staleOf` answers the running turn's pre-send check. Without a
 *   policy the mailbox is plain FIFO, one mail per turn.
 * - A `ready` batch must be an in-order subsequence of the key's queue that
 *   contains its first mail; anything else is a programming error and only
 *   the first mail runs. Selected mails leave the queue.
 * - Supersede and stale discard requeue the running batch (in front of the
 *   queue / right before the follow-up's group). Requeued mails are reported
 *   to `onTurnFinished` only once, by the turn that finally answers them.
 * - Queued mails older than `queueTtlMs` when their key would start are
 *   dropped (`expired`). Dropped and cancelled mails are reported one by one
 *   with `{status:'cancelled', reason}`.
 * - `post` never starts a turn synchronously; turns start in a microtask (or
 *   when a `wait` timer fires, via the injectable `setTimer`).
 * - A runner rejection becomes `{status:'failed', content: message}`.
 *   `onTurnFinished` is awaited before the key (and its slot) is released;
 *   errors it throws are swallowed and reported through `onError`.
 * - `cancel` aborts a running batch's signal (a runner that resolves with a
 *   non-cancelled status after abort is reported as cancelled), or removes a
 *   queued mail and reports it cancelled.
 * - `close` rejects new posts, drops queued mails (reported cancelled), aborts
 *   running turns, clears wait timers and resolves once everything settled.
 */
import { laneOf, senderOf } from './contracts.js';
import type {
  ActorTurnControl,
  ActorTurnResult,
  InboxDropReason,
  InboxEntry,
  InboxPolicy,
  InboxPostDecision,
  InboxReadyDecision,
  InboxRunning,
  InboxStaleDecision,
  InboxStaleVerdict,
  InboxView,
  Mail,
  MailId,
  Mailbox,
  MailboxKey,
  MailboxOptions,
  PostResult,
} from './contracts.js';

export interface MailboxLocalOptions {
  /** Receives swallowed errors from `onTurnFinished` and policy callbacks / invalid batch selections. */
  readonly onError?: (error: unknown, context: string) => void;
}

interface RunningState {
  readonly batch: readonly InboxEntry[];
  readonly controller: AbortController;
  readonly startedAt: number;
  readonly startSeq: number;
  delivered: boolean;
  acted: boolean;
  /** Mails of this batch that went back to the queue (supersede / stale discard). */
  readonly requeued: Set<MailId>;
  /** Sticky verdict once the reply was discarded. */
  discarded?: InboxStaleVerdict;
}

interface KeyState {
  readonly actor: string;
  readonly lane: string;
  pending: InboxEntry[];
  running?: RunningState;
  cancelTimer?: () => void;
  /** Mails evicted since the last turn started. */
  evicted: number;
  /** Engagement of the most recent mail, for keys with an empty queue. */
  lastEngagement: string;
}

const FRESH: InboxStaleVerdict = Object.freeze({ kind: 'fresh' });

function defaultSetTimer(callback: () => void, delayMs: number): () => void {
  const handle = setTimeout(callback, delayMs);
  handle.unref?.();
  return () => clearTimeout(handle);
}

export function createMailbox(options: MailboxOptions, local: MailboxLocalOptions = {}): Mailbox {
  const policy: InboxPolicy = options.policy ?? {};
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? defaultSetTimer;
  const ttl = Math.max(0, options.queueTtlMs ?? 0);
  const keys = new Map<string, KeyState>();
  const lastTurns = new Map<string, { batch: readonly Mail[]; endedAt: number }>();
  const settling = new Set<Promise<void>>();
  const idleWaiters: Array<() => void> = [];
  let seq = 0;
  let runningCount = 0;
  let queuedCount = 0;
  let notifying = 0;
  let closed = false;
  let pumpScheduled = false;

  const report = (error: unknown, context: string): void => {
    try {
      local.onError?.(error, context);
    } catch {
      /* ignore */
    }
  };

  const keyId = (actor: string, lane: string): string => `${actor}\u0000${lane}`;

  const keyOf = (st: KeyState, first?: Mail): MailboxKey => ({
    actor: st.actor,
    lane: st.lane,
    engagementId: (first ?? st.pending[0]?.mail ?? st.running?.batch[0]?.mail)?.engagementId ?? st.lastEngagement,
  });

  const runningView = (r: RunningState): InboxRunning => ({
    batch: r.batch,
    startedAt: r.startedAt,
    startSeq: r.startSeq,
    delivered: r.delivered,
    acted: r.acted,
  });

  const viewOf = (st: KeyState): InboxView => {
    const last = lastTurns.get(keyId(st.actor, st.lane));
    return {
      key: keyOf(st),
      now: now(),
      pending: st.pending.slice(),
      ...(st.running ? { running: runningView(st.running) } : {}),
      ...(last ? { lastTurn: last } : {}),
    };
  };

  const checkIdle = (): void => {
    if (runningCount === 0 && queuedCount === 0 && notifying === 0) {
      for (const w of idleWaiters.splice(0)) w();
    }
  };

  const notify = async (key: MailboxKey, batch: readonly Mail[], result: ActorTurnResult): Promise<void> => {
    try {
      await options.onTurnFinished?.(key, batch, result);
    } catch (e) {
      report(e, 'onTurnFinished');
    }
  };

  const notifyDetached = (key: MailboxKey, batch: readonly Mail[], result: ActorTurnResult): void => {
    notifying++;
    const p: Promise<void> = notify(key, batch, result).finally(() => {
      notifying--;
      settling.delete(p);
      checkIdle();
    });
    settling.add(p);
  };

  /** Removes `entries` from the queue and reports each one cancelled. */
  const drop = (st: KeyState, entries: readonly InboxEntry[], reason: InboxDropReason, content?: string): void => {
    if (entries.length === 0) return;
    const gone = new Set(entries);
    st.pending = st.pending.filter((e) => !gone.has(e));
    queuedCount -= entries.length;
    for (const e of entries) {
      notifyDetached(keyOf(st, e.mail), [e.mail], { status: 'cancelled', reason, ...(content !== undefined ? { content } : {}) });
    }
  };

  const clearTimer = (st: KeyState): void => {
    st.cancelTimer?.();
    st.cancelTimer = undefined;
  };

  const cleanup = (st: KeyState): void => {
    if (st.pending.length === 0 && !st.running) {
      clearTimer(st);
      const id = keyId(st.actor, st.lane);
      if (keys.get(id) === st) keys.delete(id);
    }
  };

  const schedulePump = (): void => {
    if (pumpScheduled) return;
    pumpScheduled = true;
    queueMicrotask(() => {
      pumpScheduled = false;
      pump();
    });
  };

  const pruneMemory = (t: number): void => {
    const memory = Math.max(0, policy.memoryMs ?? 0);
    for (const [id, last] of lastTurns) {
      if (t - last.endedAt >= memory && !keys.get(id)?.running) lastTurns.delete(id);
    }
  };

  const decideReady = (st: KeyState): InboxReadyDecision => {
    const fallback: InboxReadyDecision = { kind: 'run', batch: [st.pending[0]!.mail] };
    if (!policy.ready) return fallback;
    let decision: InboxReadyDecision;
    try {
      decision = policy.ready(viewOf(st));
    } catch (e) {
      report(e, 'batch');
      return fallback;
    }
    if (decision.kind === 'wait') return decision;
    let cursor = 0;
    const valid =
      decision.batch.length > 0 &&
      decision.batch[0] === st.pending[0]!.mail &&
      decision.batch.every((m) => {
        while (cursor < st.pending.length && st.pending[cursor]!.mail !== m) cursor++;
        if (cursor >= st.pending.length) return false;
        cursor++;
        return true;
      });
    if (!valid) {
      report(new Error('invalid batch selection'), 'batch');
      return fallback;
    }
    return decision;
  };

  const pump = (): void => {
    if (closed) return;
    const t = now();
    pruneMemory(t);
    const idle = [...keys.values()].filter((st) => !st.running && st.pending.length > 0);
    for (const st of idle) {
      if (ttl > 0) drop(st, st.pending.filter((e) => t - e.postedAt > ttl), 'expired', 'expired');
    }
    const candidates = idle
      .filter((st) => {
        if (st.pending.length > 0) return true;
        cleanup(st);
        return false;
      })
      .sort((a, b) => a.pending[0]!.seq - b.pending[0]!.seq);
    for (const st of candidates) {
      if (runningCount >= options.maxConcurrentTurns) return;
      const decision = decideReady(st);
      if (decision.kind === 'run') {
        start(st, decision.batch);
        continue;
      }
      clearTimer(st);
      if (decision.until !== undefined) {
        st.cancelTimer = setTimer(() => {
          st.cancelTimer = undefined;
          schedulePump();
        }, Math.max(0, decision.until - t));
      }
    }
  };

  const staleCheck = (st: KeyState, running: RunningState): InboxStaleVerdict => {
    if (running.discarded) return running.discarded;
    if (st.running !== running || !policy.staleOf) return FRESH;
    let decision: InboxStaleDecision;
    try {
      decision = policy.staleOf({ ...viewOf(st), running: runningView(running) });
    } catch (e) {
      report(e, 'staleOf');
      return FRESH;
    }
    if (decision.kind !== 'discard') return decision;
    const anchor = st.pending.findIndex((e) => e.mail.id === decision.carryInto);
    if (anchor < 0) {
      report(new Error(`stale carry target ${decision.carryInto} is not queued`), 'staleOf');
      return FRESH;
    }
    const t = now();
    const carried = running.batch
      .filter((e) => !running.requeued.has(e.mail.id))
      .map((e): InboxEntry => ({ mail: e.mail, seq: e.seq, postedAt: t, carriedInto: decision.carryInto }));
    st.pending.splice(anchor, 0, ...carried);
    queuedCount += carried.length;
    for (const e of carried) running.requeued.add(e.mail.id);
    running.discarded = Object.freeze({ kind: 'discard', senders: Object.freeze([...decision.senders]) });
    return running.discarded;
  };

  const start = (st: KeyState, selected: readonly Mail[]): void => {
    clearTimer(st);
    const chosen = new Set(selected);
    const entries = st.pending.filter((e) => chosen.has(e.mail));
    st.pending = st.pending.filter((e) => !chosen.has(e.mail));
    queuedCount -= entries.length;
    const t = now();
    const running: RunningState = {
      batch: entries,
      controller: new AbortController(),
      startedAt: t,
      startSeq: seq,
      delivered: false,
      acted: false,
      requeued: new Set(),
    };
    const facts = Object.freeze({
      queuedMs: Math.max(0, t - Math.min(...entries.map((e) => e.postedAt))),
      mergedMessages: entries.length,
      supersededPrevious: entries.some((e) => e.superseded === true),
      carried: entries.some((e) => e.carriedInto !== undefined),
      evicted: st.evicted,
    });
    st.evicted = 0;
    st.running = running;
    runningCount++;
    const batch = entries.map((e) => e.mail);
    const control: ActorTurnControl = {
      facts,
      markDelivered: () => { running.delivered = true; },
      markActed: () => { running.acted = true; },
      staleCheck: () => staleCheck(st, running),
    };

    const p: Promise<void> = (async () => {
      let result: ActorTurnResult;
      try {
        result = await options.run(st.actor, batch, running.controller.signal, control);
      } catch (e) {
        result = { status: 'failed', content: e instanceof Error ? e.message : String(e) };
      }
      if (running.controller.signal.aborted && result.status !== 'cancelled') {
        result = { status: 'cancelled', content: result.content };
      }
      lastTurns.set(keyId(st.actor, st.lane), { batch, endedAt: now() });
      const answered = batch.filter((m) => !running.requeued.has(m.id));
      if (answered.length > 0) await notify(keyOf(st, answered[0]), answered, result);
    })().finally(() => {
      st.running = undefined;
      runningCount--;
      cleanup(st);
      settling.delete(p);
      if (!closed) schedulePump();
      checkIdle();
    });
    settling.add(p);
  };

  const decidePost = (st: KeyState, entry: InboxEntry): InboxPostDecision => {
    if (!policy.onPost) return { kind: 'enqueue' };
    try {
      return policy.onPost(entry, viewOf(st));
    } catch (e) {
      report(e, 'onPost');
      return { kind: 'enqueue' };
    }
  };

  return {
    post(mail: Mail): PostResult {
      if (closed) return { accepted: false, code: 'mailbox_closed', message: 'mailbox is closed' };
      const lane = laneOf(mail);
      const id = keyId(mail.to, lane);
      const st: KeyState = keys.get(id) ?? { actor: mail.to, lane, pending: [], evicted: 0, lastEngagement: mail.engagementId };
      const entry: InboxEntry = { mail, seq, postedAt: now() };
      const decision = decidePost(st, entry);

      if (decision.kind === 'reject') return { accepted: false, code: decision.code, message: decision.message };

      if (decision.kind === 'stop') {
        st.running?.controller.abort('stopped');
        const senders = new Set(decision.cancelSenders);
        drop(st, st.pending.filter((e) => senders.has(senderOf(e.mail))), 'stopped', 'stopped');
        cleanup(st);
        checkIdle();
        return { accepted: true, position: 0, disposition: 'stopped' };
      }

      const evict = decision.kind === 'enqueue' && decision.evict ? new Set(decision.evict) : undefined;
      const evicted = evict ? st.pending.filter((e) => evict.has(e.mail.id)) : [];
      if (st.pending.length - evicted.length >= options.maxQueuedPerKey) {
        return { accepted: false, code: 'queue_full', message: `queue full for ${mail.to} in ${lane}` };
      }
      if (!keys.has(id)) keys.set(id, st);
      st.lastEngagement = mail.engagementId;
      seq++;

      let position: number;
      let disposition: 'queued' | 'merged' | 'superseded';
      const running = st.running;
      if (decision.kind === 'supersede' && running) {
        running.controller.abort('superseded');
        const t = entry.postedAt;
        const requeued = running.batch
          .filter((e) => !running.requeued.has(e.mail.id))
          .map((e): InboxEntry => ({ mail: e.mail, seq: e.seq, postedAt: t, superseded: true }));
        for (const e of requeued) running.requeued.add(e.mail.id);
        const fresh: InboxEntry = { ...entry, superseded: true };
        st.pending.unshift(...requeued, fresh);
        queuedCount += requeued.length + 1;
        position = requeued.length + 1;
        disposition = 'superseded';
      } else {
        if (evicted.length > 0) {
          st.evicted += evicted.length;
          drop(st, evicted, 'evicted', 'evicted');
        }
        st.pending.push(entry);
        queuedCount++;
        position = st.pending.length;
        disposition = decision.kind === 'enqueue' && decision.merged ? 'merged' : 'queued';
      }
      schedulePump();
      return { accepted: true, position, disposition };
    },

    cancel(mailId: MailId, reason?: string): boolean {
      for (const st of keys.values()) {
        const i = st.pending.findIndex((e) => e.mail.id === mailId);
        if (i >= 0) {
          drop(st, [st.pending[i]!], 'cancelled', reason);
          cleanup(st);
          return true;
        }
        const running = st.running;
        if (running && !running.requeued.has(mailId) && running.batch.some((e) => e.mail.id === mailId)) {
          running.controller.abort(reason ?? 'cancelled');
          return true;
        }
      }
      return false;
    },

    cancelSender(key: Pick<MailboxKey, 'actor' | 'lane'>, senderId: string, reason: InboxDropReason = 'cancelled'): number {
      const st = keys.get(keyId(key.actor, key.lane));
      if (!st) return 0;
      const dropped = st.pending.filter((e) => senderOf(e.mail) === senderId);
      drop(st, dropped, reason, reason);
      cleanup(st);
      return dropped.length;
    },

    idle(): Promise<void> {
      if (runningCount === 0 && queuedCount === 0 && notifying === 0) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },

    async close(reason?: string): Promise<void> {
      closed = true;
      for (const st of [...keys.values()]) {
        clearTimer(st);
        drop(st, st.pending.slice(), 'closed', reason);
        if (st.running) st.running.controller.abort(reason ?? 'closed');
        else cleanup(st);
      }
      while (settling.size > 0) await Promise.all([...settling]);
      checkIdle();
    },
  };
}
