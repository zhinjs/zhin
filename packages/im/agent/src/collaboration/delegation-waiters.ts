/**
 * #1250 delegate-result-double-reply — a delegation the delegating turn waits for.
 *
 * `delegate` waits a short while within the turn for the delegated result. The harness still posts the
 * result as a `result` mail to the delegator's lane (queued behind the running turn); the host Mailbox
 * reports each admitted result here, so a waiting `delegate` receives it at once.
 *
 * A result read this way is only *pending* until the reading turn succeeded (its answer reached the human,
 * or the actor turn completed): then {@link DelegatedReads.commit} marks it consumed, and when its mail later
 * reaches the delegator it is not run again, because the model already answered from it. When the reading
 * turn fails, times out, is superseded or stopped, {@link DelegatedReads.revoke} drops the mark and the
 * result wakes the delegator as before. A result nobody waits for runs as before.
 *
 * Module-internal state keyed by the harness; nothing here is public API.
 */
import type { Harness, Mail } from '@zhin.js/harness';

/** Upper bound of remembered consumed marks per harness (results whose mail never reached a lane). */
const MAX_REMEMBERED = 512;
/** An early result (admitted before its waiter registered) is kept this long at most. */
const EARLY_RESULT_TTL_MS = 60_000;
/** How long a lane waits for the reading turn to decide on a pending read before running the result. */
const PENDING_READ_SETTLE_MS = 120_000;

interface PendingRead {
  state: 'pending' | 'consumed';
  readonly settled: Promise<void>;
  readonly settle: () => void;
}

interface Registry {
  readonly waiters: Map<string, (mail: Mail) => void>;
  /** delegation mail id → its admitted result, while a `delegate` of this harness is still sending. */
  readonly recent: Map<string, Readonly<{ mail: Mail; at: number }>>;
  /** Result mail ids a waiting delegate returned to its model: pending until the reading turn decides. */
  readonly reads: Map<string, PendingRead>;
  /** `delegate` calls between `harness.send` and registering their waiter. */
  sending: number;
}

const registries = new WeakMap<Harness, Registry>();

function registryOf(harness: Harness): Registry {
  let registry = registries.get(harness);
  if (!registry) {
    registry = { waiters: new Map(), recent: new Map(), reads: new Map(), sending: 0 };
    registries.set(harness, registry);
  }
  return registry;
}

function pruneRecent(registry: Registry, now = Date.now()): void {
  if (registry.sending === 0) {
    registry.recent.clear();
    return;
  }
  for (const [id, entry] of registry.recent) {
    if (now - entry.at > EARLY_RESULT_TTL_MS) registry.recent.delete(id);
  }
}

/** The harness admitted `mail`; a result wakes the `delegate` waiting for it. */
export function noteResultAdmitted(harness: Harness, mail: Mail): void {
  if (mail.body.kind !== 'result') return;
  const registry = registryOf(harness);
  const delegation = mail.body.inReplyTo;
  const waiter = registry.waiters.get(delegation);
  if (waiter) {
    registry.waiters.delete(delegation);
    waiter(mail);
    return;
  }
  // Only a `delegate` still inside `harness.send` can register for this result later; nothing else is kept.
  pruneRecent(registry);
  if (registry.sending > 0) registry.recent.set(delegation, Object.freeze({ mail, at: Date.now() }));
}

/**
 * A `delegate` is about to send: a result admitted before its waiter registers is kept for it.
 * Call `end()` once the waiter registered (or the delegate does not wait).
 */
export function beginDelegationSend(harness: Harness): Readonly<{ end(delegationId?: string): void }> {
  const registry = registryOf(harness);
  registry.sending += 1;
  let ended = false;
  return Object.freeze({
    end(delegationId?: string) {
      if (ended) return;
      ended = true;
      registry.sending = Math.max(0, registry.sending - 1);
      if (delegationId) registry.recent.delete(delegationId);
      pruneRecent(registry);
    },
  });
}

/**
 * The results one turn read through waiting `delegate` calls. Pending until the turn decides:
 * {@link commit} once its answer reached the human, {@link revoke} when it failed.
 */
export interface DelegatedReads {
  /** Records a result the turn's model received. */
  note(mail: Mail): void;
  /**
   * The turn succeeded: its reads are consumed. Returns the results committed now. `final` (the turn
   * ended) also closes the decision: a read noted later — a tool settling after the turn — is not
   * recorded, so its result mail runs at once instead of waiting {@link PENDING_READ_SETTLE_MS} for a
   * decision that never comes (#1250 第 56 批). Without it (a root turn's answer phase) later reads of the
   * same turn stay pending until its next decision.
   */
  commit(options?: Readonly<{ final?: boolean }>): readonly Mail[];
  /** The turn failed: its reads wake the delegator as usual. */
  revoke(): void;
}

/** {@link DelegatedReads} of one turn. */
export function createDelegatedReads(harness: Harness): DelegatedReads {
  const registry = registryOf(harness);
  const mine = new Map<string, Mail>();
  let decided = false;
  return Object.freeze({
    note(mail: Mail) {
      if (mail.body.kind !== 'result') return;
      if (decided) {
        // The turn already ended (committed finally or revoked): the model never answered from this
        // read, so its result mail runs as usual.
        return;
      }
      if (registry.reads.has(mail.id)) return;
      let settle!: () => void;
      const settled = new Promise<void>((resolve) => { settle = resolve; });
      registry.reads.set(mail.id, { state: 'pending', settled, settle });
      mine.set(mail.id, mail);
      while (registry.reads.size > MAX_REMEMBERED) {
        const oldest = registry.reads.keys().next().value;
        if (oldest === undefined) break;
        registry.reads.get(oldest)?.settle();
        registry.reads.delete(oldest);
      }
    },
    commit(options) {
      if (options?.final) decided = true;
      const committed: Mail[] = [];
      for (const [id, mail] of mine) {
        const read = registry.reads.get(id);
        if (!read || read.state !== 'pending') continue;
        read.state = 'consumed';
        read.settle();
        committed.push(mail);
      }
      mine.clear();
      return committed;
    },
    revoke() {
      decided = true;
      for (const id of mine.keys()) {
        const read = registry.reads.get(id);
        if (!read || read.state !== 'pending') continue;
        registry.reads.delete(id);
        read.settle();
      }
      mine.clear();
    },
  });
}

/**
 * Waits up to `waitMs` for the result of `delegationId`. Resolves with the result mail (noted in `reads`)
 * or `undefined` on timeout / abort; the result then arrives as a result mail as usual.
 */
export function awaitDelegatedResult(
  harness: Harness,
  delegationId: string,
  waitMs: number,
  signal?: AbortSignal,
  reads?: DelegatedReads,
): Promise<Mail | undefined> {
  const registry = registryOf(harness);
  const received = (mail: Mail): Mail => {
    reads?.note(mail);
    return mail;
  };
  const early = registry.recent.get(delegationId);
  if (early) {
    registry.recent.delete(delegationId);
    return Promise.resolve(received(early.mail));
  }
  if (waitMs <= 0 || signal?.aborted) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const stop = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      if (registry.waiters.get(delegationId) === take) registry.waiters.delete(delegationId);
      resolve(undefined);
    };
    const take = (mail: Mail): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      resolve(received(mail));
    };
    const timer = setTimeout(stop, waitMs);
    timer.unref?.();
    signal?.addEventListener('abort', stop, { once: true });
    registry.waiters.set(delegationId, take);
  });
}

/**
 * True (once) when `mail` is a result a waiting `delegate` already returned to a model whose turn
 * succeeded. A read still pending is awaited (bounded); a revoked one runs as usual. The record is
 * removed either way.
 */
export async function takeConsumedResult(harness: Harness, mail: Mail): Promise<boolean> {
  if (mail.body.kind !== 'result') return false;
  const registry = registryOf(harness);
  const read = registry.reads.get(mail.id);
  if (!read) return false;
  if (read.state === 'pending') {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      read.settled,
      new Promise<void>((resolve) => { timer = setTimeout(resolve, PENDING_READ_SETTLE_MS); timer.unref?.(); }),
    ]);
    clearTimeout(timer);
  }
  const current = registry.reads.get(mail.id);
  registry.reads.delete(mail.id);
  return current?.state === 'consumed';
}
