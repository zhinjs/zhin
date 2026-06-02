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

  constructor(
    public readonly server: Server,
    prefix = "",
  ) {
    super({ prefix: prefix || undefined });
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

  private _ensureUpgradeListener(): void {
    if (this._upgradeListenerInstalled) return;
    this._upgradeListenerInstalled = true;
    this.server.on("upgrade", (request, socket, head) => {
      if ((socket as { _wsRouterHandled?: boolean })._wsRouterHandled) return;
      const { pathname } = parse(request.url ?? "");
      const target = this.wsStack.find((wss) => wss.options.path === pathname);
      if (!target) return;
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
): void {
  const m = method.toUpperCase();
  if (m === "GET") router.get(path, handler);
  else if (m === "POST") router.post(path, handler);
  else if (m === "PUT") router.put(path, handler);
  else if (m === "DELETE") router.delete(path, handler);
  else throw new Error(`Unsupported HTTP method: ${method}`);
}

export type { RouteMeta, ListedRoute };
