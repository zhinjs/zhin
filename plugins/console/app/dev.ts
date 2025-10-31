import { ViteDevServer, createServer, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export interface DevServerOptions {
  /** 客户端代码根目录 */
  root: string;
  /** 基础路径，默认 /vite/ */
  base?: string;
  /** 是否启用 tailwindcss，默认 true */
  enableTailwind?: boolean;
}

/**
 * 创建 Vite 开发服务器
 * @param options 开发服务器选项
 * @returns Vite 开发服务器实例
 */
export async function createViteDevServer(
  options: DevServerOptions
): Promise<ViteDevServer> {
  const { root, base = "/vite/", enableTailwind = true } = options;

  const plugins = [react()];
  if (enableTailwind) {
    plugins.push(tailwindcss());
  }

  return await await createServer({
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
}