import { timingSafeEqualString } from './timing-safe-equal.js';

/** Demo Host token scope (ADR 0016 subset for Plugin Runtime Host). */
export type AuthScope = 'full' | 'demo';

export type ScopedTokenConfig = {
  readonly token: string;
  readonly scope: AuthScope;
  /** Root-configured subject binding; never accepted from an HTTP payload. */
  readonly principalId?: string;
};

export interface AuthenticatedTokenPrincipal {
  readonly principalId: string;
  readonly scope: AuthScope;
}

export type TokenRegistryConfig = {
  readonly primaryToken?: string;
  readonly scopedTokens?: readonly ScopedTokenConfig[];
};

export class TokenRegistry {
  readonly #entries = new Map<string, Readonly<{ scope: AuthScope; principalId?: string }>>();

  constructor(config: TokenRegistryConfig = {}) {
    if (config.primaryToken) this.#entries.set(config.primaryToken, Object.freeze({ scope: 'full' }));
    for (const { token, scope, principalId } of config.scopedTokens ?? []) {
      if (!token) continue;
      if (principalId !== undefined && (!principalId.trim() || principalId !== principalId.trim())) {
        throw new Error('HTTP token principalId is invalid');
      }
      const candidate = Object.freeze({ scope, ...(principalId === undefined ? {} : { principalId }) });
      const existing = this.#entries.get(token);
      if (existing && (existing.scope !== candidate.scope || existing.principalId !== candidate.principalId)) {
        throw new Error('HTTP token has conflicting authority bindings');
      }
      this.#entries.set(token, candidate);
    }
  }

  resolve(token: string): AuthScope | null {
    if (!token) return null;
    for (const [known, binding] of this.#entries) {
      if (timingSafeEqualString(known, token)) return binding.scope;
    }
    return null;
  }

  resolvePrincipal(token: string): AuthenticatedTokenPrincipal | null {
    if (!token) return null;
    for (const [known, binding] of this.#entries) {
      if (timingSafeEqualString(known, token)) {
        return binding.principalId
          ? Object.freeze({ principalId: binding.principalId, scope: binding.scope })
          : null;
      }
    }
    return null;
  }

  hasAnyToken(): boolean {
    return this.#entries.size > 0;
  }

  primaryTokenPrefixForLog(): string {
    for (const [tok, binding] of this.#entries) {
      if (binding.scope === 'full') return tok.slice(0, 6);
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
