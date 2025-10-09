import { Plugin, Cron } from '@zhin.js/core';

// 创建一个示例插件来演示 Cron 功能
export default function cronExamplePlugin(plugin: Plugin) {
  // 示例 1: 每分钟执行一次
  plugin.cron('0 * * * * *', () => {
    plugin.logger.info('每分钟执行的任务');
  });

  // 示例 2: 每天午夜执行
  plugin.cron('0 0 0 * * *', () => {
    plugin.logger.info('每日午夜任务执行');
  });

  // 示例 3: 每15分钟执行一次
  plugin.cron('0 0/15 * * * *', () => {
    plugin.logger.info('每15分钟执行的任务');
  });

  // 示例 4: 工作日上午9点执行
  plugin.cron('0 0 9 * * 1-5', () => {
    plugin.logger.info('工作日上午9点任务');
  });

  // 示例 5: 异步任务
  plugin.cron('0 0 12 * * *', async () => {
    plugin.logger.info('开始执行异步任务');
    
    // 模拟异步操作
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    plugin.logger.info('异步任务完成');
  });

  // 示例 6: 手动创建和管理 Cron 任务
  
  const manualCron = new Cron('0 0/30 * * * *', () => {
    plugin.logger.info('手动管理的定时任务');
  });

  // 启动任务
  manualCron.run();

  // 在插件卸载时清理任务
  plugin.on('dispose', () => {
    manualCron.dispose();
  });

  plugin.logger.info('Cron 示例插件已加载');
}
