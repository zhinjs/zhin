import type { RouterContext } from "./router-context.js";
import { contextToResponse, createRouterContext } from "./router-context.js";
import type { RouteMeta } from "./route-meta.js";

export type RouteHandler = (ctx: RouterContext) => void | Promise<void>;

export type { RouteMeta } from "./route-meta.js";

type RouteEntry = {
  method: string;
  pattern: string;
  regexp: RegExp;
  paramNames: string[];
  handler: RouteHandler;
  meta?: RouteMeta;
};

export type ListedRoute = {
  method: string;
  pattern: string;
  meta?: RouteMeta;
};

export type Middleware = (
  ctx: RouterContext,
  next: () => Promise<void>,
) => void | Promise<void>;

function pathToRegexp(pattern: string): { regexp: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const plus = pattern.match(/:([A-Za-z0-9_]+)\+$/);
  if (plus) {
    paramNames.push(plus[1]);
    const prefix = pattern.slice(0, pattern.length - plus[0].length).replace(/\/$/, "");
    const prefixParts = prefix.split("/").filter(Boolean).map((seg) => {
      if (seg.startsWith(":")) {
        paramNames.splice(paramNames.length - 1, 0, seg.slice(1));
        return "([^/]+)";
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
    const base = prefixParts.length ? `/${prefixParts.join("/")}` : "";
    return { regexp: new RegExp(`^${base}/(.+)$`), paramNames };
  }
  const parts = pattern.split("/").map((seg) => {
    if (seg.startsWith(":")) {
      paramNames.push(seg.slice(1));
      return "([^/]+)";
    }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return { regexp: new RegExp(`^${parts.join("/")}$`), paramNames };
}

export class RouteTable {
  whiteList: (string | RegExp)[] = [];
  private routes: RouteEntry[] = [];
  private globalMiddleware: Middleware[] = [];

  use(fn: Middleware): void {
    this.globalMiddleware.push(fn);
  }

  register(method: string, pattern: string, handler: RouteHandler, meta?: RouteMeta): void {
    this.whiteList.push(pattern);
    const { regexp, paramNames } = pathToRegexp(pattern);
    this.routes.push({
      method: method.toUpperCase(),
      pattern,
      regexp,
      paramNames,
      handler,
      meta,
    });
  }

  /** Snapshot of registered Fetch routes (for OpenAPI / introspection). */
  listRoutes(): ListedRoute[] {
    return this.routes.map((r) => ({
      method: r.method,
      pattern: r.pattern,
      meta: r.meta,
    }));
  }

  get(pattern: string, handler: RouteHandler, meta?: RouteMeta): void {
    this.register("GET", pattern, handler, meta);
  }

  post(pattern: string, handler: RouteHandler, meta?: RouteMeta): void {
    this.register("POST", pattern, handler, meta);
  }

  put(pattern: string, handler: RouteHandler, meta?: RouteMeta): void {
    this.register("PUT", pattern, handler, meta);
  }

  delete(pattern: string, handler: RouteHandler, meta?: RouteMeta): void {
    this.register("DELETE", pattern, handler, meta);
  }

  private match(method: string, pathname: string): { entry: RouteEntry; params: Record<string, string> } | null {
    for (const entry of this.routes) {
      if (entry.method !== method.toUpperCase()) continue;
      const m = pathname.match(entry.regexp);
      if (!m) continue;
      const params: Record<string, string> = {};
      entry.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1] ?? "");
      });
      return { entry, params };
    }
    return null;
  }

  async dispatch(req: Request, body: unknown): Promise<Response | null> {
    const url = new URL(req.url);
    const matched = this.match(req.method, url.pathname);
    if (!matched) return null;

    const ctx = createRouterContext(req, matched.params, body);
    const run = async (index: number): Promise<void> => {
      if (index < this.globalMiddleware.length) {
        await this.globalMiddleware[index](ctx, () => run(index + 1));
        return;
      }
      await matched.entry.handler(ctx);
    };
    await run(0);
    return contextToResponse(ctx);
  }
}
