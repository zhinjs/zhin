/**
 * 宿主根插件引用 — 在 Bot 启动/装配阶段注册，供运行时路径读取。
 * 避免在中间件、工具 execute、命令 action 等回调内调用 getPlugin()（ALS 易丢失）。
 */
import type { Plugin } from './plugin.js';

let hostRoot: Plugin | null = null;

export function setHostRootPlugin(plugin: Plugin | null): void {
  hostRoot = plugin ? (plugin.root ?? plugin) : null;
}

export function getHostRootPlugin(): Plugin | null {
  return hostRoot;
}
