/**
 * Register AI management tools (/models, /reset, ai.health).
 */
import './types.js';
import { getPlugin, Message, ZhinTool, MessageCommand, MANAGEMENT_OPERATOR_PERMIT } from '@zhin.js/core';
import { asPrivate } from '../zhin-agent/zhin-agent-private.js';
import {
  jumpSessionTreeForCommMessage,
  listSessionTreeForCommMessage,
} from '../zhin-agent/session-tree-commands.js';
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
      .permit('role(trusted)')
      .execute(async () => {
        const models = await ai.listModels();
        return { providers: models.map(({ provider, models: ml }) => ({ name: provider, models: ml.slice(0, 10), total: ml.length })) };
      });

    const healthCheckTool = new ZhinTool('ai_health')
      .desc('检查 AI 服务的健康状态')
      .keyword('健康', '状态', '检查', 'health', 'status')
      .tag('ai', 'management')
      .permit('role(trusted)')
      .execute(async () => {
        const h = await ai.healthCheck();
        return { providers: Object.entries(h).map(([n, ok]) => ({ name: n, healthy: ok })) };
      });

    const tools = [listModelsTool, healthCheckTool];
    const disposers: (() => void)[] = [];
    for (const tool of tools) disposers.push(toolService.addTool(tool, root.name));

    const commandService = root.inject('command');
    if (commandService) {
      const modelsCmd = new MessageCommand('/models')
        .desc('列出所有可用的 AI 模型')
        .permit(MANAGEMENT_OPERATOR_PERMIT)
        .action(async () => {
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

      const treeListCmd = new MessageCommand('/tree')
        .desc('列出会话分支点')
        .permit(MANAGEMENT_OPERATOR_PERMIT)
        .action(async (message: Message) => {
          if (!refs.zhinAgent) return '❌ Agent 未就绪';
          return await listSessionTreeForCommMessage(asPrivate(refs.zhinAgent), message);
        });
      commandService.add(treeListCmd, root.name);
      disposers.push(() => commandService.remove(treeListCmd));

      const treeJumpCmd = new MessageCommand('/tree <index:int>')
        .desc('跳转到第 N 个 user 消息分支点')
        .permit(MANAGEMENT_OPERATOR_PERMIT)
        .action(async (message: Message, matched) => {
          if (!refs.zhinAgent) return '❌ Agent 未就绪';
          const n = Number.parseInt(String(matched.params?.index ?? ''), 10);
          if (!Number.isFinite(n) || n < 1) return 'ℹ️ 用法：/tree 2';
          return await jumpSessionTreeForCommMessage(asPrivate(refs.zhinAgent), message, n);
        });
      commandService.add(treeJumpCmd, root.name);
      disposers.push(() => commandService.remove(treeJumpCmd));

      const forkCmd = new MessageCommand('/fork <index:int>')
        .desc('从第 N 个 user 消息创建分支')
        .permit(MANAGEMENT_OPERATOR_PERMIT)
        .action(async (message: Message, matched) => {
          if (!refs.zhinAgent) return '❌ Agent 未就绪';
          const n = Number.parseInt(String(matched.params?.index ?? ''), 10);
          if (!Number.isFinite(n) || n < 1) return 'ℹ️ 用法：/fork 2';
          return await jumpSessionTreeForCommMessage(asPrivate(refs.zhinAgent), message, n);
        });
      commandService.add(forkCmd, root.name);
      disposers.push(() => commandService.remove(forkCmd));

      const compactCmd = new MessageCommand('/compact')
        .desc('压缩当前对话上下文（保留最近 ~20k tokens）')
        .permit(MANAGEMENT_OPERATOR_PERMIT)
        .action(async (message: Message) => {
          if (!refs.zhinAgent) return '❌ Agent 未就绪';
          const result = await refs.zhinAgent.compactSessionForCommMessage(message);
          return result.ok ? `✅ ${result.message}` : `ℹ️ ${result.message}`;
        });
      commandService.add(compactCmd, root.name);
      disposers.push(() => commandService.remove(compactCmd));

      const resetCmd = new MessageCommand('/reset')
        .desc('归档当前 epoch，下次 @ 开启新上下文')
        .permit(MANAGEMENT_OPERATOR_PERMIT)
        .action(async (message: Message) => {
          if (!refs.zhinAgent) return '❌ Agent 未就绪';
          const ok = await refs.zhinAgent.archiveSessionForCommMessage(message);
          return ok ? '✅ 已归档当前会话，下次 @ 将使用新上下文' : 'ℹ️ 无活跃会话可归档';
        });
      commandService.add(resetCmd, root.name);
      disposers.push(() => commandService.remove(resetCmd));

      const healthCmd = new MessageCommand('ai.health')
        .desc('检查 AI 服务的健康状态')
        .permit(MANAGEMENT_OPERATOR_PERMIT)
        .action(async () => {
          const h = ai.healthCheck();
          return h.then((health) => ['🏥 AI 服务健康状态:'].concat(
            Object.entries(health).map(([p, ok]) => `  ${ok ? '✅' : '❌'} ${p}`),
          ).join('\n'));
        });
      commandService.add(healthCmd, root.name);
      disposers.push(() => commandService.remove(healthCmd));
    }

    logger.debug(`Registered ${tools.length} AI management tools`);
    return () => disposers.forEach(d => d());
  });
}
