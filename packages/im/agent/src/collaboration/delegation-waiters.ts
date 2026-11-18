/**
 * #1250 delegate-result-double-reply — a delegation the delegating turn waits for.
 *
 * `delegate` waits a short while within the turn for the delegated result. The harness still posts the
 * result as a `result` mail to the delegator's lane (queued behind the running turn); the host Mailbox
 * reports each admitted result here, so a waiting `delegate` receives it at once. A result that was read
 * this way is marked consumed: when its mail later reaches the delegator it is not run again, because the
 * model already answered from it. A result nobody waits for runs as before.
 *
 * Module-internal state keyed by the harness; nothing here is public API.
 */
import type { Harness, Mail } from '@zhin.js/harness';

/** Results admitted before their waiter registered, and consumed result mails, kept per harness. */
const MAX_REMEMBERED = 512;

interface Registry {
  readonly waiters: Map<string, (mail: Mail) => void>;
  /** delegation mail id → its admitted result, until a waiter takes it. */
  readonly recent: Map<string, Mail>;
  /** Result mail ids a waiting delegate already returned to its model. */
  readonly consumed: Set<string>;
}

const registries = new WeakMap<Harness, Registry>();

function registryOf(harness: Harness): Registry {
  let registry = registries.get(harness);
  if (!registry) {
    registry = { waiters: new Map(), recent: new Map(), consumed: new Set() };
    registries.set(harness, registry);
  }
  return registry;
}

function remember<T>(collection: Map<string, T> | Set<string>, key: string, value?: T): void {
  if (collection instanceof Map) collection.set(key, value as T);
  else collection.add(key);
  if (collection.size > MAX_REMEMBERED) {
    const oldest = collection.keys().next().value;
    if (oldest !== undefined) collection.delete(oldest);
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
  remember(registry.recent, delegation, mail);
}

/**
 * Waits up to `waitMs` for the result of `delegationId`. Resolves with the result mail (now consumed)
 * or `undefined` on timeout / abort; the result then arrives as a result mail as usual.
 */
export function awaitDelegatedResult(harness: Harness, delegationId: string, waitMs: number, signal?: AbortSignal): Promise<Mail | undefined> {
  const registry = registryOf(harness);
  const consume = (mail: Mail): Mail => {
    remember(registry.consumed, mail.id);
    return mail;
  };
  const early = registry.recent.get(delegationId);
  if (early) {
    registry.recent.delete(delegationId);
    return Promise.resolve(consume(early));
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
      resolve(consume(mail));
    };
    const timer = setTimeout(stop, waitMs);
    timer.unref?.();
    signal?.addEventListener('abort', stop, { once: true });
    registry.waiters.set(delegationId, take);
  });
}

/** True (once) when `mail` is a result a waiting `delegate` already returned to its model. */
export function takeConsumedResult(harness: Harness, mail: Mail): boolean {
  if (mail.body.kind !== 'result') return false;
  return registryOf(harness).consumed.delete(mail.id);
}
