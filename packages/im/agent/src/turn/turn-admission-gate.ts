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
 * At most one turn runs per session; the queue is bounded by
 * `maxQueuedTurns` and entries older than `queueTtlMs` expire. The gate only
 * orders admission — the turn itself still runs through `AgentRuntime` and
 * `AgentTurnCoordinator` with a plain `new` intent.
 */
import { TriggerCancelledError } from './trigger-cancelled-error.js';
import { TurnSupersededError } from './prompt-controller.js';

export interface TurnAdmissionGateOptions {
  /** Queued (not yet running) turns allowed per session. */
  readonly maxQueuedTurns: number;
  /** A queued turn older than this is dropped instead of run. `0` disables expiry. */
  readonly queueTtlMs: number;
  /** When true, a new message from the running turn's sender replaces that turn. */
  readonly supersedeSameSender: boolean;
  readonly now?: () => number;
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
}

/** Facts about how a turn was admitted; recorded on its TurnTrace. */
export interface TurnAdmissionFacts {
  /** Milliseconds spent waiting for an earlier turn of the session. */
  readonly queuedMs: number;
  /** Number of user messages folded into this turn (1 = no merge). */
  readonly mergedMessages: number;
  /** True when this turn replaced the sender's own unanswered turn. */
  readonly supersededPrevious: boolean;
}

export type TurnAdmission =
  | Readonly<{
      kind: 'run';
      text: string;
      facts: TurnAdmissionFacts;
      /** Aborted when the turn is superseded or stopped by the gate. */
      signal: AbortSignal;
      /** Call once a reply has been delivered; later messages then queue instead of superseding. */
      markDelivered: () => void;
      /** Must be called exactly once when the turn ends. */
      release: () => void;
    }>
  | Readonly<{ kind: 'merged' }>
  | Readonly<{ kind: 'rejected'; reason: 'queue_full' | 'expired' | 'stopped' }>;

export type TurnStopResult = 'stopped' | 'not_running' | 'forbidden';

interface QueuedTurn {
  readonly senderId: string;
  readonly texts: string[];
  readonly enqueuedAt: number;
  plainText: boolean;
  supersededPrevious: boolean;
  settle: (admission: TurnAdmission) => void;
}

interface RunningTurn {
  readonly senderId: string;
  readonly texts: readonly string[];
  readonly plainText: boolean;
  readonly controller: AbortController;
  delivered: boolean;
}

interface SessionState {
  running?: RunningTurn;
  readonly queue: QueuedTurn[];
}

export class TurnAdmissionGate {
  readonly #sessions = new Map<string, SessionState>();
  readonly #options: Required<TurnAdmissionGateOptions>;

  constructor(options: TurnAdmissionGateOptions) {
    this.#options = {
      maxQueuedTurns: Math.max(0, Math.floor(options.maxQueuedTurns)),
      queueTtlMs: Math.max(0, options.queueTtlMs),
      supersedeSameSender: options.supersedeSameSender,
      now: options.now ?? Date.now,
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

    if (!running && state.queue.length === 0) {
      return Promise.resolve(this.#start(request.sessionKey, state, {
        senderId: request.senderId,
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
      && !running.delivered
      && running.plainText
      && request.plainText
      && !ownQueued
    ) {
      running.controller.abort(new TurnSupersededError(request.sessionKey));
      return this.#enqueue(state, {
        senderId: request.senderId,
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
      texts: [request.text],
      plainText: request.plainText,
      supersededPrevious: false,
    }, 'back');
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
    for (let index = state.queue.length - 1; index >= 0; index -= 1) {
      const entry = state.queue[index]!;
      if (entry.senderId !== senderId && entry.senderId !== running.senderId) continue;
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
        entry.settle(Object.freeze({ kind: 'rejected', reason: 'stopped' }));
      }
    }
    this.#sessions.clear();
  }

  #state(sessionKey: string): SessionState {
    let state = this.#sessions.get(sessionKey);
    if (!state) {
      state = { queue: [] };
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
      texts: readonly string[];
      plainText: boolean;
      queuedMs: number;
      supersededPrevious: boolean;
    }>,
  ): TurnAdmission {
    const running: RunningTurn = {
      senderId: turn.senderId,
      texts: Object.freeze([...turn.texts]),
      plainText: turn.plainText,
      controller: new AbortController(),
      delivered: false,
    };
    state.running = running;
    let released = false;
    return Object.freeze({
      kind: 'run' as const,
      text: turn.texts.filter((text) => text.trim()).join('\n'),
      facts: Object.freeze({
        queuedMs: turn.queuedMs,
        mergedMessages: turn.texts.length,
        supersededPrevious: turn.supersededPrevious,
      }),
      signal: running.controller.signal,
      markDelivered: () => { running.delivered = true; },
      release: () => {
        if (released) return;
        released = true;
        if (state.running === running) state.running = undefined;
        this.#pump(sessionKey, state);
      },
    });
  }

  #pump(sessionKey: string, state: SessionState): void {
    if (state.running) return;
    const now = this.#options.now();
    while (state.queue.length > 0) {
      const next = state.queue.shift()!;
      if (this.#options.queueTtlMs > 0 && now - next.enqueuedAt > this.#options.queueTtlMs) {
        next.settle(Object.freeze({ kind: 'rejected', reason: 'expired' }));
        continue;
      }
      next.settle(this.#start(sessionKey, state, {
        senderId: next.senderId,
        texts: next.texts,
        plainText: next.plainText,
        queuedMs: now - next.enqueuedAt,
        supersededPrevious: next.supersededPrevious,
      }));
      return;
    }
    if (this.#sessions.get(sessionKey) === state) this.#sessions.delete(sessionKey);
  }
}

function findLast<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index]!)) return items[index];
  }
  return undefined;
}
