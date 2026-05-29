/**
 * AI Hook 测试插件
 * 
 * 验证新实现的 Hook 系统是否正常工作
 */
import { usePlugin, registerAIHook } from 'zhin.js';

const plugin = usePlugin();
const { logger, useContext } = plugin;

useContext('ai', () => {
  logger.info('🔧 AI Hook 测试插件已加载');
  
  // 注册消息接收 Hook
  const dispose1 = registerAIHook('message:received', async (event) => {
    logger.info(`[Hook] 📨 收到消息: ${event.context.content}`);
    logger.debug(`  - 会话ID: ${event.sessionId}`);
    logger.debug(`  - 用户ID: ${event.context.userId}`);
  });
  
  // 注册消息发送 Hook
  const dispose2 = registerAIHook('message:sent', async (event) => {
    const sent = event.context.content;
    logger.info(`[Hook] 📤 发送回复: ${typeof sent === 'string' ? sent.substring(0, 50) : ''}...`);
  });
  
  // 注册 Agent 启动 Hook
  const dispose3 = registerAIHook('agent:bootstrap', async (event) => {
    logger.info(`[Hook] 🚀 Agent 启动完成:`);
    logger.info(`  - 工具数: ${event.context.toolCount}`);
    logger.info(`  - 技能数: ${event.context.skillCount}`);
    const files = event.context.bootstrapFiles;
    logger.info(`  - 引导文件: ${Array.isArray(files) ? files.join(', ') : ''}`);
  });
  
  logger.info('✅ Hook 监听器已注册 (message:received, message:sent, agent:bootstrap)');
  
  // 清理函数
  return () => {
    dispose1();
    dispose2();
    dispose3();
    logger.info('🔧 AI Hook 测试插件已卸载');
  };
});
