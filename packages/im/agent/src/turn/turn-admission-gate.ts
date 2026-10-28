/**
 * Per-session admission for ordinary IM turns (#725).
 *
 * Decides what happens to a message that arrives while the session is already
 * answering someone:
 *
 * - **Explicit stop** from the turn's initiator (or the master) aborts the
 *   running turn and drops that sender's queued messages.
 * - **Same sender, nothing delivered yet** (supersede mode): the running turn
 *   is aborted and its text is carried into one fresh turn together with the
 *   new message, so nothing the user typed is lost.
 * - **Same sender, already queued**: the new text is merged into the queued
 *   turn instead of producing another reply (burst coalescing).
 * - **Anyone else**: queued FIFO behind the running turn. A member never
 *   aborts, or merges into, another member's turn, so replies cannot cross
 *   principals or inherit someone else's permissions.
 *
 * - **Merge window** (ADR 0038 §1, opt-in via `merge`): mergeable group
 *   messages from different senders wait in one window and are answered by a
 *   single turn once the window goes quiet (`quietMs`) or hits `maxWaitMs`.
 *   The window holds at most `maxSenders` senders; the next sender opens the
 *   following window. Only the gate decides *how many* turns run — who may
 *   do what in a merged turn is the caller's job (`participants`).
 * - **Stale reply** (ADR 0038 §4): the running turn is never interrupted, but
 *   when one of its senders follows up into a merge window before anything
 *   was delivered, `staleCheck()` tells the caller to drop the reply — unless
 *   the turn already acted (`markActed`) or a sender's reply was dropped once
 *   already (starvation guard). A dropped turn's messages move into the
 *   follow-up's window so the next turn answers old and new together.
 *
 * At most one turn runs per session; the queue is bounded by
 * `maxQueuedTurns` and entries older than `queueTtlMs` expire. The gate only
 * orders admission — the turn itself still runs through `AgentRuntime` and
 * `AgentTurnCoordinator` with a plain `new` intent.
 */
import { TriggerCancelledError } from './trigger-cancelled-error.js';
import { TurnSupersededError } from './prompt-controller.js';
import type { TurnAccessContext } from './turn-ingress.js';

export interface TurnAdmissionGateOptions {
  /** Queued (not yet running) turns allowed per session. */
  readonly maxQueuedTurns: number;
  /** A queued turn older than this is dropped instead of run. `0` disables expiry. */
  readonly queueTtlMs: number;
  /** When true, a new message from the running turn's sender replaces that turn. */
  readonly supersedeSameSender: boolean;
  /** ADR 0038 merge window; omitted = disabled (every sender gets its own turn). */
  readonly merge?: TurnMergeWindowOptions;
  readonly now?: () => number;
  /** Schedules a window check; returns a cancel function. Defaults to an unref'd `setTimeout`. */
  readonly setTimer?: (callback: () => void, delayMs: number) => () => void;
}

export interface TurnMergeWindowOptions {
  /** Flush once no new message joined the window for this long. */
  readonly quietMs: number;
  /** Flush at the latest this long after the window opened. */
  readonly maxWaitMs: number;
  /** Senders one window may hold; further senders open the next window. */
  readonly maxSenders: number;
}

export const DEFAULT_MAX_QUEUED_TURNS = 5;

export interface TurnAdmissionRequest {
  readonly sessionKey: string;
  readonly senderId: string;
  readonly text: string;
  /**
   * Plain text without media, quotes or forwards. Only plain-text messages are
   * merged, because a merged turn keeps the first message's attachments only.
   */
  readonly plainText: boolean;
  /**
   * May join a merge window (ADR 0038 §1): the caller has checked it is a
   * plain-text group message from a non-master sender, not a command, stop or
   * approval. Ignored while the gate has no `merge` options.
   */
  readonly mergeable?: boolean;
  /** Display name for the merged turn text. */
  readonly senderName?: string;
  /** Platform message id; a merged turn lists it so the reply can point at it (ADR 0038 §3). */
  readonly messageId?: string;
  /**
   * The sender's own access (ADR 0038 §2). Carried into `participants` so a
   * merged turn can narrow capabilities to what every member may use.
   */
  readonly access?: TurnAccessContext;
  /** Called synchronously when the message joins a merge window (audit `merge_window_joined`). */
  readonly onWindowJoined?: (window: TurnMergeWindowSnapshot) => void;
}

/** One sender's messages in a merged turn, in arrival order. */
export interface TurnParticipant {
  readonly senderId: string;
  readonly senderName?: string;
  readonly texts: readonly string[];
  /** Merge-window participants only: ids of the messages behind `texts`, when known. */
  readonly messageIds?: readonly string[];
  /** The access given with the sender's first message, when the caller passed one. */
  readonly access?: TurnAccessContext;
}

export interface TurnMergeWindowSnapshot {
  /** Senders in the window, in join order. */
  readonly senders: readonly string[];
  readonly messages: number;
}

/** Facts about how a turn was admitted; recorded on its TurnTrace. */
export interface TurnAdmissionFacts {
  /** Milliseconds spent waiting for an earlier turn of the session. */
  readonly queuedMs: number;
  /** Number of user messages folded into this turn (1 = no merge). */
  readonly mergedMessages: number;
  /** True when this turn replaced the sender's own unanswered turn. */
  readonly supersededPrevious: boolean;
  /** Present when the turn was flushed from a merge window. */
  readonly mergeWindow?: TurnMergeWindowSnapshot & Readonly<{ waitedMs: number }>;
}

/**
 * Pre-send verdict (ADR 0038 §4). `discard` drops the reply; `send` with a
 * reason means the reply is stale but goes out anyway. `senders` are the
 * turn's senders who followed up while it ran.
 */
export type TurnStaleVerdict =
  | Readonly<{ kind: 'fresh' }>
  | Readonly<{ kind: 'discard'; senders: readonly string[] }>
  | Readonly<{ kind: 'send'; senders: readonly string[]; reason: 'acted' | 'starvation' }>;

export type TurnAdmission =
  | Readonly<{
      kind: 'run';
      text: string;
      facts: TurnAdmissionFacts;
      /**
       * Whose messages this turn answers. One entry for an ordinary turn; a
       * merged turn lists every sender (the carrier whose handler runs the turn
       * may be absent when it stopped its own messages).
       */
      participants: readonly TurnParticipant[];
      /** Aborted when the turn is superseded or stopped by the gate. */
      signal: AbortSignal;
      /** Call once a reply has been delivered; later messages then queue instead of superseding. */
      markDelivered: () => void;
      /** Call when the turn did something that must be reported (tool call, hard gate). */
      markActed: () => void;
      /**
       * Ask before each send. The first `discard` moves this turn's messages
       * into the follow-up window; later calls keep answering `discard`.
       */
      staleCheck: () => TurnStaleVerdict;
      /** Must be called exactly once when the turn ends. */
      release: () => void;
    }>
  | Readonly<{ kind: 'merged' }>
  | Readonly<{ kind: 'rejected'; reason: 'queue_full' | 'expired' | 'stopped' }>;

export type TurnStopResult = 'stopped' | 'not_running' | 'forbidden';

interface QueuedTurn {
  readonly senderId: string;
  readonly senderName?: string;
  readonly access?: TurnAccessContext;
  readonly texts: string[];
  readonly enqueuedAt: number;
  plainText: boolean;
  supersededPrevious: boolean;
  /** Set for a merge window; `texts` is then unused. */
  readonly window?: MergeWindow;
  settle: (admission: TurnAdmission) => void;
}

interface MergeWindow {
  readonly participants: Array<{
    senderId: string;
    senderName?: string;
    texts: string[];
    messageIds: string[];
    access?: TurnAccessContext;
  }>;
  lastJoinedAt: number;
  cancelTimer?: () => void;
}

interface RunningTurn {
  readonly senderId: string;
  readonly participants: readonly TurnParticipant[];
  readonly texts: readonly string[];
  readonly plainText: boolean;
  /** Merged turns are never superseded by one of their senders. */
  readonly merged: boolean;
  readonly controller: AbortController;
  delivered: boolean;
  /** A tool ran or the hard gate was hit: the reply must go out (ADR 0038 §4). */
  acted: boolean;
  /** One of the senders already had a reply dropped: never drop again (starvation guard). */
  readonly discardedBefore: boolean;
  /** Senders of this turn who followed up into a merge window while it ran. */
  readonly staleSenders: Set<string>;
  discarded: boolean;
}

interface SessionState {
  running?: RunningTurn;
  readonly queue: QueuedTurn[];
  /**
   * Senders whose reply was dropped and who have not been answered since.
   * Emptied as their next turn starts; dropped with the idle session.
   */
  readonly discardedSenders: Set<string>;
}

type ResolvedOptions = Omit<Required<TurnAdmissionGateOptions>, 'merge'> & { merge?: TurnMergeWindowOptions };

export class TurnAdmissionGate {
  readonly #sessions = new Map<string, SessionState>();
  readonly #options: ResolvedOptions;

  constructor(options: TurnAdmissionGateOptions) {
    this.#options = {
      maxQueuedTurns: Math.max(0, Math.floor(options.maxQueuedTurns)),
      queueTtlMs: Math.max(0, options.queueTtlMs),
      supersedeSameSender: options.supersedeSameSender,
      now: options.now ?? Date.now,
      setTimer: options.setTimer ?? defaultSetTimer,
      ...(options.merge ? {
        merge: {
          quietMs: Math.max(0, options.merge.quietMs),
          maxWaitMs: Math.max(0, options.merge.maxWaitMs),
          maxSenders: Math.max(1, Math.floor(options.merge.maxSenders)),
        },
      } : {}),
    };
  }

  /** Sender of the turn currently running on the session, if any. */
  runningSender(sessionKey: string): string | undefined {
    return this.#sessions.get(sessionKey)?.running?.senderId;
  }

  queuedTurns(sessionKey: string): number {
    return this.#sessions.get(sessionKey)?.queue.length ?? 0;
  }

  admit(request: TurnAdmissionRequest): Promise<TurnAdmission> {
    const state = this.#state(request.sessionKey);
    const running = state.running;

    if (this.#options.merge && request.mergeable && request.plainText) {
      return this.#admitToWindow(request, state, this.#options.merge);
    }

    if (!running && state.queue.length === 0) {
      return Promise.resolve(this.#start(request.sessionKey, state, {
        senderId: request.senderId,
        senderName: request.senderName,
        access: request.access,
        texts: [request.text],
        plainText: request.plainText,
        queuedMs: 0,
        supersededPrevious: false,
      }));
    }

    const ownQueued = findLast(state.queue, (entry) => entry.senderId === request.senderId);
    if (ownQueued && ownQueued.plainText && request.plainText) {
      ownQueued.texts.push(request.text);
      return Promise.resolve(Object.freeze({ kind: 'merged' as const }));
    }

    if (
      this.#options.supersedeSameSender
      && running
      && running.senderId === request.senderId
      && !running.merged
      && !running.delivered
      && running.plainText
      && request.plainText
      && !ownQueued
    ) {
      running.controller.abort(new TurnSupersededError(request.sessionKey));
      return this.#enqueue(state, {
        senderId: request.senderId,
        senderName: request.senderName,
        access: request.access,
        texts: [...running.texts, request.text],
        plainText: true,
        supersededPrevious: true,
      }, 'front');
    }

    if (state.queue.length >= this.#options.maxQueuedTurns) {
      return Promise.resolve(Object.freeze({ kind: 'rejected' as const, reason: 'queue_full' as const }));
    }
    return this.#enqueue(state, {
      senderId: request.senderId,
      senderName: request.senderName,
      access: request.access,
      texts: [request.text],
      plainText: request.plainText,
      supersededPrevious: false,
    }, 'back');
  }

  /**
   * ADR 0038 §1: a sender already waiting in a window appends to their entry
   * (burst); otherwise the newest window with room takes them; otherwise a new
   * window opens behind the queue. Only the window's first sender (the
   * carrier) gets the `run` admission; everyone else is answered by it.
   */
  #admitToWindow(
    request: TurnAdmissionRequest,
    state: SessionState,
    merge: TurnMergeWindowOptions,
  ): Promise<TurnAdmission> {
    const now = this.#options.now();
    const windows = state.queue.filter((entry) => entry.window);
    let target = findLast(windows, (entry) => entry.window!.participants.some((p) => p.senderId === request.senderId));
    if (target) {
      const own = target.window!.participants.find((p) => p.senderId === request.senderId)!;
      own.texts.push(request.text);
      if (request.messageId) own.messageIds.push(request.messageId);
    } else {
      target = findLast(windows, (entry) => entry.window!.participants.length < merge.maxSenders);
      target?.window!.participants.push(windowParticipant(request));
    }
    if (target) {
      markStale(state.running, request.senderId);
      const window = target.window!;
      window.lastJoinedAt = now;
      request.onWindowJoined?.(snapshotWindow(window));
      this.#armWindow(request.sessionKey, state, target, merge);
      return Promise.resolve(Object.freeze({ kind: 'merged' as const }));
    }

    if (state.queue.length >= this.#options.maxQueuedTurns) {
      return Promise.resolve(Object.freeze({ kind: 'rejected' as const, reason: 'queue_full' as const }));
    }
    const window: MergeWindow = {
      participants: [windowParticipant(request)],
      lastJoinedAt: now,
    };
    const opened = this.#enqueue(state, {
      senderId: request.senderId,
      senderName: request.senderName,
      access: request.access,
      texts: [],
      plainText: true,
      supersededPrevious: false,
      window,
    }, 'back');
    markStale(state.running, request.senderId);
    request.onWindowJoined?.(snapshotWindow(window));
    this.#armWindow(request.sessionKey, state, state.queue[state.queue.length - 1]!, merge);
    return opened;
  }

  /** (Re)schedules the flush check of a window at the head of an idle session. */
  #armWindow(sessionKey: string, state: SessionState, entry: QueuedTurn, merge: TurnMergeWindowOptions): void {
    const window = entry.window!;
    window.cancelTimer?.();
    window.cancelTimer = undefined;
    if (state.running || state.queue[0] !== entry) return;
    const now = this.#options.now();
    const due = Math.min(window.lastJoinedAt + merge.quietMs, entry.enqueuedAt + merge.maxWaitMs);
    if (due <= now) {
      this.#pump(sessionKey, state);
      return;
    }
    window.cancelTimer = this.#options.setTimer(() => {
      window.cancelTimer = undefined;
      if (this.#sessions.get(sessionKey) !== state) return;
      this.#pump(sessionKey, state);
    }, due - now);
  }

  /**
   * Explicit stop. Only the running turn's sender or a master may stop it;
   * the stopping sender's queued messages are dropped as well.
   */
  stop(sessionKey: string, senderId: string, isMaster: boolean): TurnStopResult {
    const state = this.#sessions.get(sessionKey);
    const running = state?.running;
    if (!state || !running) return 'not_running';
    if (running.senderId !== senderId && !isMaster) return 'forbidden';
    running.controller.abort(new TriggerCancelledError(sessionKey));
    const dropped = (id: string) => id === senderId || id === running.senderId;
    for (let index = state.queue.length - 1; index >= 0; index -= 1) {
      const entry = state.queue[index]!;
      if (entry.window) {
        // Drop only the stopping senders' messages; the rest of the window stays.
        const participants = entry.window.participants;
        for (let p = participants.length - 1; p >= 0; p -= 1) {
          if (dropped(participants[p]!.senderId)) participants.splice(p, 1);
        }
        if (participants.length > 0) continue;
        entry.window.cancelTimer?.();
      } else if (!dropped(entry.senderId)) {
        continue;
      }
      state.queue.splice(index, 1);
      entry.settle(Object.freeze({ kind: 'rejected', reason: 'stopped' }));
    }
    return 'stopped';
  }

  /** Rejects every queued turn and aborts running ones (generation shutdown). */
  dispose(): void {
    for (const [sessionKey, state] of this.#sessions) {
      state.running?.controller.abort(new TriggerCancelledError(sessionKey));
      for (const entry of state.queue.splice(0)) {
        entry.window?.cancelTimer?.();
        entry.settle(Object.freeze({ kind: 'rejected', reason: 'stopped' }));
      }
    }
    this.#sessions.clear();
  }

  #state(sessionKey: string): SessionState {
    let state = this.#sessions.get(sessionKey);
    if (!state) {
      state = { queue: [], discardedSenders: new Set() };
      this.#sessions.set(sessionKey, state);
    }
    return state;
  }

  #enqueue(
    state: SessionState,
    entry: Omit<QueuedTurn, 'enqueuedAt' | 'settle'>,
    position: 'front' | 'back',
  ): Promise<TurnAdmission> {
    return new Promise<TurnAdmission>((resolve) => {
      const queued: QueuedTurn = { ...entry, enqueuedAt: this.#options.now(), settle: resolve };
      if (position === 'front') state.queue.unshift(queued);
      else state.queue.push(queued);
    });
  }

  #start(
    sessionKey: string,
    state: SessionState,
    turn: Readonly<{
      senderId: string;
      senderName?: string;
      access?: TurnAccessContext;
      texts: readonly string[];
      plainText: boolean;
      queuedMs: number;
      supersededPrevious: boolean;
      window?: MergeWindow;
    }>,
  ): TurnAdmission {
    const participants: readonly TurnParticipant[] = Object.freeze(turn.window
      ? turn.window.participants.map((p) => Object.freeze({
        senderId: p.senderId,
        ...(p.senderName ? { senderName: p.senderName } : {}),
        texts: Object.freeze([...p.texts]),
        ...(p.messageIds.length ? { messageIds: Object.freeze([...p.messageIds]) } : {}),
        ...(p.access ? { access: p.access } : {}),
      }))
      : [Object.freeze({
        senderId: turn.senderId,
        ...(turn.senderName ? { senderName: turn.senderName } : {}),
        texts: Object.freeze([...turn.texts]),
        ...(turn.access ? { access: turn.access } : {}),
      })]);
    const texts = participants.flatMap((p) => p.texts);
    let discardedBefore = false;
    for (const participant of participants) {
      if (state.discardedSenders.delete(participant.senderId)) discardedBefore = true;
    }
    const running: RunningTurn = {
      senderId: turn.senderId,
      participants,
      texts: Object.freeze(texts),
      plainText: turn.plainText,
      merged: turn.window !== undefined,
      controller: new AbortController(),
      delivered: false,
      acted: false,
      discardedBefore,
      staleSenders: new Set(),
      discarded: false,
    };
    state.running = running;
    let released = false;
    return Object.freeze({
      kind: 'run' as const,
      text: renderTurnText(participants),
      facts: Object.freeze({
        queuedMs: turn.queuedMs,
        mergedMessages: texts.length,
        supersededPrevious: turn.supersededPrevious,
        ...(turn.window ? {
          mergeWindow: Object.freeze({ ...snapshotWindow(turn.window), waitedMs: turn.queuedMs }),
        } : {}),
      }),
      participants,
      signal: running.controller.signal,
      markDelivered: () => { running.delivered = true; },
      markActed: () => { running.acted = true; },
      staleCheck: () => this.#staleCheck(state, running),
      release: () => {
        if (released) return;
        released = true;
        if (state.running === running) state.running = undefined;
        this.#pump(sessionKey, state);
      },
    });
  }

  #staleCheck(state: SessionState, running: RunningTurn): TurnStaleVerdict {
    const senders = Object.freeze([...running.staleSenders]);
    if (running.discarded) return Object.freeze({ kind: 'discard' as const, senders });
    // Part of the reply is already out: finish it rather than cut it in half.
    if (senders.length === 0 || running.delivered) return FRESH;
    if (running.acted) return Object.freeze({ kind: 'send' as const, senders, reason: 'acted' as const });
    if (running.discardedBefore) return Object.freeze({ kind: 'send' as const, senders, reason: 'starvation' as const });
    const target = findLast(state.queue, (entry) => entry.window?.participants.some((p) => running.staleSenders.has(p.senderId)) ?? false);
    // The follow-up already left the queue (stopped / expired): nothing would answer the old messages.
    if (!target) return FRESH;
    running.discarded = true;
    carryIntoWindow(target.window!, running.participants);
    for (const participant of running.participants) state.discardedSenders.add(participant.senderId);
    return Object.freeze({ kind: 'discard' as const, senders });
  }

  #pump(sessionKey: string, state: SessionState): void {
    if (state.running) return;
    const now = this.#options.now();
    while (state.queue.length > 0) {
      const next = state.queue[0]!;
      if (this.#options.queueTtlMs > 0 && now - next.enqueuedAt > this.#options.queueTtlMs) {
        state.queue.shift();
        next.window?.cancelTimer?.();
        next.settle(Object.freeze({ kind: 'rejected', reason: 'expired' }));
        continue;
      }
      const merge = this.#options.merge;
      if (next.window && merge) {
        const due = Math.min(next.window.lastJoinedAt + merge.quietMs, next.enqueuedAt + merge.maxWaitMs);
        if (due > now) {
          // Still filling: wait for the window (FIFO — later turns wait behind it).
          if (!next.window.cancelTimer) this.#armWindow(sessionKey, state, next, merge);
          return;
        }
        next.window.cancelTimer?.();
      }
      state.queue.shift();
      next.settle(this.#start(sessionKey, state, {
        senderId: next.senderId,
        senderName: next.senderName,
        access: next.access,
        texts: next.texts,
        plainText: next.plainText,
        queuedMs: now - next.enqueuedAt,
        supersededPrevious: next.supersededPrevious,
        window: next.window,
      }));
      return;
    }
    if (this.#sessions.get(sessionKey) === state) this.#sessions.delete(sessionKey);
  }
}

const FRESH: TurnStaleVerdict = Object.freeze({ kind: 'fresh' });

function markStale(running: RunningTurn | undefined, senderId: string): void {
  if (running?.participants.some((p) => p.senderId === senderId)) running.staleSenders.add(senderId);
}

/**
 * Puts a dropped turn's messages in front of the follow-up window so its next
 * turn answers both. Carried senders stay even past `maxSenders`: they were
 * already admitted together once and must not lose their answer.
 */
function carryIntoWindow(window: MergeWindow, carried: readonly TurnParticipant[]): void {
  const fresh = window.participants.splice(0);
  for (const old of carried) {
    const index = fresh.findIndex((p) => p.senderId === old.senderId);
    const next = index >= 0 ? fresh.splice(index, 1)[0] : undefined;
    window.participants.push({
      senderId: old.senderId,
      ...(old.senderName ?? next?.senderName ? { senderName: old.senderName ?? next?.senderName } : {}),
      texts: [...old.texts, ...(next?.texts ?? [])],
      messageIds: [...(old.messageIds ?? []), ...(next?.messageIds ?? [])],
      ...(old.access ?? next?.access ? { access: old.access ?? next?.access } : {}),
    });
  }
  window.participants.push(...fresh);
}

function windowParticipant(request: TurnAdmissionRequest): MergeWindow['participants'][number] {
  return {
    senderId: request.senderId,
    ...(request.senderName ? { senderName: request.senderName } : {}),
    texts: [request.text],
    messageIds: request.messageId ? [request.messageId] : [],
    ...(request.access ? { access: request.access } : {}),
  };
}

function snapshotWindow(window: MergeWindow): TurnMergeWindowSnapshot {
  return Object.freeze({
    senders: Object.freeze(window.participants.map((p) => p.senderId)),
    messages: window.participants.reduce((sum, p) => sum + p.texts.length, 0),
  });
}

/**
 * One sender: their messages joined as before. Several senders: one line per
 * sender so the model can tell who asked what (ADR 0038 §3 builds the full
 * merged turn context on top of `participants`).
 */
function renderTurnText(participants: readonly TurnParticipant[]): string {
  const lines = (p: TurnParticipant) => p.texts.filter((text) => text.trim());
  if (participants.length === 1) return lines(participants[0]!).join('\n');
  return participants
    .map((p) => ({ name: p.senderName?.trim() || p.senderId, texts: lines(p) }))
    .filter((p) => p.texts.length > 0)
    .map((p) => `${p.name}: ${p.texts.join('\n')}`)
    .join('\n');
}

function defaultSetTimer(callback: () => void, delayMs: number): () => void {
  const handle = setTimeout(callback, delayMs);
  handle.unref?.();
  return () => clearTimeout(handle);
}

function findLast<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index]!)) return items[index];
  }
  return undefined;
}
