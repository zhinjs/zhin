import {
  CONSOLE_PERMISSION_LIST,
  pluginPermissionLevelResolver,
  type ConsolePluginPermissionInfo,
  type ConsolePluginPermissionLevelResolver,
} from '@zhin.js/console-protocol';
import { timingSafeEqualString } from './timing-safe-equal.js';
import { isLoopbackAddress } from './protocol-auth.js';
import {
  globalPermissions,
  type ConsoleAccessProvider,
  type ConsolePrincipal,
  type ConsoleRequestMeta,
} from './access-control.js';

/**
 * Scope a Host handler runs with. Every admitted request is `full`: authorization happens
 * before dispatch against the request's `ConsolePrincipal` (ADR 0049).
 */
export type AuthScope = 'full';

/**
 * What a Console caller may see. `unrestricted` is an open Host before setup; otherwise only
 * the listed permissions and roles count.
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
  /** `http.token`: the bootstrap credential, valid only until the first owner exists. */
  readonly primaryToken?: string;
};

const openBootstrap: ConsolePrincipal = Object.freeze({ kind: 'bootstrap', open: true });
const tokenBootstrap: ConsolePrincipal = Object.freeze({ kind: 'bootstrap', open: false });

/**
 * Bearer authentication for the Host (ADR 0049).
 * - Before setup: no credential configured → open; `http.token` → bootstrap (setup only).
 * - After setup (an enabled global owner exists): only user sessions and API tokens from the
 *   {@link ConsoleAccessProvider}; `http.token` is rejected everywhere.
 */
export class TokenRegistry {
  readonly #primaryToken: string | undefined;
  #provider: ConsoleAccessProvider | undefined;
  #pluginPermissions: (() => readonly ConsolePluginPermissionInfo[]) | undefined;

  constructor(config: TokenRegistryConfig = {}) {
    this.#primaryToken = config.primaryToken || undefined;
  }

  /** Installs the user/session backend; returns an idempotent uninstaller. */
  useAccessProvider(provider: ConsoleAccessProvider): () => void {
    if (this.#provider && this.#provider !== provider) throw new Error('Console access provider is already installed');
    this.#provider = provider;
    return () => {
      if (this.#provider === provider) this.#provider = undefined;
    };
  }

  get accessProvider(): ConsoleAccessProvider | undefined {
    return this.#provider;
  }

  /**
   * Installs the plugin permission catalog source (the runtime composition root reads it from
   * the current generation); returns an idempotent uninstaller.
   */
  usePluginPermissions(source: () => readonly ConsolePluginPermissionInfo[]): () => void {
    if (this.#pluginPermissions && this.#pluginPermissions !== source) throw new Error('Plugin permission catalog is already installed');
    this.#pluginPermissions = source;
    return () => {
      if (this.#pluginPermissions === source) this.#pluginPermissions = undefined;
    };
  }

  /** Plugin permissions the loaded plugins use or declare, with their levels (empty when none). */
  pluginPermissions(): readonly ConsolePluginPermissionInfo[] {
    try {
      return this.#pluginPermissions?.() ?? [];
    } catch {
      return [];
    }
  }

  /** Declared-or-inferred level lookup over {@link pluginPermissions}. */
  pluginPermissionLevels(): ConsolePluginPermissionLevelResolver {
    return pluginPermissionLevelResolver(this.pluginPermissions());
  }

  /** An enabled global owner exists. */
  initialized(): boolean {
    return this.#provider?.initialized() === true;
  }

  /** Whether `/api` requires a credential (a bootstrap token is configured, or setup is done). */
  hasAnyToken(): boolean {
    return this.#primaryToken !== undefined || this.initialized();
  }

  /** Whether `token` is the bootstrap token and still accepted (setup not done). */
  isBootstrapToken(token: string): boolean {
    return !this.initialized() && this.#primaryToken !== undefined && !!token
      && timingSafeEqualString(this.#primaryToken, token);
  }

  /** Resolves a bearer to a principal; null when it is not (or no longer) valid. */
  async authenticate(token: string, meta: ConsoleRequestMeta = {}): Promise<ConsolePrincipal | null> {
    // An open Host (no bootstrap token, no owner) holds every permission, so it is only open to
    // loopback peers that did not come through a proxy, and to callers that explicitly mark
    // themselves in-process (tests, embedding). An unknown peer address is not local.
    if (!this.hasAnyToken()) return isOpenHostPeer(meta) ? openBootstrap : null;
    if (this.isBootstrapToken(token)) return tokenBootstrap;
    if (!token || !this.#provider) return null;
    try {
      return await this.#provider.authenticate(token, meta);
    } catch {
      return null;
    }
  }

  /**
   * Bearer check for non-Console protocol surfaces (MCP, A2A): the bootstrap token before
   * setup, or a user credential holding `permission` globally. An open Host yields false so
   * the surface keeps its own unauthenticated (loopback) policy.
   */
  async authorizeBearer(token: string, permission: string, meta: ConsoleRequestMeta = {}): Promise<boolean> {
    if (!token || !this.hasAnyToken()) return false;
    return this.authorizePrincipal(await this.authenticate(token, meta), permission);
  }

  /**
   * {@link authorizeBearer} for a principal already resolved from the request's bearer (by this
   * registry, or by the gateway that forwarded the request): the bootstrap token before setup,
   * or a user credential holding `permission` globally. An open Host yields false.
   */
  authorizePrincipal(principal: ConsolePrincipal | null | undefined, permission: string): boolean {
    if (!principal) return false;
    if (principal.kind === 'bootstrap') return !principal.open;
    return principal.grants.some(grant => grant.scope.kind === 'global' && grant.permissions.includes(permission));
  }

  /**
   * Synchronous explicit-credential check: `full` only for the still-valid bootstrap token.
   * User credentials need {@link authenticate} (or the request's bound principal).
   */
  resolve(token: string): AuthScope | null {
    // An open Host has no explicit credential: routes that demand one keep refusing it.
    return this.isBootstrapToken(token) ? 'full' : null;
  }

  /** Console access for a resolved principal. */
  accessFor(principal: ConsolePrincipal | null | undefined): ConsoleAccess {
    if (!principal) return publicConsoleAccess;
    if (principal.kind === 'bootstrap') return principal.open ? unrestrictedConsoleAccess : publicConsoleAccess;
    // A global owner sees every page, including plugin pages whose permissions no plugin reports.
    // An owner API token narrowed below the full catalog is not unrestricted.
    if (principal.grants.some(grant => grant.role === 'owner' && grant.scope.kind === 'global'
      && CONSOLE_PERMISSION_LIST.every(permission => grant.permissions.includes(permission)))) return unrestrictedConsoleAccess;
    return Object.freeze({
      unrestricted: false,
      permissions: globalPermissions(principal, this.pluginPermissions()),
      roles: Object.freeze([...principal.roles].sort()),
    });
  }

  /** Synchronous legacy access: only an open Host is unrestricted. */
  resolveAccess(_token: string): ConsoleAccess {
    return this.hasAnyToken() ? publicConsoleAccess : unrestrictedConsoleAccess;
  }

  primaryTokenPrefixForLog(): string {
    if (this.initialized()) return '(users)';
    return this.#primaryToken ? `${this.#primaryToken.slice(0, 6)}…` : '';
  }
}

export function extractBearerToken(
  authorization: string | undefined,
  queryToken: string | null,
): string {
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7).trim();
  return queryToken?.trim() ?? '';
}

/** Who may use an open Host: no proxy hop, and a loopback peer or an explicit in-process caller. */
function isOpenHostPeer(meta: ConsoleRequestMeta): boolean {
  if (meta.forwarded) return false;
  if (meta.ip === undefined) return meta.inProcess === true;
  return isLoopbackAddress(meta.ip);
}
