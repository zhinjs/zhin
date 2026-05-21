import type { RouteTable } from "./route-table.js";
import type { RouterContext } from "./router-context.js";
import { registerFetchRoute } from "./register-fetch-route.js";

export type SystemStatusData = {
  uptime: number;
  memory: Record<string, number> | NodeJS.MemoryUsage;
  cpu?: { user: number; system: number };
  platform: string;
  nodeVersion?: string;
  denoVersion?: string;
  runtime: "node" | "deno" | "unknown";
  pid?: number;
  timestamp: string;
};

/** Host (Node) / Edge (Deno) 兼容的系统状态快照 */
export function getSystemStatusData(): SystemStatusData {
  const deno = (globalThis as { Deno?: { build: { os: string }; version: { deno: string }; memoryUsage: () => Record<string, number> } }).Deno;
  if (deno) {
    return {
      uptime: performance.now() / 1000,
      memory: deno.memoryUsage(),
      platform: deno.build.os,
      denoVersion: deno.version.deno,
      runtime: "deno",
      timestamp: new Date().toISOString(),
    };
  }
  if (typeof process !== "undefined" && process.versions?.node) {
    return {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      platform: process.platform,
      nodeVersion: process.version,
      runtime: "node",
      pid: process.pid,
      timestamp: new Date().toISOString(),
    };
  }
  return {
    uptime: 0,
    memory: {},
    platform: "unknown",
    runtime: "unknown",
    timestamp: new Date().toISOString(),
  };
}

/** 与 @zhin.js/http 插件 `GET {base}/system/status` 一致 */
export function registerSystemStatusRoute(table: RouteTable, base: string): void {
  registerFetchRoute(table, "GET", `${base}/system/status`, (ctx: RouterContext) => {
    ctx.body = {
      success: true,
      data: getSystemStatusData(),
    };
  });
}
