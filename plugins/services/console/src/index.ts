import { usePlugin } from "@zhin.js/core";
import { WebSocketServer } from "ws";
import mime from "mime";
import * as fs from "fs";
import * as path from "path";
import { setupWebSocket, notifyDataUpdate } from "./websocket.js";
import { transformFile, isTransformable } from "./transform.js";

export interface ConsoleConfig {
  /** 是否启用控制台插件，默认 true */
  enabled?: boolean;
  /** 端口号（继承自 http 配置） */
  port?: number;
}

export type WebEntry =
  | string
  | {
      production: string;
      development: string;
    };

export interface WebServer {
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

    // ── Token 映射：隐藏绝对路径 ──────────────────────────────────────────
    // token → 目录绝对路径。URL 只暴露 token + 相对文件名，不暴露服务器路径。
    const entryBases = new Map<string, string>();
    const genToken = () => Math.random().toString(36).slice(2, 8);

    // ── 开发模式文件监听（轻量 HMR：文件变更 → 通知客户端刷新） ──────────────
    const watchedDirs = new Set<string>();
    const watchers: fs.FSWatcher[] = [];
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;

    /** 广播刷新通知给所有 WebSocket 客户端，300ms 防抖 */
    const broadcastReload = (file: string) => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        const msg = JSON.stringify({ type: "hmr:reload", data: { file } });
        // webServer.ws 可能还未初始化，延迟访问
        const wss = webServer?.ws;
        if (wss) {
          for (const ws of wss.clients || []) {
            ws.send(msg);
          }
        }
        logger.info(`[HMR] 文件变更: ${file}，已通知客户端刷新`);
      }, 300);
    };

    /** 对一个目录启动 recursive watch，排除 node_modules */
    const watchDir = (dir: string) => {
      if (watchedDirs.has(dir)) return;
      watchedDirs.add(dir);
      try {
        const watcher = fs.watch(dir, { recursive: true }, (event, filename) => {
          if (!filename) return;
          // 排除 node_modules 内的变更
          if (filename.includes("node_modules")) return;
          broadcastReload(filename);
        });
        watcher.on("error", (err) => {
          logger.warn(`[HMR] 文件监听错误 (${dir}):`, (err as Error).message);
        });
        watchers.push(watcher);
        logger.info(`[HMR] 正在监听目录: ${dir}`);
      } catch (err) {
        logger.warn(`[HMR] 无法监听目录 (${dir}):`, (err as Error).message);
      }
    };

    // ── 双目录解析 ─────────────────────────────────────────────────────────
    // dev  → 源码从 client/，vendor 预构建文件从 dist/
    // prod → 全部从 dist/
    const clientDir = path.join(import.meta.dirname, "../client");
    const distDir = path.join(import.meta.dirname, "../dist");

    /** 解析文件路径：dev 先查 client/，再查 dist/；prod 只查 dist/ */
    const resolveFile = (name: string): string | null => {
      if (isDev) {
        const clientPath = path.resolve(clientDir, name);
        if (fs.existsSync(clientPath)) return clientPath;
      }
      const distPath = path.resolve(distDir, name);
      if (fs.existsSync(distPath)) return distPath;
      return null;
    };

    // 初始化 WebServer 对象
    const webServer: WebServer = {
      entries: {},
      addEntry(entry) {
        const hash = Date.now().toString(16) + Math.random().toString(16).slice(2, 8);
        const entryFile =
          typeof entry === "string"
            ? entry
            : isDev
              ? entry.development
              : entry.production;

        // 统一使用 token URL，dev/prod 都不暴露绝对路径
        const dir = path.dirname(entryFile);
        const filename = path.basename(entryFile);
        let token: string | undefined;
        for (const [t, d] of entryBases) {
          if (d === dir) { token = t; break; }
        }
        if (!token) { token = genToken(); entryBases.set(token, dir); }
        this.entries[hash] = `/vite/@ext/${token}/${filename}`;

        // 开发模式：监听入口文件所在目录，文件变更时通知客户端刷新
        if (isDev) watchDir(dir);

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

    logger.info(`Web 控制台已启动 (${isDev ? "开发模式, esbuild 按需转译 + 文件监听" : "生产模式, 静态文件 + 按需转译"})`);

    // SPA 回退路由 - 处理所有未匹配的路由
    router.all("*all", async (ctx, next) => {
      // 跳过 API 路由，交给其他路由处理器
      if (ctx.path.startsWith("/api/") || ctx.path === "/api") {
        return next();
      }

      const name = ctx.path.slice(1);

      const sendFile = async (filename: string) => {
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

        // TSX/TS/JSX 按需转译（dev 和 prod 都启用）
        if (isTransformable(filename)) {
          try {
            const code = await transformFile(filename);
            ctx.type = "application/javascript";
            ctx.body = code;
            return;
          } catch (e) {
            logger.warn(`转译失败: ${filename}`, (e as Error).message);
            ctx.status = 500;
            ctx.body = `/* transform error: ${(e as Error).message} */`;
            return;
          }
        }

        ctx.type = path.extname(filename);
        ctx.type = mime.getType(filename) || ctx.type;
        return (ctx.body = fs.createReadStream(filename));
      };

      // 0. 处理 /vite/@ext/ 路径（token 隐藏真实路径，dev/prod 均启用）
      if (ctx.path.startsWith("/vite/@ext/")) {
        const rest = ctx.path.replace("/vite/@ext/", "");
        const slashIdx = rest.indexOf("/");
        if (slashIdx === -1) { ctx.status = 404; return; }

        const token = rest.slice(0, slashIdx);
        const relPath = rest.slice(slashIdx + 1);
        const baseDir = entryBases.get(token);
        if (!baseDir) { ctx.status = 404; return; }

        const fullPath = path.resolve(baseDir, relPath);
        // 安全检查：防止 ../../ 路径穿越
        const safePfx = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
        if (!fullPath.startsWith(safePfx) && fullPath !== baseDir) { ctx.status = 403; return; }

        if (fs.existsSync(fullPath)) {
          return sendFile(fullPath);
        }
        ctx.status = 404;
        return;
      }

      // 1. 静态文件解析（dev: client/ → dist/ 双目录，prod: dist/ 单目录）
      const resolved = resolveFile(name);
      if (resolved) {
        try {
          const fileState = fs.statSync(resolved);
          if (fileState.isFile() && !fileState.isSocket() && !fileState.isFIFO()) {
            return sendFile(resolved);
          }
        } catch (error) {
          logger.warn(`文件访问错误: ${resolved}`, (error as Error).message);
        }
      }

      // 2. 所有其他路径（包括 SPA 路由）都返回 index.html
      const indexFile = resolveFile("index.html");
      if (indexFile) return sendFile(indexFile);
      ctx.status = 404;
    });

     // 初始化 WebSocket（触发 getter）
     const _ = webServer.ws;
     
     // 定时通知客户端更新数据
     const dataUpdateInterval = setInterval(() => {
       notifyDataUpdate(webServer);
     }, 5000); // 每5秒通知一次更新

     setupWebSocket(webServer);

    // 插件卸载时清理定时器和文件监听（使用 onDispose 而不是 process.on，支持热重载）
    onDispose(() => {
      clearInterval(dataUpdateInterval);
      if (reloadTimer) clearTimeout(reloadTimer);
      for (const w of watchers) w.close();
      watchers.length = 0;
      watchedDirs.clear();
    });

    // 注册 web 上下文
    provide({
      name: "web",
      description: "web服务",
      value: webServer,
      dispose(server) {
        return new Promise<void>((resolve) => {
          server.ws.close(() => resolve());
        });
      },
    });
  });
}
