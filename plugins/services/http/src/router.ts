import { Layer, RouterOptions } from "@koa/router";
import KoaRouter, { RouterContext as KoaRouterContext } from "@koa/router";
import * as http from "http";
import { ServerOptions, WebSocketServer } from "ws";
import { parse } from "url";

type Path = string | RegExp;

// 工具函数：从数组中移除元素
const remove = <T>(arr: T[], item: T): boolean => {
  const index = arr.indexOf(item);
  if (index !== -1) {
    arr.splice(index, 1);
    return true;
  }
  return false;
};
export type RouterContext = KoaRouterContext & {
    request: Request & {
        body: any;
    };
};
export class Router extends KoaRouter {
  wsStack: WebSocketServer[] = [];
  whiteList: Path[] = [];
  private _upgradeListenerInstalled = false;

  constructor(public server: http.Server, options?: RouterOptions) {
    super(options);
  }

  register(...args: Parameters<KoaRouter["register"]>): ReturnType<KoaRouter["register"]> {
    const path: Path = args[0] as any;
    this.whiteList.push(path);
    return super.register(...args);
  }

  destroy(layer: Layer) {
    remove(this.stack, layer);
  }

  destroyWs(wsServer: WebSocketServer) {
    wsServer.close();
    remove(this.wsStack, wsServer);
  }

  private _ensureUpgradeListener(): void {
    if (this._upgradeListenerInstalled) return;
    this._upgradeListenerInstalled = true;

    this.server.on("upgrade", (request: import("http").IncomingMessage, socket: import("stream").Duplex, head: Buffer) => {
      if ((socket as any)._wsRouterHandled) return;
      const { pathname } = parse(request.url!);
      const target = this.wsStack.find((wss) => wss.options.path === pathname);
      if (!target) return;
      (socket as any)._wsRouterHandled = true;
      try {
        target.handleUpgrade(request, socket as import("net").Socket, head, (ws) => {
          target.emit("connection", ws, request);
        });
      } catch {}
    });
  }

  ws(path: string, options: Omit<ServerOptions, "noServer" | "path"> = {}): WebSocketServer {
    const existing = this.wsStack.find((wss) => wss.options.path === path);
    if (existing) return existing;

    const wsServer = new WebSocketServer({
      noServer: true,
      path,
      ...options,
    });
    this.wsStack.push(wsServer);
    this._ensureUpgradeListener();
    return wsServer;
  }
}
