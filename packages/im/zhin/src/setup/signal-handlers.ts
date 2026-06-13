import type { Plugin } from '@zhin.js/core';
import { formatCompact } from '@zhin.js/logger';
import { registerGracefulShutdown, gracefulShutdown } from '../shutdown.js';

/**
 * 启动核心上下文并注册优雅关闭与异常处理
 * 使用 ADR 0013 优雅关闭协议（带硬超时和任务 drain）。
 */
export async function registerSignalHandlers(plugin: Plugin): Promise<void> {
  const { start, logger } = plugin;

  await start();

  // 使用 ADR 0013 优雅关闭（10s 硬超时 + 任务 drain）
  registerGracefulShutdown(plugin);

  const handleUncaughtException = (error: Error) => {
    logger.error('Uncaught exception:', error);
    // 使用 exitCode=1 让 gracefulShutdown 以非零码退出
    void gracefulShutdown('uncaughtException', { plugin, exitCode: 1 });
  };

  const handleUnhandledRejection = (reason: unknown) => {
    if (reason instanceof Error) {
      logger.error('Unhandled rejection (进程继续运行):', reason.message);
      logger.debug(reason.stack);
    } else {
      const msg =
        typeof reason === 'object' && reason !== null && 'message' in reason
          ? (reason as { message?: string }).message ?? String(reason)
          : String(reason);
      logger.error('Unhandled rejection (进程继续运行):', msg);
    }
  };

  process.removeListener('uncaughtException', handleUncaughtException);
  process.removeListener('unhandledRejection', handleUnhandledRejection);

  process.on('uncaughtException', handleUncaughtException);
  process.on('unhandledRejection', handleUnhandledRejection);

  plugin.onDispose(() => {
    process.removeListener('uncaughtException', handleUncaughtException);
    process.removeListener('unhandledRejection', handleUnhandledRejection);
  });
}
