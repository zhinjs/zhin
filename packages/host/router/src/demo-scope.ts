import { timingSafeEqualString } from "./timing-safe-equal.js";
import {
  DEMO_RPC_ALLOWLIST,
  DEMO_RPC_WRITE_BLOCKLIST,
  assertDemoConsoleRpcAllowed,
  isDemoConsoleRpcAllowed,
} from '@zhin.js/console-protocol';

export { DEMO_RPC_ALLOWLIST, DEMO_RPC_WRITE_BLOCKLIST };

/** Demo Host token scope: RPC/HTTP/WS allowlists (ADR 0016). */

export type AuthScope = "full" | "demo";

export type ScopedTokenConfig = {
  token: string;
  scope: AuthScope;
};

export type TokenRegistryConfig = {
  primaryToken: string;
  scopedTokens?: ScopedTokenConfig[];
};

const DEMO_HTTP_GET_PREFIXES = [
  "/pub",
  "/entries",
  "/@dev/",
  "/@assets/",
  "/esm/",
  "/assets/client/",
] as const;

export class TokenRegistry {
  private readonly entries: Map<string, AuthScope>;

  constructor(config: TokenRegistryConfig) {
    this.entries = new Map();
    if (config.primaryToken) {
      this.entries.set(config.primaryToken, "full");
    }
    for (const { token, scope } of config.scopedTokens ?? []) {
      if (token) this.entries.set(token, scope);
    }
  }

  resolve(token: string): AuthScope | null {
    if (!token) return null;
    for (const [known, scope] of this.entries) {
      if (timingSafeEqualString(known, token)) return scope;
    }
    return null;
  }

  hasAnyToken(): boolean {
    return this.entries.size > 0;
  }

  /** Primary token prefix for startup logs (first full-scope token, first 6 chars). */
  primaryTokenPrefixForLog(): string {
    for (const [tok, scope] of this.entries) {
      if (scope === "full") return tok.slice(0, 6);
    }
    const first = this.entries.keys().next().value;
    return first ? first.slice(0, 6) : "";
  }
}

export function isDemoRpcAllowed(rpcType: string): boolean {
  return isDemoConsoleRpcAllowed(rpcType);
}

export function assertDemoRpcAllowed(rpcType: string): string | null {
  return assertDemoConsoleRpcAllowed(rpcType);
}

/**
 * Whether an authenticated HTTP request may proceed under demo scope.
 * Assumes auth already passed; `/pub` never reaches here with auth required.
 */
export function isDemoHttpAllowed(
  method: string,
  pathname: string,
  apiBase: string,
): boolean {
  const m = method.toUpperCase();
  const base = apiBase.replace(/\/$/, "") || "/api";

  if (m === "GET") {
    if (DEMO_HTTP_GET_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
      return true;
    }
    if (pathname === `${base}/events`) return true;
    return false;
  }

  if (m === "POST" && pathname === `${base}/console/request`) {
    return true;
  }

  return false;
}

/** WebSocket upgrade paths allowed for demo scope. */
export function isDemoWebSocketPath(pathname: string | null | undefined): boolean {
  return pathname === "/sandbox";
}
