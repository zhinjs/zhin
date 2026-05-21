import crypto from "node:crypto";
import type { RouteTable } from "./route-table.js";

export type FetchAppOptions = {
  base?: string;
  token?: string;
  corsOrigins?: string[];
  trustProxy?: boolean;
  /** Runs when no route matches (e.g. Koa console static). */
  fallback?: (req: Request) => Promise<Response>;
};

export type FetchApp = {
  fetch: (req: Request) => Promise<Response>;
  routes: RouteTable;
};

function parseJsonBody(req: Request, raw: string): unknown {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json") && raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (raw && (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart"))) {
    return raw;
  }
  return raw || undefined;
}

function corsHeaders(origin: string | null, allowed: string[]): HeadersInit | null {
  if (!origin || allowed.length === 0) return null;
  const ok =
    allowed.includes("*") ||
    allowed.some((o) => o === origin || (o.endsWith("*") && origin.startsWith(o.slice(0, -1))));
  if (!ok) return null;
  return {
    "Access-Control-Allow-Origin": allowed.includes("*") ? "*" : origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
  };
}

function applySecurityHeaders(headers: Headers): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
}

function requiresAuth(pathname: string, base: string, whiteList: (string | RegExp)[]): boolean {
  if (pathname.startsWith("/pub/") || pathname === "/pub") return false;
  if (!pathname.startsWith(base + "/") && pathname !== base) {
    const wl = whiteList.some((p) => typeof p === "string" && !p.startsWith(base) && pathname.startsWith(p));
    if (wl) return false;
    return false;
  }
  return true;
}

export function createFetchApp(routes: RouteTable, options: FetchAppOptions = {}): FetchApp {
  const base = options.base ?? "/api";
  const token = options.token ?? "";
  const corsOrigins = options.corsOrigins ?? [];
  const fallback = options.fallback;

  const fetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const origin = req.headers.get("origin");
    const cors = corsHeaders(origin, corsOrigins);

    if (req.method === "OPTIONS" && cors) {
      return new Response(null, { status: 204, headers: cors });
    }

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    let rawBody = "";
    if (req.method !== "GET" && req.method !== "HEAD") {
      rawBody = await req.text();
    }
    const body = parseJsonBody(req, rawBody);

    const replayReq =
      rawBody && req.method !== "GET" && req.method !== "HEAD"
        ? new Request(req.url, {
            method: req.method,
            headers: req.headers,
            body: rawBody,
          })
        : req;

    if (requiresAuth(url.pathname, base, routes.whiteList) && token) {
      const auth = req.headers.get("Authorization");
      const reqToken = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
      const expectedBuf = Buffer.from(token, "utf-8");
      const receivedBuf = Buffer.from(reqToken, "utf-8");
      if (
        expectedBuf.length !== receivedBuf.length ||
        !crypto.timingSafeEqual(expectedBuf, receivedBuf)
      ) {
        const h = new Headers({ "content-type": "application/json" });
        applySecurityHeaders(h);
        if (cors) for (const [k, v] of Object.entries(cors)) h.set(k, v);
        return new Response(JSON.stringify({ success: false, error: "Invalid or missing token" }), {
          status: 401,
          headers: h,
        });
      }
    }

    const routed = await routes.dispatch(replayReq, body);
    if (routed) {
      const h = new Headers(routed.headers);
      applySecurityHeaders(h);
      if (cors) for (const [k, v] of Object.entries(cors)) h.set(k, v);
      return new Response(routed.body, { status: routed.status, headers: h });
    }

    if (fallback) {
      const res = await fallback(replayReq);
      const h = new Headers(res.headers);
      applySecurityHeaders(h);
      if (cors) for (const [k, v] of Object.entries(cors)) h.set(k, v);
      return new Response(res.body, { status: res.status, headers: h });
    }

    return new Response(JSON.stringify({ success: false, error: "Not Found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  return { fetch, routes };
}
