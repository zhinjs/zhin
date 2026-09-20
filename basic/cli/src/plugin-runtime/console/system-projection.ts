import os from 'node:os';
import type { EndpointRuntimeSummary } from '@zhin.js/core/runtime';

export type SystemOsMemory = {
  readonly freeMem: number;
  readonly totalMem: number;
};

export type SystemStatusData = {
  readonly uptime: number;
  readonly memory: NodeJS.MemoryUsage | Record<string, number>;
  readonly osMemory?: SystemOsMemory;
  readonly cpu?: { readonly user: number; readonly system: number };
  readonly platform: string;
  readonly nodeVersion?: string;
  readonly runtime: 'node' | 'unknown';
  readonly pid?: number;
  readonly timestamp: string;
};

/** Captures the process and operating-system values exposed by the Console status route. */
export function getSystemStatusData(): SystemStatusData {
  if (typeof process !== 'undefined' && process.versions?.node) {
    return {
      uptime: process.uptime(),
      memory: safeProcessMemory(),
      osMemory: safeOsMemory(),
      cpu: safeProcessCpu(),
      platform: process.platform,
      nodeVersion: process.version,
      runtime: 'node',
      pid: process.pid,
      timestamp: new Date().toISOString(),
    };
  }
  return {
    uptime: 0,
    memory: {},
    platform: 'unknown',
    runtime: 'unknown',
    timestamp: new Date().toISOString(),
  };
}

function safeProcessMemory(): NodeJS.MemoryUsage | Record<string, number> {
  try {
    return process.memoryUsage();
  } catch {
    return {};
  }
}

function safeProcessCpu(): { user: number; system: number } | undefined {
  try {
    return typeof process.cpuUsage === 'function' ? process.cpuUsage() : undefined;
  } catch {
    return undefined;
  }
}

function safeOsMemory(): SystemOsMemory | undefined {
  try {
    return { freeMem: os.freemem(), totalMem: os.totalmem() };
  } catch {
    return undefined;
  }
}

export type ConsoleStatsData = {
  readonly plugins: { readonly total: number; readonly active: number };
  readonly endpoints: { readonly total: number; readonly online: number };
  readonly uptime: number;
  /** Heap usage in MB, as consumed by the dashboard. */
  readonly memory: number;
  readonly runtime: 'node' | 'unknown';
};

type EndpointStatusView = Pick<EndpointRuntimeSummary, 'status'>;

export function buildConsoleStats(
  pluginCount: number,
  endpoints: readonly EndpointStatusView[],
): ConsoleStatsData {
  const status = getSystemStatusData();
  const heapUsed = typeof status.memory.heapUsed === 'number' ? status.memory.heapUsed : 0;
  return {
    plugins: { total: pluginCount, active: pluginCount },
    endpoints: {
      total: endpoints.length,
      online: endpoints.filter((endpoint) => endpoint.status === 'online').length,
    },
    uptime: status.uptime,
    memory: heapUsed / 1024 / 1024,
    runtime: status.runtime,
  };
}
