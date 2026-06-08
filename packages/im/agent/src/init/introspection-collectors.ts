/**
 * 内省数据源（IM 命令与 Host REST 共用）
 */
import { Adapter, type MessageCommand, type Plugin } from '@zhin.js/core';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import type { AIService } from '../service.js';
import {
  commandRowsFromService,
  type AgentRow,
  type BotRow,
  type CommandRow,
  type McpServerRow,
  type ToolRow,
} from './introspection-commands-format.js';

export function collectIntrospectionBots(root: Plugin): BotRow[] {
  const rows: BotRow[] = [];
  for (const adapterName of root.adapters) {
    const adapter = root.inject(adapterName);
    if (!(adapter instanceof Adapter)) continue;
    for (const [botName, bot] of adapter.bots.entries()) {
      rows.push({
        adapter: String(adapterName),
        name: botName,
        online: !!(bot as { $connected?: boolean }).$connected,
      });
    }
  }
  return rows;
}

export function collectIntrospectionCommands(commandService: { items: MessageCommand[] }): CommandRow[] {
  return commandRowsFromService(commandService.items);
}

export function collectIntrospectionBindings(root: Plugin): AgentRow[] | { error: string } {
  const ai = root.inject('ai') as AIService | undefined;
  if (!ai?.isReady?.()) return { error: 'AI 未就绪' };
  const registry = ai.getBindingRegistry();
  return registry.listAgentNames().map((name) => {
    const b = registry.getBinding(name);
    return {
      name,
      provider: b?.providerAlias ?? '-',
      model: b?.model ?? '-',
      mcpServers: b?.mcpServers ?? [],
      hasAgentFile: registry.hasAgentFile(name),
    };
  });
}

export function collectIntrospectionTools(root: Plugin): ToolRow[] | { error: string } {
  const toolService = root.inject('tool');
  if (!toolService) return { error: 'ToolFeature 不可用' };
  return toolService.getAll().map((t) => ({
    name: t.name,
    source: t.source,
    description: t.description ?? '',
  }));
}

export function collectIntrospectionMcp(root: Plugin): McpServerRow[] {
  const orchestrator = root.inject('agent') as AgentOrchestrator | undefined;
  if (!orchestrator) return [];
  return orchestrator.mcps.getAll().map((entry) => ({
    name: entry.name,
    connected: orchestrator.mcps.isConnected(entry.name),
    toolCount: orchestrator.mcps.getToolsFromServer(entry.name).length,
  }));
}

export function collectIntrospectionMcpWithConfigFallback(root: Plugin): {
  rows: McpServerRow[];
  note?: string;
} {
  const orchestrator = root.inject('agent') as AgentOrchestrator | undefined;
  const configServers = (root.inject('config') as { getPrimary?: () => { ai?: { mcpServers?: { name: string }[] } } } | undefined)
    ?.getPrimary?.()?.ai?.mcpServers?.map((s) => s.name) ?? [];
  const rows = collectIntrospectionMcp(root);
  if (rows.length === 0 && configServers.length > 0) {
    return {
      rows: configServers.map((name) => ({ name, connected: false, toolCount: 0 })),
      note: '配置已加载，Orchestrator 尚未注册 — 等待 AI 初始化',
    };
  }
  return { rows };
}
