import { timingSafeEqualString } from './timing-safe-equal.js';

/** Demo Host token scope (ADR 0016 subset for Plugin Runtime Host). */
export type AuthScope = 'full' | 'demo';

export type ScopedTokenConfig = {
  readonly token: string;
  readonly scope: AuthScope;
};

export type TokenRegistryConfig = {
  readonly primaryToken?: string;
  readonly scopedTokens?: readonly ScopedTokenConfig[];
};

export class TokenRegistry {
  readonly #entries = new Map<string, AuthScope>();

  constructor(config: TokenRegistryConfig = {}) {
    if (config.primaryToken) this.#entries.set(config.primaryToken, 'full');
    for (const { token, scope } of config.scopedTokens ?? []) {
      if (token) this.#entries.set(token, scope);
    }
  }

  resolve(token: string): AuthScope | null {
    if (!token) return null;
    for (const [known, scope] of this.#entries) {
      if (timingSafeEqualString(known, token)) return scope;
    }
    return null;
  }

  hasAnyToken(): boolean {
    return this.#entries.size > 0;
  }

  primaryTokenPrefixForLog(): string {
    for (const [tok, scope] of this.#entries) {
      if (scope === 'full') return tok.slice(0, 6);
    }
    const first = this.#entries.keys().next().value;
    return first ? first.slice(0, 6) : '';
  }
}

/** WebSocket upgrade paths allowed for demo scope. */
export function isDemoWebSocketPath(pathname: string): boolean {
  return pathname === '/sandbox';
}

export function extractBearerToken(
  authorization: string | undefined,
  queryToken: string | null,
): string {
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7).trim();
  return queryToken?.trim() ?? '';
}
