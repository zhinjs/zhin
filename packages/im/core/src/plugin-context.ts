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
    (f) => f === fileURLToPath(metaUrl) || f === metaUrl
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
 * 用于 extensions 等场景，不创建新插件
 */
export function getPlugin(): Plugin {
  const plugin = storage.getStore();
  if (!plugin) {
    throw new Error('getPlugin() must be called within a plugin context');
  }
  return plugin;
}
