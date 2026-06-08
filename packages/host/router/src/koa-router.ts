import KoaRouter from "@koa/router";
import type { RouterMiddleware } from "@koa/router";
import type { Context, Request as KoaRequest } from "koa";
import type { Server } from "node:http";
import { parse } from "node:url";
import type { ServerOptions, WebSocketServer } from "ws";
import { WebSocketServer as WSS } from "ws";
import type { ListedRoute } from "./openapi.js";
import { toKoaRouterPath } from "./path-pattern.js";
import { isRouteMeta, type RouteMeta } from "./route-meta.js";
import { timingSafeEqualString } from "./timing-safe-equal.js";

/** Koa 上下文；`koa-body` 解析后 `request.body` 可用。 */
export type RouterContext = Context & {
  request: KoaRequest & { body?: unknown };
};

type Path = string | RegExp;
type RouteHandler = (ctx: RouterContext) => void | Promise<void>;
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

function parseRouteArgs(
  path: Path,
  args: (RouteHandler | RouteMeta)[],
): { pattern: string; handler: RouteHandler; meta?: RouteMeta } {
  const fns = args.filter((a): a is RouteHandler => typeof a === "function");
  const handler = fns[fns.length - 1];
  if (!handler) {
    throw new TypeError(`Router route ${String(path)} requires a handler function`);
  }
  const metaCandidate = args.find((a) => a !== handler && isRouteMeta(a));
  return {
    pattern: path as string,
    handler,
    meta: metaCandidate && isRouteMeta(metaCandidate) ? metaCandidate : undefined,
  };
}

function looksLikePath(segment: string): boolean {
  return segment.startsWith("/") || segment === "" || segment.includes(":");
}

function isNamedRouteCall(
  first: string,
  second: unknown,
): second is string | RegExp {
  return (
    typeof second === "string" ||
    second instanceof RegExp ||
    (Array.isArray(second) && second.every((p) => typeof p === "string"))
  );
}

const remove = <T>(arr: T[], item: T): boolean => {
  const i = arr.indexOf(item);
  if (i !== -1) {
    arr.splice(i, 1);
    return true;
  }
  return false;
};

/**
 * HTTP 路由：继承 `@koa/router`，附带 WebSocket 升级与 OpenAPI 路由清单。
 */
export class Router extends KoaRouter {
  wsStack: WebSocketServer[] = [];
  whiteList: Path[] = [];
  private listedRoutes: ListedRoute[] = [];
  private _upgradeListenerInstalled = false;
  private _authToken: string | undefined;
  /** WebSocket paths that skip the global auth token (they provide their own verifyClient). */
  private _wsAuthExempt = new Set<string>();

  constructor(
    public readonly server: Server,
    prefix = "",
  ) {
    super({ prefix: prefix || undefined });
  }

  /**
   * Set the Bearer token used to authenticate WebSocket upgrade requests.
   * Must be called before the first upgrade arrives (typically right after
   * the HTTP auth middleware is registered).
   */
  setAuthToken(token: string): void {
    this._authToken = token;
  }

  listRoutes(): ListedRoute[] {
    return [...this.listedRoutes];
  }

  private fullPattern(path: string): string {
    const p = this.opts.prefix ?? "";
    return p ? `${p}${path}` : path;
  }

  private track(method: HttpMethod, path: string, meta?: RouteMeta): void {
    this.listedRoutes.push({
      method,
      pattern: this.fullPattern(path),
      meta,
    });
  }

  private addRoute(
    method: HttpMethod,
    path: Path,
    ...args: (RouteHandler | RouteMeta)[]
  ): this {
    const { pattern, handler, meta } = parseRouteArgs(path, args);
    this.whiteList.push(path);
    this.track(method, pattern, meta);
    const run = async (ctx: Context) => {
      await handler(ctx as RouterContext);
    };
    const koaPath = typeof pattern === "string" ? toKoaRouterPath(pattern) : pattern;
    switch (method) {
      case "GET":
        super.get(koaPath, run);
        break;
      case "POST":
        super.post(koaPath, run);
        break;
      case "PUT":
        super.put(koaPath, run);
        break;
      case "DELETE":
        super.delete(koaPath, run);
        break;
      default:
        break;
    }
    return this;
  }

  private delegateOrTrack(
    method: HttpMethod,
    pathOrName: string | RegExp | string[],
    pathOrHandler: unknown,
    rest: unknown[],
  ): this {
    if (
      typeof pathOrName === "string" &&
      !looksLikePath(pathOrName) &&
      isNamedRouteCall(pathOrName, pathOrHandler)
    ) {
      const m = method.toLowerCase();
      const named = this as unknown as Record<
        string,
        (name: string, path: string | RegExp, ...mw: RouterMiddleware[]) => KoaRouter
      >;
      named[m](pathOrName, pathOrHandler as string | RegExp, ...(rest as RouterMiddleware[]));
      return this;
    }
    const path = pathOrName as Path;
    const handlers = [pathOrHandler, ...rest].filter(
      (h): h is RouteHandler | RouteMeta => h !== undefined,
    );
    return this.addRoute(method, path, ...handlers);
  }

  get(
    name: string,
    path: string | RegExp,
    ...middleware: RouterMiddleware[]
  ): this;
  get(path: string | RegExp | string[], ...middleware: RouterMiddleware[]): this;
  get(path: Path, ...handlers: (RouteHandler | RouteMeta)[]): this;
  get(pathOrName: string | RegExp | string[], pathOrHandler?: unknown, ...rest: unknown[]): this {
    return this.delegateOrTrack("GET", pathOrName, pathOrHandler, rest);
  }

  post(
    name: string,
    path: string | RegExp,
    ...middleware: RouterMiddleware[]
  ): this;
  post(path: string | RegExp | string[], ...middleware: RouterMiddleware[]): this;
  post(path: Path, ...handlers: (RouteHandler | RouteMeta)[]): this;
  post(pathOrName: string | RegExp | string[], pathOrHandler?: unknown, ...rest: unknown[]): this {
    return this.delegateOrTrack("POST", pathOrName, pathOrHandler, rest);
  }

  put(
    name: string,
    path: string | RegExp,
    ...middleware: RouterMiddleware[]
  ): this;
  put(path: string | RegExp | string[], ...middleware: RouterMiddleware[]): this;
  put(path: Path, ...handlers: (RouteHandler | RouteMeta)[]): this;
  put(pathOrName: string | RegExp | string[], pathOrHandler?: unknown, ...rest: unknown[]): this {
    return this.delegateOrTrack("PUT", pathOrName, pathOrHandler, rest);
  }

  delete(
    name: string,
    path: string | RegExp,
    ...middleware: RouterMiddleware[]
  ): this;
  delete(path: string | RegExp | string[], ...middleware: RouterMiddleware[]): this;
  delete(path: Path, ...handlers: (RouteHandler | RouteMeta)[]): this;
  delete(pathOrName: string | RegExp | string[], pathOrHandler?: unknown, ...rest: unknown[]): this {
    return this.delegateOrTrack("DELETE", pathOrName, pathOrHandler, rest);
  }

  destroyWs(wsServer: WebSocketServer): void {
    wsServer.close();
    remove(this.wsStack, wsServer);
  }

  /**
   * Verify the Bearer token on a WebSocket upgrade request.
   * Returns `true` if the request is authenticated (or no token is configured).
   */
  private _verifyUpgradeToken(request: import("node:http").IncomingMessage): boolean {
    const token = this._authToken;
    if (!token) return true; // no token configured — allow (same as HTTP middleware)

    // Extract token from Authorization header
    const authHeader = request.headers["authorization"] ?? "";
    if (authHeader.startsWith("Bearer ") && timingSafeEqualString(token, authHeader.slice(7))) {
      return true;
    }

    // Fall back to query string ?token= or ?access_token=
    const { query } = parse(request.url ?? "", true);
    const queryToken =
      (typeof query.access_token === "string" ? query.access_token : "") ||
      (typeof query.token === "string" ? query.token : "");
    if (queryToken && timingSafeEqualString(token, queryToken)) {
      return true;
    }

    return false;
  }

  private _ensureUpgradeListener(): void {
    if (this._upgradeListenerInstalled) return;
    this._upgradeListenerInstalled = true;
    this.server.on("upgrade", (request, socket, head) => {
      if ((socket as { _wsRouterHandled?: boolean })._wsRouterHandled) return;
      const { pathname } = parse(request.url ?? "");
      const target = this.wsStack.find((wss) => wss.options.path === pathname);
      if (!target) return;

      // Authenticate the upgrade unless the path is exempt (has its own verifyClient)
      if (!this._wsAuthExempt.has(pathname ?? "") && !this._verifyUpgradeToken(request)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      (socket as { _wsRouterHandled?: boolean })._wsRouterHandled = true;
      try {
        target.handleUpgrade(request, socket as import("net").Socket, head, (ws) => {
          target.emit("connection", ws, request);
        });
      } catch {
        /* ignore */
      }
    });
  }

  ws(path: string, options: Omit<ServerOptions, "noServer" | "path"> = {}): WebSocketServer {
    const existing = this.wsStack.find((wss) => wss.options.path === path);
    if (existing) return existing;
    const wsServer = new WSS({ noServer: true, path, ...options });
    this.wsStack.push(wsServer);
    // If the caller provides its own verifyClient, exempt this path from
    // the global auth token check (the caller is responsible for auth).
    if (options.verifyClient) {
      this._wsAuthExempt.add(path);
    }
    this._ensureUpgradeListener();
    return wsServer;
  }
}

/** @deprecated 别名保留；新代码可直接 `router.get/post/...`。 */
export function registerFetchRoute(
  router: Router,
  method: string,
  path: string,
  handler: RouteHandler,
  meta?: RouteMeta,
): void {
  const m = method.toUpperCase();
  const args: (RouteHandler | RouteMeta)[] = meta ? [meta, handler] : [handler];
  if (m === "GET") router.get(path, ...args);
  else if (m === "POST") router.post(path, ...args);
  else if (m === "PUT") router.put(path, ...args);
  else if (m === "DELETE") router.delete(path, ...args);
  else throw new Error(`Unsupported HTTP method: ${method}`);
}

export type { RouteMeta, ListedRoute };
