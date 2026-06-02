/**
 * Register AI management tools (ai.models, ai.clear, ai.health).
 */
import './types.js';
import { getPlugin, Message, ZhinTool, MessageCommand } from '@zhin.js/core';
import { SessionManager } from '@zhin.js/ai';

export function registerManagementTools(): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  useContext('ai', 'tool', (ai, toolService) => {
    if (!ai || !toolService) return;

    const listModelsTool = new ZhinTool('ai_models')
      .desc('列出所有可用的 AI 模型')
      .keyword('模型', '可用模型', 'ai模型', 'model', 'models')
      .tag('ai', 'management')
      .execute(async () => {
        const models = await ai.listModels();
        return { providers: models.map(({ provider, models: ml }) => ({ name: provider, models: ml.slice(0, 10), total: ml.length })) };
      });

    const clearSessionTool = new ZhinTool('ai_clear')
      .desc('清除当前对话的历史记录')
      .keyword('清除', '清空', '重置', 'clear', 'reset')
      .tag('ai', 'session')
      .execute(async (_args, context) => {
        if (!context?.message) return { success: false, error: '无消息上下文' };
        const msg = context.message as Message;
        const sid = SessionManager.generateId(msg.$adapter, msg.$sender.id, msg.$channel?.id);
        await ai.sessions.reset(sid);
        return { success: true, message: '对话历史已清除' };
      });

    const healthCheckTool = new ZhinTool('ai_health')
      .desc('检查 AI 服务的健康状态')
      .keyword('健康', '状态', '检查', 'health', 'status')
      .tag('ai', 'management')
      .execute(async () => {
        const h = await ai.healthCheck();
        return { providers: Object.entries(h).map(([n, ok]) => ({ name: n, healthy: ok })) };
      });

    const tools = [listModelsTool, clearSessionTool, healthCheckTool];
    const disposers: (() => void)[] = [];
    for (const tool of tools) disposers.push(toolService.addTool(tool, root.name));

    // 注册对应的用户命令（指令线）
    const commandService = root.inject('command');
    if (commandService) {
      const modelsCmd = new MessageCommand('ai.models').desc('列出所有可用的 AI 模型');
      modelsCmd.action(async () => {
        const models = await ai.listModels();
        let r = '🤖 可用模型:\n';
        for (const { provider, models: ml } of models) {
          r += `\n【${provider}】\n` + ml.slice(0, 5).map(m => `  • ${m}`).join('\n');
          if (ml.length > 5) r += `\n  ... 还有 ${ml.length - 5} 个`;
        }
        return r;
      });
      commandService.add(modelsCmd, root.name);
      disposers.push(() => commandService.remove(modelsCmd));

      const clearCmd = new MessageCommand('ai.clear').desc('清除当前对话的历史记录');
      clearCmd.action(async (message: Message) => {
        const sid = SessionManager.generateId(message.$adapter, message.$sender.id, message.$channel?.id);
        await ai.sessions.reset(sid);
        return '✅ 对话历史已清除';
      });
      commandService.add(clearCmd, root.name);
      disposers.push(() => commandService.remove(clearCmd));

      const healthCmd = new MessageCommand('ai.health').desc('检查 AI 服务的健康状态');
      healthCmd.action(async () => {
        const h = await ai.healthCheck();
        return ['🏥 AI 服务健康状态:'].concat(
          Object.entries(h).map(([p, ok]) => `  ${ok ? '✅' : '❌'} ${p}`),
        ).join('\n');
      });
      commandService.add(healthCmd, root.name);
      disposers.push(() => commandService.remove(healthCmd));
    }

    logger.debug(`Registered ${tools.length} AI management tools`);
    return () => disposers.forEach(d => d());
  });
}
