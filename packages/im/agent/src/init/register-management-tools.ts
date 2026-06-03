/**
 * Register AI management tools (ai.models, ai.clear, ai.health).
 */
import './types.js';
import { getPlugin, Message, ZhinTool, MessageCommand } from '@zhin.js/core';
import type { AIServiceRefs } from './shared-refs.js';

export function registerManagementTools(refs: AIServiceRefs): void {
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
      .desc('归档当前对话会话（保留 chat_messages 审计；下次 @ 开新纪元）')
      .keyword('清除', '清空', '重置', 'clear', 'reset', 'new')
      .tag('ai', 'session')
      .execute(async (_args, context) => {
        if (!context?.message) return { success: false, error: '无消息上下文' };
        if (!refs.zhinAgent) return { success: false, error: 'Agent 未就绪' };
        const ok = await refs.zhinAgent.archiveSessionForContext(context);
        return { success: ok, message: ok ? '会话已归档，下次对话将开启新上下文' : '无活跃会话可归档' };
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

      const clearCmd = new MessageCommand('ai.clear').desc('归档当前对话会话');
      clearCmd.action(async (message: Message) => {
        if (!refs.zhinAgent) return '❌ Agent 未就绪';
        const ok = await refs.zhinAgent.archiveSessionForContext({
          platform: message.$adapter,
          botId: message.$bot,
          messageId: message.$id,
          sceneId: message.$channel?.id || message.$sender.id,
          senderId: message.$sender.id,
          message,
          scope: (message.$channel?.type === 'group' || message.$channel?.type === 'channel'
            ? message.$channel.type
            : 'private') as 'private' | 'group' | 'channel',
        });
        return ok ? '✅ 会话已归档，下次 @ 将使用新上下文' : 'ℹ️ 无活跃会话可归档';
      });
      commandService.add(clearCmd, root.name);
      disposers.push(() => commandService.remove(clearCmd));

      const newCmd = new MessageCommand('new').desc('开启新对话（归档当前 active 会话）');
      newCmd.action(async (message: Message) => {
        if (!refs.zhinAgent) return '❌ Agent 未就绪';
        const ok = await refs.zhinAgent.archiveSessionForContext({
          platform: message.$adapter,
          botId: message.$bot,
          messageId: message.$id,
          sceneId: message.$channel?.id || message.$sender.id,
          senderId: message.$sender.id,
          message,
          scope: (message.$channel?.type === 'group' || message.$channel?.type === 'channel'
            ? message.$channel.type
            : 'private') as 'private' | 'group' | 'channel',
        });
        return ok ? '✅ 已开启新对话上下文' : 'ℹ️ 无活跃会话可归档';
      });
      commandService.add(newCmd, root.name);
      disposers.push(() => commandService.remove(newCmd));

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
