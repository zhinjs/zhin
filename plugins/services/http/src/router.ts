import { remove } from '@zhin.js/core';
import { Layer, RouterOptions } from '@koa/router';
import KoaRouter from "@koa/router";
import * as http from 'http';
import { ServerOptions, WebSocketServer } from 'ws';
import { parse } from 'url';

type Path = string | RegExp;

export class Router extends KoaRouter {
  wsStack: WebSocketServer[] = [];
  whiteList: Path[] = []; //用于historyApi排除
  constructor(
    public server: http.Server,
    options?: RouterOptions,
  ) {
    super(options);
  }

  register(...args: Parameters<KoaRouter['register']>) {
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

  ws(path: string, options: Omit<ServerOptions, 'noServer' | 'path'> = {}): WebSocketServer {
    const wsServer = new WebSocketServer({
      noServer: true,
      path,
      ...options,
    });
    this.wsStack.push(wsServer);

    this.server!.on('upgrade', (request, socket, head) => {
      const { pathname } = parse(request.url!);
      if (this.wsStack.findIndex(wss => wss.options.path === path) === -1) {
        socket.destroy();
      } else if (pathname === path) {
        wsServer.handleUpgrade(request, socket, head, ws => {
          wsServer.emit('connection', ws, request);
        });
      }
    });
    return wsServer;
  }
}
