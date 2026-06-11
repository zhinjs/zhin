/**
 * ADR 0014 P2-1 — 关键全局 Map / RSS 内存压力监控
 */
import { formatCompact, Logger } from '@zhin.js/logger';
import { getCompactionStateCount, evictCompactionStatesIfOverPressure } from '../zhin-agent/compaction-runtime.js';
import {
  getPendingOrchestrationCount,
  evictPendingOrchestrationIfOverPressure,
} from '../security/owner-approve-always-store.js';

const defaultLogger = new Logger(null, 'StabilityMonitor');

export interface StabilityMetricCollector {
  name: string;
  collect: () => number;
  /** 超过此值打 warn */
  threshold: number;
  /** 超过 2×threshold 时调用 */
  evict?: () => number;
}

export interface StabilityMetricSnapshot {
  compactionStates: number;
  pendingOrchestration: number;
  sseSubscribers?: number;
  rssMb?: number;
  [key: string]: number | undefined;
}

export interface StabilityMonitorOptions {
  intervalMs?: number;
  logger?: Logger;
  collectors?: StabilityMetricCollector[];
  includeRss?: boolean;
}

const DEFAULT_COLLECTORS: StabilityMetricCollector[] = [
  {
    name: 'compactionStates',
    collect: getCompactionStateCount,
    threshold: 4000,
    evict: evictCompactionStatesIfOverPressure,
  },
  {
    name: 'pendingOrchestration',
    collect: getPendingOrchestrationCount,
    threshold: 100,
    evict: evictPendingOrchestrationIfOverPressure,
  },
];

type HostApiMetrics = { sseSubscriberCount?: () => number };

async function collectSseSubscriberCount(): Promise<number | undefined> {
  try {
    // 可选依赖：避免 @zhin.js/agent 编译期硬依赖 host-api
    const dynamicImport = new Function(
      'specifier',
      'return import(specifier)',
    ) as (specifier: string) => Promise<HostApiMetrics>;
    const mod = await dynamicImport('@zhin.js/host-api');
    return mod.sseSubscriberCount?.();
  } catch {
    return undefined;
  }
}

export async function collectStabilityMetrics(
  options: { includeRss?: boolean; includeSse?: boolean } = {},
): Promise<StabilityMetricSnapshot> {
  const snapshot: StabilityMetricSnapshot = {
    compactionStates: getCompactionStateCount(),
    pendingOrchestration: getPendingOrchestrationCount(),
  };

  if (options.includeSse !== false) {
    const sse = await collectSseSubscriberCount();
    if (sse !== undefined) snapshot.sseSubscribers = sse;
  }

  if (options.includeRss !== false && typeof process.memoryUsage === 'function') {
    snapshot.rssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
  }

  return snapshot;
}

export function startStabilityMonitor(options: StabilityMonitorOptions = {}): () => void {
  const log = options.logger ?? defaultLogger;
  const intervalMs = options.intervalMs ?? 60_000;
  const collectors = options.collectors ?? DEFAULT_COLLECTORS;
  const includeRss = options.includeRss !== false;

  const timer = setInterval(() => {
    void (async () => {
      try {
        for (const { name, collect, threshold, evict } of collectors) {
          const size = collect();
          if (size >= threshold * 2) {
            const removed = evict?.() ?? 0;
            log.warn(formatCompact({
              code: 'memory_pressure_evict',
              metric: name,
              size,
              threshold,
              removed,
            }));
          } else if (size >= threshold) {
            log.warn(formatCompact({
              code: 'memory_pressure_warn',
              metric: name,
              size,
              threshold,
            }));
          }
        }

        if (includeRss) {
          const metrics = await collectStabilityMetrics({ includeSse: true, includeRss: true });
          if (metrics.sseSubscribers !== undefined && metrics.sseSubscribers >= 500) {
            log.warn(formatCompact({
              code: 'memory_pressure_warn',
              metric: 'sseSubscribers',
              size: metrics.sseSubscribers,
              threshold: 500,
            }));
          }
          log.debug(formatCompact({
            code: 'stability_metrics',
            ...metrics,
          }));
        }
      } catch (err) {
        log.error(formatCompact({
          code: 'stability_monitor_error',
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    })();
  }, intervalMs);

  timer.unref?.();
  return () => clearInterval(timer);
}
