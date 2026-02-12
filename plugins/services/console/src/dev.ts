import type { ViteDevServer } from "vite";
import path from "path";
import fs from "fs";

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
  
  try {
    // 动态导入所有 Vite 相关依赖（避免提前加载）
    const [
      { createServer, searchForWorkspaceRoot },
      { default: react },
      { default: tailwindcss }
    ] = await Promise.all([
      import('vite'),
      import('@vitejs/plugin-react'),
      import('@tailwindcss/vite')
    ]);
    
  const plugins = [react()];
  if (enableTailwind) {
    plugins.push(tailwindcss());
  }
  const clientPath = path.resolve(process.cwd(), 'node_modules/@zhin.js/client/client')
  if (!fs.existsSync(clientPath)) {
    throw new Error('@zhin.js/client not found')
  }
    return await createServer({
    root,
    base,
    plugins: [react(), tailwindcss()],
    server: {
      middlewareMode: true,
      allowedHosts: true,
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
        "@zhin.js/client": path.resolve(process.cwd(), "node_modules/@zhin.js/client/client"),
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
  } catch (error) {
    throw new Error(
      `Failed to create Vite dev server. ` +
      `Make sure all development dependencies are installed: ` +
      `vite, @vitejs/plugin-react, @tailwindcss/vite. ` +
      `Run: pnpm install --include=optional\n` +
      `Original error: ${(error as Error).message}`
    );
  }
}
