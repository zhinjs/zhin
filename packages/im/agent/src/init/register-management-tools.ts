/**
 * Register AI management tools (ai_models / ai_health).
 *
 * Chat 命令（/models /tree /reset…）已迁到 Plugin Runtime：
 * `handleRuntimeManagementCommand`（Agent Host）。本文件不再注册 MessageCommand。
 */
import './types.js';
import { getPlugin, ZhinTool } from '@zhin.js/core';
import type { AIServiceRefs } from './shared-refs.js';

export function registerManagementTools(refs: AIServiceRefs): void {
  void refs;
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

    logger.debug(`Registered ${tools.length} AI management tools`);
    return () => disposers.forEach((d) => d());
  });
}
