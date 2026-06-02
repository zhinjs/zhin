import type { Middleware } from "koa";
import { timingSafeEqualString } from "./timing-safe-equal.js";

function corsMatch(origin: string | undefined, allowed: string[]): boolean {
  if (!origin || allowed.length === 0) return false;
  return (
    allowed.includes("*") ||
    allowed.some((o) => o === origin || (o.endsWith("*") && origin.startsWith(o.slice(0, -1))))
  );
}

function applyCors(ctx: import("koa").Context, origin: string, allowed: string[]): void {
  ctx.set("Access-Control-Allow-Origin", allowed.includes("*") ? "*" : origin);
  ctx.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  ctx.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
  ctx.set("Access-Control-Max-Age", "86400");
}

export function createCorsMiddleware(corsOrigins: string[]): Middleware {
  return async (ctx, next) => {
    const origin = ctx.get("Origin");
    const ok = corsMatch(origin, corsOrigins);

    if (ctx.method === "OPTIONS") {
      if (ok) applyCors(ctx, origin, corsOrigins);
      ctx.status = 204;
      return;
    }

    await next();
    if (ok) applyCors(ctx, origin, corsOrigins);
  };
}

export function securityHeadersMiddleware(): Middleware {
  return async (ctx, next) => {
    await next();
    ctx.set("X-Content-Type-Options", "nosniff");
    ctx.set("X-Frame-Options", "SAMEORIGIN");
  };
}

function requiresAuth(
  pathname: string,
  base: string,
  whiteList: (string | RegExp)[],
  authExempt: string[] = [],
): boolean {
  if (authExempt.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false;
  if (pathname.startsWith("/pub/") || pathname === "/pub") return false;
  if (!pathname.startsWith(base + "/") && pathname !== base) {
    const wl = whiteList.some(
      (p) => typeof p === "string" && !p.startsWith(base) && pathname.startsWith(p),
    );
    if (wl) return false;
    return false;
  }
  return true;
}

export type AuthMiddlewareOptions = {
  token: string;
  base: string;
  whiteList: (string | RegExp)[];
  authExemptPaths?: string[];
};

export function createAuthMiddleware(options: AuthMiddlewareOptions): Middleware {
  const { token, base, whiteList, authExemptPaths = [] } = options;
  return async (ctx, next) => {
    if (!requiresAuth(ctx.path, base, whiteList, authExemptPaths) || !token) {
      await next();
      return;
    }
    const auth = ctx.get("Authorization");
    const queryToken =
      (typeof ctx.query.access_token === "string" ? ctx.query.access_token : "") ||
      (typeof ctx.query.token === "string" ? ctx.query.token : "");
    const reqToken = auth?.startsWith("Bearer ") ? auth.slice(7) : queryToken;
    if (!timingSafeEqualString(token, reqToken)) {
      ctx.status = 401;
      ctx.body = { success: false, error: "Invalid or missing token" };
      return;
    }
    await next();
  };
}
