import { timingSafeEqualString } from './timing-safe-equal.js';

/** Demo Host token scope (ADR 0016 subset for Plugin Runtime Host). */
export type AuthScope = 'full' | 'demo';

export type ScopedTokenConfig = {
  readonly token: string;
  readonly scope: AuthScope;
  /** Root-configured subject binding; never accepted from an HTTP payload. */
  readonly principalId?: string;
  /**
   * Console permissions held by this token (matched against Page `requiredPermissions`).
   * Ignored for `full` scope, which already holds every Console permission.
   */
  readonly permissions?: readonly string[];
  /** Console roles held by this token (matched against Page `requiredRoles`). */
  readonly roles?: readonly string[];
};

/**
 * What a Console caller may see. `unrestricted` is the operator (full scope, or a Host with no
 * tokens configured); otherwise only the listed permissions and roles count.
 */
export interface ConsoleAccess {
  readonly unrestricted: boolean;
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
}

export const publicConsoleAccess: ConsoleAccess = Object.freeze({
  unrestricted: false,
  permissions: Object.freeze([]) as readonly string[],
  roles: Object.freeze([]) as readonly string[],
});

export const unrestrictedConsoleAccess: ConsoleAccess = Object.freeze({
  unrestricted: true,
  permissions: Object.freeze([]) as readonly string[],
  roles: Object.freeze([]) as readonly string[],
});

export interface AuthenticatedTokenPrincipal {
  readonly principalId: string;
  readonly scope: AuthScope;
}

export type TokenRegistryConfig = {
  readonly primaryToken?: string;
  readonly scopedTokens?: readonly ScopedTokenConfig[];
};

export type DynamicTokenConfig = ScopedTokenConfig & {
  /** Unix epoch milliseconds; omitted credentials remain valid until explicitly revoked. */
  readonly expiresAt?: number;
};

type TokenBinding = Readonly<{
  scope: AuthScope;
  principalId?: string;
  permissions: readonly string[];
  roles: readonly string[];
  expiresAt?: number;
  dynamic: boolean;
}>;

export class TokenRegistry {
  readonly #entries = new Map<string, TokenBinding>();

  constructor(config: TokenRegistryConfig = {}) {
    if (config.primaryToken) {
      this.#entries.set(config.primaryToken, Object.freeze({ scope: 'full', permissions: [], roles: [], dynamic: false }));
    }
    for (const { token, scope, principalId, permissions, roles } of config.scopedTokens ?? []) {
      if (!token) continue;
      if (principalId !== undefined && (!principalId.trim() || principalId !== principalId.trim())) {
        throw new Error('HTTP token principalId is invalid');
      }
      const candidate: TokenBinding = Object.freeze({
        scope,
        ...(principalId === undefined ? {} : { principalId }),
        permissions: accessList(permissions, 'permissions'),
        roles: accessList(roles, 'roles'),
        dynamic: false,
      });
      const existing = this.#entries.get(token);
      if (existing && (existing.scope !== candidate.scope || existing.principalId !== candidate.principalId
        || existing.permissions.join('\n') !== candidate.permissions.join('\n')
        || existing.roles.join('\n') !== candidate.roles.join('\n'))) {
        throw new Error('HTTP token has conflicting authority bindings');
      }
      this.#entries.set(token, candidate);
    }
  }

  resolve(token: string): AuthScope | null {
    if (!token) return null;
    for (const [known, binding] of this.#entries) {
      if (!timingSafeEqualString(known, token)) continue;
      if (this.#expired(known, binding)) return null;
      return binding.scope;
    }
    return null;
  }

  resolvePrincipal(token: string): AuthenticatedTokenPrincipal | null {
    if (!token) return null;
    for (const [known, binding] of this.#entries) {
      if (timingSafeEqualString(known, token)) {
        if (this.#expired(known, binding)) return null;
        return binding.principalId
          ? Object.freeze({ principalId: binding.principalId, scope: binding.scope })
          : null;
      }
    }
    return null;
  }

  /**
   * Console access for a bearer token. With no tokens configured the Host is local and open,
   * so every caller is the operator. An unknown or missing token gets public access only.
   */
  resolveAccess(token: string): ConsoleAccess {
    if (!this.hasAnyToken()) return unrestrictedConsoleAccess;
    if (!token) return publicConsoleAccess;
    for (const [known, binding] of this.#entries) {
      if (!timingSafeEqualString(known, token)) continue;
      if (this.#expired(known, binding)) return publicConsoleAccess;
      if (binding.scope === 'full') return unrestrictedConsoleAccess;
      return Object.freeze({ unrestricted: false, permissions: binding.permissions, roles: binding.roles });
    }
    return publicConsoleAccess;
  }

  hasAnyToken(): boolean {
    for (const [token, binding] of this.#entries) {
      if (!this.#expired(token, binding)) return true;
    }
    return false;
  }

  /** Registers a runtime-issued credential and returns an idempotent revoker. */
  register(config: DynamicTokenConfig): () => void {
    if (!config.token) throw new Error('Dynamic HTTP token is required');
    if (config.principalId !== undefined
      && (!config.principalId.trim() || config.principalId !== config.principalId.trim())) {
      throw new Error('Dynamic HTTP token principalId is invalid');
    }
    if (config.expiresAt !== undefined
      && (!Number.isSafeInteger(config.expiresAt) || config.expiresAt <= Date.now())) {
      throw new Error('Dynamic HTTP token expiresAt must be a future epoch millisecond');
    }
    const candidate: TokenBinding = Object.freeze({
      scope: config.scope,
      ...(config.principalId === undefined ? {} : { principalId: config.principalId }),
      permissions: accessList(config.permissions, 'permissions'),
      roles: accessList(config.roles, 'roles'),
      ...(config.expiresAt === undefined ? {} : { expiresAt: config.expiresAt }),
      dynamic: true,
    });
    const existing = this.#entries.get(config.token);
    if (existing) throw new Error('Dynamic HTTP token conflicts with an existing credential');
    this.#entries.set(config.token, candidate);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.#entries.get(config.token) === candidate) this.#entries.delete(config.token);
    };
  }

  revoke(token: string): boolean {
    const binding = this.#entries.get(token);
    return binding?.dynamic === true && this.#entries.delete(token);
  }

  primaryTokenPrefixForLog(): string {
    for (const [tok, binding] of this.#entries) {
      if (binding.scope === 'full') return tok.slice(0, 6);
    }
    const first = this.#entries.keys().next().value;
    return first ? first.slice(0, 6) : '';
  }

  #expired(token: string, binding: TokenBinding): boolean {
    if (binding.expiresAt === undefined || binding.expiresAt > Date.now()) return false;
    if (binding.dynamic) this.#entries.delete(token);
    return true;
  }
}

function accessList(value: readonly string[] | undefined, label: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.length > 0 && item.trim() === item)) {
    throw new Error(`HTTP token ${label} must be non-empty trimmed strings`);
  }
  return Object.freeze([...new Set(value)].sort());
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
