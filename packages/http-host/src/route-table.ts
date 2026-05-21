import type { RouterContext } from "./router-context.js";
import { contextToResponse, createRouterContext } from "./router-context.js";

export type RouteHandler = (ctx: RouterContext) => void | Promise<void>;

type RouteEntry = {
  method: string;
  pattern: string;
  regexp: RegExp;
  paramNames: string[];
  handler: RouteHandler;
};

export type Middleware = (
  ctx: RouterContext,
  next: () => Promise<void>,
) => void | Promise<void>;

function pathToRegexp(pattern: string): { regexp: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
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

  register(method: string, pattern: string, handler: RouteHandler): void {
    this.whiteList.push(pattern);
    const { regexp, paramNames } = pathToRegexp(pattern);
    this.routes.push({
      method: method.toUpperCase(),
      pattern,
      regexp,
      paramNames,
      handler,
    });
  }

  get(pattern: string, handler: RouteHandler): void {
    this.register("GET", pattern, handler);
  }

  post(pattern: string, handler: RouteHandler): void {
    this.register("POST", pattern, handler);
  }

  put(pattern: string, handler: RouteHandler): void {
    this.register("PUT", pattern, handler);
  }

  delete(pattern: string, handler: RouteHandler): void {
    this.register("DELETE", pattern, handler);
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
