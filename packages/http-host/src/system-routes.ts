import type { RouteTable } from "./route-table.js";
import type { RouterContext } from "./router-context.js";
import { registerFetchRoute } from "./register-fetch-route.js";

export type SystemStatusData = {
  uptime: number;
  memory: Record<string, number> | NodeJS.MemoryUsage;
  cpu?: { user: number; system: number };
  platform: string;
  nodeVersion?: string;
  runtime: "node" | "unknown";
  pid?: number;
  timestamp: string;
};

function safeProcessMemory(): NodeJS.MemoryUsage | Record<string, number> {
  try {
    return process.memoryUsage();
  } catch {
    return {};
  }
}

function safeProcessCpu(): { user: number; system: number } | undefined {
  try {
    return typeof process.cpuUsage === "function" ? process.cpuUsage() : undefined;
  } catch {
    return undefined;
  }
}

/** Host (Node) 系统状态快照 */
export function getSystemStatusData(): SystemStatusData {
  if (typeof process !== "undefined" && process.versions?.node) {
    return {
      uptime: process.uptime(),
      memory: safeProcessMemory(),
      cpu: safeProcessCpu(),
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
