import os from "node:os";
import {
  registerFetchRoute,
  type Router,
  type RouterContext,
} from "@zhin.js/host-router/router";

export type SystemOsMemory = {
  freeMem: number;
  totalMem: number;
};

export type SystemStatusData = {
  uptime: number;
  memory: Record<string, number> | NodeJS.MemoryUsage;
  osMemory?: SystemOsMemory;
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

function safeOsMemory(): SystemOsMemory | undefined {
  try {
    return {
      freeMem: os.freemem(),
      totalMem: os.totalmem(),
    };
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
      osMemory: safeOsMemory(),
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

export function registerSystemStatusRoute(router: Router, base: string): void {
  registerFetchRoute(router, "GET", `${base}/system/status`, (ctx: RouterContext) => {
    ctx.body = {
      success: true,
      data: getSystemStatusData(),
    };
  });
}
