import type { Plugin } from '@zhin.js/core';
import { formatCompact } from '@zhin.js/logger';

/** ADR 0013 D2 — 全局 shutdown 硬超时 */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

const TASK_DRAIN_MS = 5_000;

let shuttingDown = false;

export interface GracefulShutdownOptions {
  plugin: Plugin;
  exitCode?: number;
}

async function drainTaskExecutorLocks(timeoutMs: number): Promise<void> {
  try {
    const mod = await import('@zhin.js/agent/task-executor');
    if (typeof mod.drainTaskExecutorLocks === 'function') {
      await mod.drainTaskExecutorLocks(timeoutMs);
    }
  } catch {
    // agent 未加载
  }
}

async function stopHostLayer(): Promise<void> {
  try {
    const mod = await import('@zhin.js/host-api');
    if (typeof mod.stopSseHub === 'function') {
      mod.stopSseHub();
    }
  } catch {
    // host-api 未安装
  }
}

/**
 * ADR 0013 — 进程级优雅关闭：先 drain 任务，再 plugin.stop()（Agent / DB / 适配器），最后 Host 资源。
 */
export async function gracefulShutdown(
  signal: string,
  options: GracefulShutdownOptions,
): Promise<never> {
  if (shuttingDown) {
    process.exit(1);
  }
  shuttingDown = true;

  const { plugin, exitCode = 0 } = options;
  plugin.logger.info(formatCompact({ shutdown: signal, code: 'shutdown_start' }));

  const forceTimer = setTimeout(() => {
    plugin.logger.warn(formatCompact({
      code: 'shutdown_timeout',
      ms: SHUTDOWN_TIMEOUT_MS,
    }));
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  let code = exitCode;
  try {
    await drainTaskExecutorLocks(TASK_DRAIN_MS);
    await plugin.stop();
    await stopHostLayer();
  } catch (err) {
    code = code || 1;
    plugin.logger.error(
      formatCompact({
        code: 'shutdown_error',
        error: err instanceof Error ? err.message : String(err),
      }),
      err instanceof Error ? err : undefined,
    );
  } finally {
    clearTimeout(forceTimer);
    process.exit(code);
  }
}

export function registerGracefulShutdown(plugin: Plugin): void {
  const onSignal = (signal: string) => {
    void gracefulShutdown(signal, { plugin });
  };

  process.once('SIGTERM', () => onSignal('SIGTERM'));
  process.once('SIGINT', () => onSignal('SIGINT'));
}
