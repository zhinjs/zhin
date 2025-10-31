import { build, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";

export interface BuildOptions {
  /** 插件根目录 */
  pluginRoot: string;
  /** 输出目录，默认为 pluginRoot/dist */
  outDir?: string;
  /** 是否启用 tailwindcss，默认 true */
  enableTailwind?: boolean;
}

export interface ConsoleBuildOptions {
  /** Console 插件根目录 */
  consoleRoot: string;
  /** 输出目录，默认为 consoleRoot/dist */
  outDir?: string;
}

/**
 * 查找插件的客户端入口文件
 * @param pluginRoot 插件根目录
 * @returns 入口文件路径，如果不存在则返回 null
 */
function findClientEntry(pluginRoot: string): string | null {
  const possibleEntries = [
    path.join(pluginRoot, "client/index.tsx"),
    path.join(pluginRoot, "client/index.ts"),
    path.join(pluginRoot, "src/main.tsx"),
    path.join(pluginRoot, "src/main.ts"),
  ];

  for (const entry of possibleEntries) {
    if (fs.existsSync(entry)) {
      return entry;
    }
  }

  return null;
}

/**
 * 验证构建环境
 * @param pluginRoot 插件根目录
 * @throws 如果环境不满足构建要求
 */
function validateBuildEnvironment(pluginRoot: string): void {
  if (!fs.existsSync(pluginRoot)) {
    throw new Error(`Plugin root directory does not exist: ${pluginRoot}`);
  }

  const entry = findClientEntry(pluginRoot);
  if (!entry) {
    throw new Error(
      `No client entry file found in ${pluginRoot}. Looking for: client/index.tsx, client/index.ts, src/main.tsx, or src/main.ts`
    );
  }
}

/**
 * 构建插件的客户端代码（单文件模式）
 * 用于构建普通插件的 client/index.tsx 文件
 * 
 * 策略：将公共依赖配置为 external，运行时从 console 加载的 vendor chunks 中复用
 * @param options 构建选项
 */
export async function buildPluginClient(options: BuildOptions): Promise<void> {
  const {
    pluginRoot,
    outDir = path.join(pluginRoot, "dist"),
    enableTailwind = true,
  } = options;

  // 验证构建环境
  validateBuildEnvironment(pluginRoot);

  const entry = findClientEntry(pluginRoot);
  if (!entry) {
    throw new Error(`No client entry file found in ${pluginRoot}`);
  }

  const plugins = [react()];
  if (enableTailwind) {
    plugins.push(tailwindcss());
  }

  // 构建配置 - 库模式
  const clientRoot = path.dirname(entry);

  await build({
    root: clientRoot,
    plugins,
    build: {
      outDir,
      emptyOutDir: true,
      lib: {
        entry,
        formats: ["es"],
        fileName: "index",
      },
      rollupOptions: {
        makeAbsoluteExternalsRelative: true,
        external:[
          'react',
          'react-dom',
          'react/jsx-runtime',
          'clsx',
          'tailwind-merge',
          'lucide-react',
          '@radix-ui/themes'
        ],
      },
    },
    resolve:{
      dedupe: [
        "react",
        "react-dom",
        "clsx",
        "tailwind-merge",
      ],
      alias: {
        "@": path.resolve(pluginRoot, "client/src"),
      },
    }
  });

  console.log(`✅ Plugin client code built successfully: ${outDir}`);
  console.log(`📦 External dependencies will be loaded from console vendor chunks`);
}

/**
 * 构建 Console 插件的客户端代码（SPA 应用模式）
 * Console 有完整的 index.html 和 src 目录结构
 * @param options Console 构建选项
 */
export async function buildConsoleClient(
  options: ConsoleBuildOptions
): Promise<void> {
  const { consoleRoot, outDir = path.join(consoleRoot, "dist") } = options;

  const clientRoot = path.join(consoleRoot, "client");

  // 检查 client 目录是否存在
  if (!fs.existsSync(clientRoot)) {
    throw new Error(`Console client directory does not exist: ${clientRoot}`);
  }

  // 检查 index.html 是否存在
  const indexHtml = path.join(clientRoot, "index.html");
  if (!fs.existsSync(indexHtml)) {
    throw new Error(`index.html not found in: ${clientRoot}`);
  }

  const workspaceRoot = searchForWorkspaceRoot(consoleRoot);
  const consoleClientRoot=path.resolve(workspaceRoot, "plugins/client/client")
  const plugins = [react(), tailwindcss()];

  await build({
    root: clientRoot,
    plugins,
    build: {
      outDir,
      emptyOutDir: true,
      // 设置最小 chunk 大小，避免过度分割
      chunkSizeWarningLimit: 1000,
      // SPA 应用模式，不是库模式
      rollupOptions: {
        input: indexHtml,
        // 保留导出签名
        preserveEntrySignatures: 'strict',
        output: {
          // 确保文件名稳定，不使用哈希，方便插件引用
          chunkFileNames: '[name].js',
          entryFileNames: '[name].js',
          assetFileNames: '[name].[ext]',
        },
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
        "@zhin.js/client": consoleClientRoot,
        "@": path.resolve(clientRoot, "src"),
      },
    },
  });

  console.log(`✅ Console client built successfully: ${outDir}`);
}

/**
 * 构建当前目录的插件客户端代码
 */
export async function buildCurrentPlugin(): Promise<void> {
  const currentDir = process.cwd();
  await buildPluginClient({
    pluginRoot: currentDir,
  });
}
