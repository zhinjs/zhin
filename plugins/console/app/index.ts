import { register, useContext, useApp } from "@zhin.js/core";
import react from "@vitejs/plugin-react";
import WebSocket, { WebSocketServer } from "ws";
import { createServer, ViteDevServer, searchForWorkspaceRoot } from "vite";
import connect from "koa-connect";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";

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
  vite: ViteDevServer;
  addEntry(entry: WebEntry): () => void;
  entries: Record<string, string>;
  ws: WebSocketServer;
};
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
  const root = path.join(import.meta.dirname, "../client");
  const base = "/vite/";

  const vite = await createServer({
    root,
    base,
    plugins: [react(), tailwindcss()],
    server: {
      middlewareMode: true,
      fs: {
        strict: false,
        // 添加文件访问过滤，避免访问特殊文件
        allow: [
          // 允许访问的目录
          root,
          searchForWorkspaceRoot(root),
          path.resolve(process.cwd(), 'node_modules'),
          path.resolve(process.cwd(), 'client'),
          path.resolve(process.cwd(), 'src'),
        ],
        // 拒绝访问某些文件模式
        deny: [
          '**/.git/**',
          '**/node_modules/.cache/**',
          '**/*.socket',
          '**/*.pipe',
          '**/Dockerfile*',
          '**/.env*',
        ],
      },
    },
    resolve: {
      dedupe: [
        "react",
        "react-dom",
        "clsx",
        "tailwind-merge",
        "@reduxjs/toolkit",
        "react-router",
        "react-redux",
        "redux-persist",
      ],
      alias: {
        "@zhin.js/client": path.resolve(root, "../../client/client"),
        "@": path.resolve(root, "../client/src"),
      },
    },
    optimizeDeps: {
      include: ["react", "react-dom"],
    },
    build: {
      rollupOptions: {
        input: root + "/index.html",
      },
    },
  });

  // Vite 中间件 - 必须在其他路由之前
  router.use((ctx: any, next: any) => {
    if (ctx.request.originalUrl.startsWith("/api")) return next();
    return connect(vite.middlewares)(ctx, next);
  });

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
      if (filename.endsWith(".ts")) ctx.type = "text/javascript";
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
          if (fileState.isFile() && !fileState.isSocket() && !fileState.isFIFO()) {
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
    const template = fs.readFileSync(path.resolve(root, "index.html"), "utf8");
    ctx.type = "html";
    ctx.body = await vite.transformIndexHtml(url, template);
  });

  const webServer: WebServer = {
    vite,
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
      this.entries[hash] = `/vite/@fs/${entryFile}`;
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
  // 数据推送函数
  const broadcastToAll = (message: any) => {
    for (const ws of webServer.ws.clients || []) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    }
  };

  // 推送数据更新通知
  const notifyDataUpdate = () => {
    broadcastToAll({
      type: "data-update",
      timestamp: Date.now(),
    });
  };

  // WebSocket 连接处理
  webServer.ws.on("connection", (ws: WebSocket) => {
    // 发送初始数据
    ws.send(
      JSON.stringify(
        createSyncMsg(
          "entries",
          Array.from(new Set(Object.values(webServer.entries)))
        )
      )
    );

    // 通知客户端进行数据初始化
    ws.send(
      JSON.stringify({
        type: "init-data",
        timestamp: Date.now(),
      })
    );

    // 处理 WebSocket 消息
    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        const { type, pluginName, requestId } = message;

        // 获取应用实例
        const app = useApp();

        switch (type) {
          case "config:get":
            try {
              let config;
              if (pluginName === "app") {
                config = app.getConfig();
              } else {
                const plugin = app.findPluginByName(pluginName);
                if (!plugin) {
                  throw new Error(`Plugin ${pluginName} not found`);
                }
                config = plugin.config;
              }

              ws.send(
                JSON.stringify({
                  requestId,
                  data: config,
                })
              );
            } catch (error) {
              ws.send(
                JSON.stringify({
                  requestId,
                  error: (error as Error).message,
                })
              );
            }
            break;

          case "config:set":
            try {
              const { data: newConfig } = message;

              if (pluginName === "app") {
                app.config = newConfig;
              } else {
                const plugin = app.findPluginByName(pluginName);
                if (!plugin) {
                  throw new Error(`Plugin ${pluginName} not found`);
                }
                plugin.config = newConfig;
              }

              // 响应成功
              ws.send(
                JSON.stringify({
                  requestId,
                  data: "success",
                })
              );

              // 广播配置更新
              webServer.ws.clients.forEach((client) => {
                if (client.readyState === 1) {
                  // WebSocket.OPEN
                  client.send(
                    JSON.stringify({
                      type: "config:updated",
                      pluginName,
                      data: newConfig,
                    })
                  );
                }
              });
            } catch (error) {
              ws.send(
                JSON.stringify({
                  requestId,
                  error: (error as Error).message,
                })
              );
            }
            break;

          case "schema:get":
            try {
              let schema;
              if (pluginName === "app") {
                schema = app.schema?.toJSON();
              } else {
                const plugin = app.findPluginByName(pluginName);
                if (!plugin) {
                  throw new Error(`Plugin ${pluginName} not found`);
                }
                schema = plugin.schema?.toJSON();
              }

              ws.send(
                JSON.stringify({
                  requestId,
                  data: schema,
                })
              );
            } catch (error) {
              ws.send(
                JSON.stringify({
                  requestId,
                  error: (error as Error).message,
                })
              );
            }
            break;

          case "config:get-all":
            try {
              const configs: Record<string, any> = {};

              // 获取 App 配置
              configs["app"] = app.getConfig();

              // 获取所有插件配置
              for (const plugin of app.dependencyList) {
                if (plugin.config && Object.keys(plugin.config).length > 0) {
                  configs[plugin.name] = plugin.config;
                }
              }

              ws.send(
                JSON.stringify({
                  requestId,
                  data: configs,
                })
              );
            } catch (error) {
              ws.send(
                JSON.stringify({
                  requestId,
                  error: (error as Error).message,
                })
              );
            }
            break;

          case "schema:get-all":
            try {
              const schemas: Record<string, any> = {};

              // 获取 App Schema
              const appSchema = app.schema?.toJSON();
              if (appSchema) {
                schemas["app"] = appSchema;
              }

              // 获取所有插件 Schema
              for (const plugin of app.dependencyList) {
                const schema = plugin.schema?.toJSON();
                if (schema) {
                  schemas[plugin.name] = schema;
                }
              }

              ws.send(
                JSON.stringify({
                  requestId,
                  data: schemas,
                })
              );
            } catch (error) {
              ws.send(
                JSON.stringify({
                  requestId,
                  error: (error as Error).message,
                })
              );
            }
            break;

          // 其他消息类型保持不变，让 console 插件自己处理
        }
      } catch (error) {
        console.error("WebSocket 消息处理错误:", error);
        ws.send(
          JSON.stringify({
            error: "Invalid message format",
          })
        );
      }
    });

    ws.on("close", () => {});

    ws.on("error", (error) => {
      // console.error 已替换为注释
    });
  });

  // 定时通知客户端更新数据
  const dataUpdateInterval = setInterval(() => {
    notifyDataUpdate();
  }, 5000); // 每5秒通知一次更新

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
      await server.vite.close();
      server.ws.close();
    },
  });
});
