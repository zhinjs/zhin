/**
 * 内省数据源（IM 命令与 Host REST 共用）
 */
import { Adapter, type MessageCommand, type Plugin } from '@zhin.js/core';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import type { AIService } from '../service.js';
import {
  commandRowsFromService,
  type AgentRow,
  type EndpointRow,
  type CommandRow,
  type McpServerRow,
  type ToolRow,
} from './introspection-commands-format.js';

export function collectIntrospectionEndpoints(root: Plugin): EndpointRow[] {
  const rows: EndpointRow[] = [];
  for (const adapterName of root.adapters) {
    const adapter = root.inject(adapterName);
    if (!(adapter instanceof Adapter)) continue;
    for (const [endpointId, endpoint] of adapter.endpoints.entries()) {
      rows.push({
        adapter: String(adapterName),
        name: endpointId,
        online: !!(endpoint as { $connected?: boolean }).$connected,
      });
    }
  }
  return rows;
}

export function collectIntrospectionCommands(commandService: { items: readonly MessageCommand[] }): CommandRow[] {
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

export function collectIntrospectionAgentTools(root: Plugin): string[] {
  const names = new Set<string>();
  const fromFeature = collectIntrospectionTools(root);
  if (!('error' in fromFeature)) {
    for (const t of fromFeature) names.add(t.name);
  }
  const orchestrator = root.inject('agent') as AgentOrchestrator | undefined;
  if (orchestrator) {
    for (const t of orchestrator.tools.getAll()) {
      if (!(t as { hidden?: boolean }).hidden) names.add(t.name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Agent 编排器已注册的技能名（启动摘要 / 内省） */
export function collectIntrospectionSkills(root: Plugin): string[] {
  const orchestrator = root.inject('agent') as AgentOrchestrator | undefined;
  if (!orchestrator) return [];
  return orchestrator.skills.getAll()
    .map((s) => s.name)
    .sort((a, b) => a.localeCompare(b));
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

/** MCP Server 展示标签（启动摘要 chip 列表） */
export function collectIntrospectionMcpLabels(root: Plugin): string[] {
  const { rows } = collectIntrospectionMcpWithConfigFallback(root);
  return rows
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => {
      const detail = s.connected ? String(s.toolCount) : 'idle';
      return `${s.name} (${detail})`;
    });
}
