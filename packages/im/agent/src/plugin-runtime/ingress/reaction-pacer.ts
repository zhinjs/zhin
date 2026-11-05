/**
 * Reaction pacing: models fill the structured reply's `reaction` almost every turn, so the host
 * decides whether a reaction actually goes out. Per session, a reaction is allowed only when the
 * last APPLIED one is at least `cooldownMs` old and a random roll passes `probability`.
 * Memory only, bounded to MAX_SESSIONS entries; nothing is persisted.
 */
export interface ReactionPacingConfig {
  /** Minimum gap between two applied reactions in one session (ms). */
  readonly cooldownMs?: number;
  /** Chance (0..1) that an otherwise allowed reaction is applied; 0 disables reactions. */
  readonly probability?: number;
}

export const DEFAULT_REACTION_COOLDOWN_MS = 600_000;
export const DEFAULT_REACTION_PROBABILITY = 0.35;
const MAX_SESSIONS = 1024;

export interface ResolvedReactionPacing {
  readonly cooldownMs: number;
  readonly probability: number;
}

/** Fill defaults and clamp junk (non-finite, negative, out of range) back into range. */
export function resolveReactionPacing(config?: ReactionPacingConfig | null): ResolvedReactionPacing {
  const cooldown = config?.cooldownMs;
  const probability = config?.probability;
  return {
    cooldownMs: typeof cooldown === 'number' && Number.isFinite(cooldown) && cooldown >= 0 ? cooldown : DEFAULT_REACTION_COOLDOWN_MS,
    probability: typeof probability === 'number' && Number.isFinite(probability)
      ? Math.min(1, Math.max(0, probability))
      : DEFAULT_REACTION_PROBABILITY,
  };
}

export class ReactionPacer {
  readonly #config: () => ResolvedReactionPacing;
  readonly #now: () => number;
  readonly #random: () => number;
  /** Insertion-ordered: oldest applied session first. */
  readonly #lastApplied = new Map<string, number>();

  constructor(options: {
    readonly config?: () => ReactionPacingConfig | null | undefined;
    readonly now?: () => number;
    readonly random?: () => number;
  } = {}) {
    this.#config = () => resolveReactionPacing(options.config?.());
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? Math.random;
  }

  /** Whether a reaction may go out now. Does not record anything; call {@link markApplied} after it did. */
  allow(sessionKey: string): boolean {
    const { cooldownMs, probability } = this.#config();
    if (probability <= 0) return false;
    const last = this.#lastApplied.get(sessionKey);
    if (last !== undefined && this.#now() - last < cooldownMs) return false;
    return this.#random() < probability;
  }

  markApplied(sessionKey: string): void {
    this.#lastApplied.delete(sessionKey);
    this.#lastApplied.set(sessionKey, this.#now());
    while (this.#lastApplied.size > MAX_SESSIONS) {
      const oldest = this.#lastApplied.keys().next().value;
      if (oldest === undefined) break;
      this.#lastApplied.delete(oldest);
    }
  }

  get size(): number {
    return this.#lastApplied.size;
  }

  clear(): void {
    this.#lastApplied.clear();
  }
}

export interface ReactionDelivery {
  /** True when a reaction was actually sent to the platform and acknowledged. */
  readonly applied: boolean;
  /** True when the pacer, not the platform, dropped it. */
  readonly paced: boolean;
}

/** Apply a reaction through the pacer. A paced-out reaction never reaches `add`. */
export async function deliverReaction(input: {
  readonly pacer: ReactionPacer;
  readonly sessionKey: string;
  readonly add: (() => Promise<unknown | null>) | undefined;
}): Promise<ReactionDelivery> {
  if (!input.pacer.allow(input.sessionKey)) return { applied: false, paced: true };
  const result = input.add ? await input.add() : null;
  const applied = result !== null;
  if (applied) input.pacer.markApplied(input.sessionKey);
  return { applied, paced: false };
}
