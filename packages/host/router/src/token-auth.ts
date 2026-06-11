import type { Context } from "koa";
import {
  type AuthScope,
  type TokenRegistry,
  isDemoHttpAllowed,
} from "./demo-scope.js";

export const AUTH_SCOPE_STATE_KEY = "authScope";

export function getAuthScope(ctx: Context): AuthScope {
  const scope = (ctx.state as Record<string, unknown>)[AUTH_SCOPE_STATE_KEY];
  return scope === "demo" ? "demo" : "full";
}

export function extractBearerToken(ctx: Context): string {
  const auth = ctx.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const queryToken =
    (typeof ctx.query.access_token === "string" ? ctx.query.access_token : "") ||
    (typeof ctx.query.token === "string" ? ctx.query.token : "");
  if (queryToken) {
    ctx.set("X-Deprecation-Warning", "Token in query string is deprecated; use Authorization header instead");
  }
  return queryToken;
}

export function setAuthScopeOnContext(ctx: Context, scope: AuthScope): void {
  (ctx.state as Record<string, unknown>)[AUTH_SCOPE_STATE_KEY] = scope;
}

export function demoHttpForbiddenResponse(ctx: Context): void {
  ctx.status = 403;
  ctx.body = { success: false, error: "Demo scope: forbidden" };
}

export function checkDemoHttpAccess(
  ctx: Context,
  scope: AuthScope,
  apiBase: string,
): boolean {
  if (scope !== "demo") return true;
  if (isDemoHttpAllowed(ctx.method, ctx.path, apiBase)) return true;
  demoHttpForbiddenResponse(ctx);
  return false;
}

export type { TokenRegistry };
