import { logger } from './ilink-logger.js';

export const SESSION_EXPIRED_ERRCODE = -14;
export const SESSION_PAUSE_DURATION_MS = 60 * 60 * 1000;

/** Endpoint-owned cooldown state for an authenticated iLink session. */
export class IlinkSessionGuard {
  #pauseUntil = 0;

  constructor(
    readonly accountId: string,
    private readonly now: () => number = Date.now,
    private readonly pauseDurationMs = SESSION_PAUSE_DURATION_MS,
  ) {}

  pause(): void {
    this.#pauseUntil = this.now() + this.pauseDurationMs;
    logger.info(
      `session-guard: paused accountId=${this.accountId} until=${new Date(this.#pauseUntil).toISOString()} (${this.pauseDurationMs / 1000}s)`,
    );
  }

  get paused(): boolean {
    return this.remainingMs > 0;
  }

  get remainingMs(): number {
    const remaining = this.#pauseUntil - this.now();
    if (remaining > 0) return remaining;
    this.#pauseUntil = 0;
    return 0;
  }

  assertActive(): void {
    const remaining = this.remainingMs;
    if (remaining === 0) return;
    throw new Error(
      `session paused for accountId=${this.accountId}, ${Math.ceil(remaining / 60_000)} min remaining (errcode ${SESSION_EXPIRED_ERRCODE})`,
    );
  }
}
