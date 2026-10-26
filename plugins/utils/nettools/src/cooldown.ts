import { message } from './messages.js';
/**
 * Per-user cooldown shared by every nettools command and Agent tool of one
 * plugin instance. Each call to an external API spends the caller's budget
 * at admission time (after input validation), so typos are free but a failed
 * lookup still counts — that is what protects the upstream free APIs.
 *
 * State is in-memory and bounded; it resets on restart.
 */
import { NettoolsError } from './errors.js';

export const DEFAULT_COOLDOWN_CAPACITY = 10_000;

export class UserCooldown {
  readonly #cooldownMs: number;
  readonly #capacity: number;
  readonly #now: () => number;
  /** caller key → epoch ms when the caller may call again. */
  readonly #readyAt = new Map<string, number>();

  constructor(cooldownMs: number, now: () => number = Date.now, capacity = DEFAULT_COOLDOWN_CAPACITY) {
    this.#cooldownMs = Math.max(0, cooldownMs);
    this.#now = now;
    this.#capacity = Math.max(1, capacity);
  }

  get cooldownMs(): number {
    return this.#cooldownMs;
  }

  /** Milliseconds until `callerKey` may call again (0 when allowed). */
  remainingMs(callerKey: string): number {
    const readyAt = this.#readyAt.get(callerKey);
    if (readyAt === undefined) {
      return 0;
    }
    return Math.max(0, readyAt - this.#now());
  }

  /** Spend one call for `callerKey`, or throw a `cooldown` error. */
  take(callerKey: string): void {
    if (this.#cooldownMs === 0) {
      return;
    }
    const remaining = this.remainingMs(callerKey);
    if (remaining > 0) {
      const seconds = Math.ceil(remaining / 1000);
      throw new NettoolsError('cooldown', message('cooldown', { seconds }), { retryAfterMs: remaining });
    }
    this.#readyAt.delete(callerKey);
    this.#readyAt.set(callerKey, this.#now() + this.#cooldownMs);
    this.#enforceCapacity();
  }

  #enforceCapacity(): void {
    if (this.#readyAt.size <= this.#capacity) {
      return;
    }
    const now = this.#now();
    for (const [key, readyAt] of this.#readyAt) {
      if (readyAt <= now) {
        this.#readyAt.delete(key);
      }
    }
    while (this.#readyAt.size > this.#capacity) {
      const oldest = this.#readyAt.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.#readyAt.delete(oldest);
    }
  }
}

/** Cooldown key for a chat command: endpoint + sender, shared across conversations. */
export function commandCallerKey(input: {
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly conversation?: { readonly id?: unknown; readonly endpoint?: { readonly id?: unknown } };
  readonly sender?: { readonly id?: unknown };
} | undefined): string {
  const senderId = input?.sender?.id;
  if (senderId === undefined || senderId === null || String(senderId) === '') {
    return 'anonymous';
  }
  const endpointId = input?.metadata?.endpointId ?? input?.conversation?.endpoint?.id ?? '';
  return `im:${String(endpointId)}:${String(senderId)}`;
}

/** Cooldown key for an Agent tool call: the invoking principal. */
export function toolCallerKey(context: { readonly principal?: { readonly subjectId?: string } } | undefined): string {
  const subjectId = context?.principal?.subjectId;
  return subjectId ? `principal:${subjectId}` : 'anonymous';
}
