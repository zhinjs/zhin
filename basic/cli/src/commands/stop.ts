import { Command } from 'commander';
import { logger } from '../utils/logger.js';
import { stopProcess, getProcessStatus } from '../utils/process.js';

export const stopCommand = new Command('stop')
  .description('停止机器人')
  .action(async () => {
    try {
      const cwd = process.cwd();
      
      // 检查是否有运行中的进程
      const status = await getProcessStatus(cwd);
      if (!status.running) {
        logger.warn('没有运行中的机器人进程');
        return;
      }
      
      logger.info(`正在停止机器人 (PID: ${status.pid})...`);
      
      // 停止进程
      await stopProcess(cwd);
      
    } catch (error) {
      logger.error(`停止失败: ${error}`);
      process.exit(1);
    }
  }); 