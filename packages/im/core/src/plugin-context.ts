/**
 * Plugin 上下文管理 — AsyncLocalStorage + getPlugin
 *
 * 从 plugin.ts 提取的独立关注点，消除与 Plugin 类的循环依赖。
 * usePlugin() 保留在 plugin.ts（需要 Plugin 构造函数）。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "./plugin.js";

// ============================================================================
// AsyncLocalStorage 上下文
// ============================================================================

export const storage = new AsyncLocalStorage<Plugin>();

/**
 * 获取当前文件路径（调用者）
 */
export function getCurrentFile(metaUrl = import.meta.url): string {
  if (typeof metaUrl !== "string" || metaUrl.length === 0) {
    return path.join(process.cwd(), "__zhin_edge_bootstrap__.mjs");
  }
  const previousPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = function (_, stack) {
    return stack;
  };
  const stack = new Error().stack as unknown as NodeJS.CallSite[];
  Error.prepareStackTrace = previousPrepareStackTrace;
  const stackFiles = Array.from(
    new Set(stack.map((site) => site.getFileName()))
  );
  const idx = stackFiles.findIndex(
    (f) => (metaUrl.startsWith('file://') ? f === fileURLToPath(metaUrl) : false) || f === metaUrl
  );
  const result = stackFiles[idx + 1];
  if (!result) {
    return path.join(process.cwd(), "__zhin_edge_bootstrap__.mjs");
  }
  try {
    return fileURLToPath(result);
  } catch {
    return result;
  }
}

/**
 * getPlugin - 获取当前 AsyncLocalStorage 中的插件实例
 *
 * **调用时机（重要）**
 * - ✅ 插件**初始化/装配**阶段：模块顶层、register/init 函数内、注册命令/中间件/工具**之前**
 * - ❌ **运行时回调**内严禁调用：中间件、命令 `.action()`、工具 `.execute()`、Cron、生命周期 `.on()` 等
 *
 * 运行时回调应使用初始化时捕获的 `plugin` / `root` 闭包引用，而非再次 `getPlugin()`。
 * AsyncLocalStorage 在跨 await、线程池、部分平台适配器回调中可能丢失，导致线上 `getPlugin() must be called within a plugin context`。
 *
 * 插件作者优先在模块顶层使用 `usePlugin()` 解构 API，一般不需要 `getPlugin()`。
 * Bot 启动时框架调用 `setHostRootPlugin(root)`；运行时模块用 `getHostRootPlugin()` 代替 `getPlugin()`。
 *
 * @see docs/guide/plugin-development.md#getplugin-与-useplugin
 */
export function getPlugin(): Plugin {
  const plugin = storage.getStore();
  if (!plugin) {
    throw new Error('getPlugin() must be called within a plugin context');
  }
  return plugin;
}
