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

let _pluginRuntimeActive = false;

/**
 * Plugin Runtime (`zhin runtime start`) 启动时调用。
 * 标记后 getPlugin()/usePlugin() 在 ALS 为空时抛出更明确的迁移提示，
 * 而非通用的 "must be called within a plugin context"。
 */
export function markPluginRuntimeActive(): void {
  _pluginRuntimeActive = true;
}

export function isPluginRuntimeActive(): boolean {
  return _pluginRuntimeActive;
}

/** 测试重置 */
export function resetPluginRuntimeFlag(): void {
  _pluginRuntimeActive = false;
}

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
 * @deprecated **已删除**。请使用 `definePlugin` + 约定目录；运行时通过 Scope+Token 访问服务。
 * @throws 总是抛出——仅保留签名供编译期过渡。
 */
export function getPlugin(): Plugin {
  throw new Error(
    'getPlugin() has been removed. Use `definePlugin` + convention directories, '
    + 'and access services via Scope+Token. '
    + 'See docs/contributing/public-api-surface.md',
  );
}
