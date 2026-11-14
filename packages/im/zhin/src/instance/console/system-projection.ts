import os from 'node:os';
import type { EndpointRuntimeSummary } from '@zhin.js/core/runtime';
import type { ConsoleProcessSample } from '@zhin.js/console-protocol';

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
  /**
   * The same `memory` labeled as the instance process (#1250). `memory` and `process.memory` come
   * from one `process.memoryUsage()` call of this (instance) process; the gateway's own sample is in
   * `gateway.instance.status` → `gateway`.
   */
  readonly process?: ConsoleProcessSample;
};

/** Captures the process and operating-system values exposed by the Console status route. */
export function getSystemStatusData(): SystemStatusData {
  if (typeof process !== 'undefined' && process.versions?.node) {
    const memory = safeProcessMemory();
    const uptime = process.uptime();
    const sample = instanceSample(memory, uptime);
    return {
      uptime,
      memory,
      osMemory: safeOsMemory(),
      cpu: safeProcessCpu(),
      platform: process.platform,
      nodeVersion: process.version,
      runtime: 'node',
      pid: process.pid,
      timestamp: new Date().toISOString(),
      ...(sample ? { process: sample } : {}),
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

function instanceSample(memory: NodeJS.MemoryUsage | Record<string, number>, uptime: number): ConsoleProcessSample | undefined {
  const { rss, heapUsed, heapTotal, external, arrayBuffers } = memory as Partial<NodeJS.MemoryUsage>;
  if (typeof rss !== 'number' || typeof heapUsed !== 'number' || typeof heapTotal !== 'number') return undefined;
  return Object.freeze({
    role: 'instance' as const,
    pid: process.pid,
    uptime,
    memory: Object.freeze({
      rss, heapUsed, heapTotal,
      ...(typeof external === 'number' ? { external } : {}),
      ...(typeof arrayBuffers === 'number' ? { arrayBuffers } : {}),
    }),
    sampledAt: Date.now(),
  });
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
