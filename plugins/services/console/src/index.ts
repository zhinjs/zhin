import { register, useContext,useLogger } from "@zhin.js/core";
import  { WebSocketServer } from "ws";
import type { ViteDevServer } from "vite";
import mime from "mime";
import * as fs from "fs";
import * as path from "path";
import { setupWebSocket,notifyDataUpdate } from "./websocket.js";

// 条件导入 - 生产环境会被 tree-shake
let createViteDevServer: ((options: any) => Promise<ViteDevServer>) | undefined;
let connect: ((handler: any) => any) | undefined;

if (process.env.NODE_ENV === 'development') {
  // 动态导入开发依赖
  const devModule = await import('./dev.js');
  createViteDevServer = devModule.createViteDevServer;
  const koaConnectModule = await import('koa-connect');
  connect = koaConnectModule.default;
}

declare module "@zhin.js/types" {
  interface GlobalContext {
    web: WebServer;
  }
}
export type WebEntry =
  | string
  | {
      production: string;
      development: string;
    };
export type WebServer = {
  vite?: ViteDevServer;
  addEntry(entry: WebEntry): () => void;
  entries: Record<string, string>;
  ws: WebSocketServer;
};
const logger=useLogger()
const createSyncMsg = (key: string, value: any) => {
  return {
    type: "sync",
    data: {
      key,
      value,
    },
  };
};
const createAddMsg = (key: string, value: any) => {
  return {
    type: "add",
    data: {
      key,
      value,
    },
  };
};
const createDeleteMsg = (key: string, value: any) => {
  return {
    type: "delete",
    data: {
      key,
      value,
    },
  };
};
useContext("router", async (router) => {
  const base = "/vite/";

  const webServer: WebServer = {
    entries: {},
    addEntry(entry) {
      const hash =
        Date.now().toString(16) + Math.random().toString(16).slice(2, 8);
      const entryFile =
        typeof entry === "string"
          ? entry
          : entry[
              (process.env.NODE_ENV as "development" | "production") ||
                "development"
            ];
      this.entries[hash] = `/vite/@fs/${entryFile}`
      for (const ws of this.ws.clients || []) {
        ws.send(JSON.stringify(createAddMsg("entries", this.entries[hash])));
      }
      return () => {
        for (const ws of this.ws.clients || []) {
          ws.send(
            JSON.stringify(createDeleteMsg("entries", this.entries[hash]))
          );
        }
        delete this.entries[hash];
      };
    },
    ws: router.ws("/server"),
  };
  const isDev = process.env.NODE_ENV === "development";
  const root = isDev
    ? path.join(import.meta.dirname, "../client")
    : path.join(import.meta.dirname, "../dist");
  if (isDev && createViteDevServer && connect) {
    webServer.vite = await createViteDevServer({
      root,
      base,
      enableTailwind: true,
    });
    // Vite 中间件 - 必须在其他路由之前
    router.use((ctx, next) => {
      if (ctx.request.originalUrl.startsWith("/api")) return next();
      return connect!(webServer.vite!.middlewares)(ctx as any, next);
    });
  }else{
    router.use((ctx, next) => {
      if (ctx.request.originalUrl.startsWith("/api")) return next();
      if(!ctx.path.startsWith('/vite/@fs/')) return next();
      const filename=ctx.path.replace(`/vite/@fs/`,'')
      if(!fs.existsSync(filename)) return next();
      ctx.type = mime.getType(filename) || path.extname(filename);
      ctx.body = fs.createReadStream(filename);
    });
  }

  // SPA 回退路由 - 处理所有未匹配的路由
  router.all("*all", async (ctx, next) => {
    const url = ctx.request.originalUrl.replace(base, "");
    const name = isDev ? ctx.path.slice(1) : ctx.path.slice(1);
    const sendFile = (filename: string) => {
      // 安全检查：确保是常规文件
      try {
        const stat = fs.statSync(filename);
        if (!stat.isFile()) {
          ctx.status = 404;
          return;
        }
      } catch (error) {
        ctx.status = 404;
        return;
      }

      ctx.type = path.extname(filename);
      ctx.type = mime.getType(filename) || ctx.type;
      return (ctx.body = fs.createReadStream(filename));
    };
    
    // 1. 检查是否是动态入口
    if (Object.keys(webServer.entries).includes(name)) {
      return sendFile(path.resolve(process.cwd(), webServer.entries[name]));
    }

    // 2. 检查是否是静态文件
    const filename = path.resolve(root, name);
    if (filename.startsWith(root) || filename.includes("node_modules")) {
      try {
        if (fs.existsSync(filename)) {
          const fileState = fs.statSync(filename);
          // 只处理常规文件，忽略目录、socket、符号链接等
          if (
            fileState.isFile() &&
            !fileState.isSocket() &&
            !fileState.isFIFO()
          ) {
            return sendFile(filename);
          }
        }
      } catch (error) {
        // 忽略文件系统错误，继续处理
        console.warn(`文件访问错误: ${filename}`, (error as Error).message);
      }
    } else {
      // 安全检查：路径不在允许范围内
      return (ctx.status = 403);
    }

    // 3. 所有其他路径（包括 SPA 路由）都返回 index.html
    // 这样前端路由可以正确处理
    const indexFile = path.resolve(root, "index.html");
    if(!isDev) return sendFile(indexFile);
    const template = fs.readFileSync(indexFile, "utf8");
    ctx.type = "html";
    ctx.body = await webServer.vite!.transformIndexHtml(url, template);
  });
  // 定时通知客户端更新数据
  const dataUpdateInterval = setInterval(() => {
    notifyDataUpdate(webServer);
  }, 5000); // 每5秒通知一次更新
  setupWebSocket(webServer);
  // 插件卸载时清理定时器
  process.on("exit", () => {
    clearInterval(dataUpdateInterval);
  });
  register({
    name: "web",
    description: "web服务",
    async mounted() {
      return webServer;
    },
    async dispose(server) {
      await server.vite?.close();
      server.ws.close();
    },
  });
});
