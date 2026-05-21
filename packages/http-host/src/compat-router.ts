import type { Server } from "node:http";
import type { ServerOptions, WebSocketServer } from "ws";
import { WebSocketServer as WSS } from "ws";
import { parse } from "node:url";
import type { RouteHandler, RouteTable } from "./route-table.js";
import type { RouterContext } from "./router-context.js";

type Path = string | RegExp;

const remove = <T>(arr: T[], item: T): boolean => {
  const i = arr.indexOf(item);
  if (i !== -1) {
    arr.splice(i, 1);
    return true;
  }
  return false;
};

/**
 * Drop-in replacement for @zhin.js/http Router: registers routes on RouteTable + optional ws.
 */
export class Router {
  wsStack: WebSocketServer[] = [];
  whiteList: Path[] = [];
  private _upgradeListenerInstalled = false;

  constructor(
    public server: Server,
    public readonly table: RouteTable,
    public prefix = "",
  ) {}

  register(path: Path, ...handlers: RouteHandler[]): void {
    const pattern = this.prefix + (path as string);
    this.whiteList.push(path);
    const handler = handlers[handlers.length - 1];
    this.table.register("GET", pattern, handler);
  }

  get(path: Path, ...handlers: RouteHandler[]): void {
    const pattern = this.prefix + (path as string);
    this.whiteList.push(path);
    const handler = handlers[handlers.length - 1];
    this.table.get(pattern, handler);
  }

  post(path: Path, ...handlers: RouteHandler[]): void {
    const pattern = this.prefix + (path as string);
    this.whiteList.push(path);
    const handler = handlers[handlers.length - 1];
    this.table.post(pattern, handler);
  }

  put(path: Path, ...handlers: RouteHandler[]): void {
    const pattern = this.prefix + (path as string);
    this.whiteList.push(path);
    const handler = handlers[handlers.length - 1];
    this.table.put(pattern, handler);
  }

  delete(path: Path, ...handlers: RouteHandler[]): void {
    const pattern = this.prefix + (path as string);
    this.whiteList.push(path);
    const handler = handlers[handlers.length - 1];
    this.table.delete(pattern, handler);
  }

  /** Legacy middleware: only supports (ctx, next) with sync route continuation. */
  use(...args: unknown[]): void {
    const fns = args.filter((a): a is (ctx: RouterContext, next: () => Promise<void>) => void | Promise<void> => typeof a === "function");
    if (fns.length === 1 && args.length === 1) {
      this.table.use(fns[0]);
      return;
    }
    for (const fn of fns) {
      this.table.use(fn as (ctx: RouterContext, next: () => Promise<void>) => void | Promise<void>);
    }
  }

  routes(): { path: string }[] {
    return [];
  }

  allowedMethods(): unknown {
    return () => async () => new Response(null, { status: 405 });
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

export type { RouterContext };
