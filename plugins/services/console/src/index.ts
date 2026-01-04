import { usePlugin } from "@zhin.js/core";
import { WebSocketServer } from "ws";
import type { ViteDevServer } from "vite";
import mime from "mime";
import * as fs from "fs";
import * as path from "path";
import { setupWebSocket, notifyDataUpdate } from "./websocket.js";

interface ViteDevServerOptions {
  root: string;
  base: string;
  enableTailwind: boolean;
}

export interface ConsoleConfig {
  /** 是否启用控制台插件，默认 true */
  enabled?: boolean;
  /** 是否延迟加载 Vite（开发模式），默认 true */
  /** 端口号（继承自 http 配置） */
  port?: number;
}

// 动态导入开发依赖的函数（运行时调用）
async function loadDevDependencies(): Promise<{
  createViteDevServer: (options: ViteDevServerOptions) => Promise<ViteDevServer>;
  connect: (handler: any) => any;
} | null> {
  try {
    const devModule = await import("./dev.js");
    const koaConnectModule = await import("koa-connect");
    return {
      createViteDevServer: devModule.createViteDevServer,
      connect: koaConnectModule.default,
    };
  } catch {
    return null;
  }
}

export type WebEntry =
  | string
  | {
    production: string;
    development: string;
  };

export interface WebServer {
  vite?: ViteDevServer;
  addEntry(entry: WebEntry): () => void;
  entries: Record<string, string>;
  ws: WebSocketServer;
}

declare module "@zhin.js/core" {
  namespace Plugin {
    interface Contexts {
      web: WebServer;
      router: import("@zhin.js/http").Router;
    }
  }
}

interface WebSocketMessage {
  type: string;
  requestId?: string;
  data?: unknown;
  error?: string;
}

interface SyncMessage {
  type: "sync";
  data: {
    key: string;
    value: unknown;
  };
}

interface AddMessage {
  type: "add";
  data: {
    key: string;
    value: unknown;
  };
}

interface DeleteMessage {
  type: "delete";
  data: {
    key: string;
    value: unknown;
  };
}

const { provide, root, useContext, logger, inject, onDispose } = usePlugin();

// 读取配置
const configService = inject('config');
const appConfig = (configService?.get('zhin.config.yml') || {}) as any;
const consoleConfig: ConsoleConfig = appConfig.plugins?.console || {};
const {
  enabled = true,// 默认不延迟加载，避免 addEntry 等功能不可用
} = consoleConfig;

if (enabled) {

  const createSyncMsg = (key: string, value: unknown): SyncMessage => ({
    type: "sync",
    data: { key, value },
  });

  const createAddMsg = (key: string, value: unknown): AddMessage => ({
    type: "add",
    data: { key, value },
  });

  const createDeleteMsg = (key: string, value: unknown): DeleteMessage => ({
    type: "delete",
    data: { key, value },
  });

  useContext("router", async (router) => {
    const base = "/vite/";

    const isDev = process.env.NODE_ENV === "development";
    const rootDir = isDev
      ? path.join(import.meta.dirname, "../client")
      : path.join(import.meta.dirname, "../dist");

    // Vite 延迟加载状态
    let viteStarting = false;
    let viteStarted = false;
    let devDeps: Awaited<ReturnType<typeof loadDevDependencies>> = null;

    // 立即初始化 WebServer 对象（不启动 Vite 和 WebSocket）
    const webServer: WebServer = {
      entries: {},
      addEntry(entry) {
        const hash = Date.now().toString(16) + Math.random().toString(16).slice(2, 8);
        const entryFile =
          typeof entry === "string"
            ? entry
            : entry[(process.env.NODE_ENV as "development" | "production") || "development"];
        this.entries[hash] = `/vite/@fs/${entryFile}`;
        // 延迟访问 ws，确保它已初始化
        if (this.ws) {
          for (const ws of this.ws.clients || []) {
            ws.send(JSON.stringify(createAddMsg("entries", this.entries[hash])));
          }
        }
        return () => {
          if (this.ws) {
            for (const ws of this.ws.clients || []) {
              ws.send(JSON.stringify(createDeleteMsg("entries", this.entries[hash])));
            }
          }
          delete this.entries[hash];
        };
      },
      ws: router.ws("/server"),
    } as WebServer;
    const ensureViteStarted = async () => {
      if (viteStarted || viteStarting || !isDev) return;
      viteStarting = true;

      try {
        logger.info("🔄 检测到控制台访问，正在启动 Vite 开发服务器...");
        devDeps = await loadDevDependencies();

        if (devDeps) {
          webServer.vite = await devDeps.createViteDevServer({
            root: rootDir,
            base,
            enableTailwind: true,
          });
          viteStarted = true;
          logger.info("╔════════════════════════════════════════╗");
          logger.info("║   Web 控制台已启动 (按需加载)         ║");
          logger.info("╠════════════════════════════════════════╣");
          logger.info("║  地址: http://localhost:8086/          ║");
          logger.info("║  模式: 开发模式 (Vite HMR)             ║");
          logger.info("║  内存: 已加载 (~23MB)                  ║");
          logger.info("╚════════════════════════════════════════╝");
        }
      } catch (error) {
        logger.error("Vite 启动失败:", error);
      } finally {
        viteStarting = false;
      }
    };

    if (isDev) {
      // 立即加载模式：启动时就启动 Vite
      await ensureViteStarted();

      router.use(async (ctx, next) => {
        if (ctx.request.originalUrl.startsWith("/api")) return next();
        if (webServer.vite && devDeps) {
          return devDeps.connect(webServer.vite.middlewares)(ctx as any, next);
        }
        return next();
      });
    } else {
      router.use((ctx, next) => {
        if (ctx.request.originalUrl.startsWith("/api")) return next();
        if (!ctx.path.startsWith("/vite/@fs/")) return next();
        const filename = ctx.path.replace(`/vite/@fs/`, "");
        if (!fs.existsSync(filename)) return next();
        ctx.type = mime.getType(filename) || path.extname(filename);
        ctx.body = fs.createReadStream(filename);
      });
      logger.info("╔════════════════════════════════════════╗");
      logger.info("║      Web 控制台已启动                  ║");
      logger.info("╠════════════════════════════════════════╣");
      logger.info("║  地址: http://localhost:8086/          ║");
      logger.info("║  模式: 生产模式 (静态文件)             ║");
      logger.info("╚════════════════════════════════════════╝");
    }

    // SPA 回退路由 - 处理所有未匹配的路由
    router.all("*all", async (ctx, next) => {
      const url = ctx.request.originalUrl.replace(base, "");
      const name = ctx.path.slice(1);

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
      const filename = path.resolve(rootDir, name);
      if (filename.startsWith(rootDir) || filename.includes("node_modules")) {
        try {
          if (fs.existsSync(filename)) {
            const fileState = fs.statSync(filename);
            // 只处理常规文件，忽略目录、socket、符号链接等
            if (fileState.isFile() && !fileState.isSocket() && !fileState.isFIFO()) {
              return sendFile(filename);
            }
          }
        } catch (error) {
          // 忽略文件系统错误，继续处理
          logger.warn(`文件访问错误: ${filename}`, (error as Error).message);
        }
      } else {
        // 安全检查：路径不在允许范围内
        return (ctx.status = 403);
      }

      // 3. 所有其他路径（包括 SPA 路由）都返回 index.html
      // 这样前端路由可以正确处理
      const indexFile = path.resolve(rootDir, "index.html");
      if (!isDev) return sendFile(indexFile);
      const template = fs.readFileSync(indexFile, "utf8");
      ctx.type = "html";
      ctx.body = await webServer.vite?.transformIndexHtml(url, template)||template;
    });

     // 初始化 WebSocket（触发 getter）
     const _ = webServer.ws;
     
     // 定时通知客户端更新数据
     const dataUpdateInterval = setInterval(() => {
       notifyDataUpdate(webServer);
     }, 5000); // 每5秒通知一次更新

     setupWebSocket(webServer);

    // 插件卸载时清理定时器（使用 onDispose 而不是 process.on，支持热重载）
    onDispose(() => {
      clearInterval(dataUpdateInterval);
    });

    // 注册 web 上下文
    provide({
      name: "web",
      description: "web服务",
      value: webServer,
      dispose(server) {
        return Promise.all([
          server.vite?.close(),
          new Promise<void>((resolve) => {
            server.ws.close(() => resolve());
          }),
        ]);
      },
    });
  });
}

