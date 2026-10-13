/**
 * Short-lived, single-use OAuth authorization sessions keyed by `state`.
 * Kept in memory: a restart simply invalidates pending links.
 */
import type { OAuthProviderKind } from "./token-manager.js";

export const OAUTH_SESSION_TTL_MS = 10 * 60 * 1000;

export interface OAuthSession<Requester> {
  readonly provider: OAuthProviderKind;
  readonly state: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly requester: Requester;
  readonly expiresAt: number;
}

export class OAuthSessionRegistry<Requester> {
  readonly #sessions = new Map<string, OAuthSession<Requester>>();
  readonly #now: () => number;
  readonly #ttlMs: number;

  constructor(options: { now?: () => number; ttlMs?: number } = {}) {
    this.#now = options.now ?? Date.now;
    this.#ttlMs = options.ttlMs ?? OAUTH_SESSION_TTL_MS;
  }

  create(
    session: Omit<OAuthSession<Requester>, "expiresAt">
  ): OAuthSession<Requester> {
    this.pruneExpired();
    const created: OAuthSession<Requester> = {
      ...session,
      expiresAt: this.#now() + this.#ttlMs,
    };
    this.#sessions.set(session.state, created);
    return created;
  }

  /** Removes and returns the session; a state can only be consumed once. */
  consume(state: string): OAuthSession<Requester> | undefined {
    const session = this.#sessions.get(state);
    if (!session) {
      return undefined;
    }
    this.#sessions.delete(state);
    if (session.expiresAt <= this.#now()) {
      return undefined;
    }
    return session;
  }

  pruneExpired(): void {
    const now = this.#now();
    for (const [state, session] of this.#sessions) {
      if (session.expiresAt <= now) {
        this.#sessions.delete(state);
      }
    }
  }

  get size(): number {
    return this.#sessions.size;
  }
}
