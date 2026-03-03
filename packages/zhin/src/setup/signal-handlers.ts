import type { Plugin } from '@zhin.js/core';

/**
 * 启动核心上下文并注册优雅关闭与异常处理
 */
export async function registerSignalHandlers(plugin: Plugin): Promise<void> {
  const { start, stop, logger } = plugin;

  await start();

  const handleSIGTERM = () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    stop();
    process.exit(0);
  };

  const handleSIGINT = () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    stop();
    process.exit(0);
  };

  const handleUncaughtException = (error: Error) => {
    logger.error('Uncaught exception:', error);
    stop();
    process.exit(1);
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

  process.removeListener('SIGTERM', handleSIGTERM);
  process.removeListener('SIGINT', handleSIGINT);
  process.removeListener('uncaughtException', handleUncaughtException);
  process.removeListener('unhandledRejection', handleUnhandledRejection);

  process.once('SIGTERM', handleSIGTERM);
  process.once('SIGINT', handleSIGINT);
  process.on('uncaughtException', handleUncaughtException);
  process.on('unhandledRejection', handleUnhandledRejection);
}
