/**
 * IM 内省指令：/cmd、/endpoints、/bindings、/tools、/mcp
 */
import {
  Adapter,
  getPlugin,
  Message,
  MessageCommand,
  type CommandFeature,
} from '@zhin.js/core';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import type { AIServiceRefs } from './shared-refs.js';
import { rejectUnlessManagementOperator } from './management-command-guard.js';
import {
  commandRowsFromService,
  formatAgentsList,
  formatEndpointsList,
  formatCommandsList,
  formatMcpServersList,
  formatToolsList,
  introspectionHelpFooter,
  type EndpointRow,
  type McpServerRow,
} from './introspection-commands-format.js';

function registerIntrospectionCommand(
  commandService: CommandFeature,
  pluginName: string,
  root: ReturnType<typeof getPlugin>['root'],
  disposers: (() => void)[],
  pattern: string,
  desc: string,
  handler: () => Promise<string> | string,
): void {
  const cmd = new MessageCommand(pattern)
    .desc(desc)
    .action(async (message: Message) => {
      const ai = root.inject('ai') as { getTriggerConfig?: () => import('@zhin.js/core').AITriggerConfig } | undefined;
      const denied = rejectUnlessManagementOperator(
        message,
        root,
        ai?.getTriggerConfig?.(),
      );
      if (denied) return denied;
      return handler();
    });
  commandService.add(cmd, pluginName);
  disposers.push(() => commandService.remove(cmd));
}

function collectEndpoints(root: ReturnType<typeof getPlugin>['root']): EndpointRow[] {
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

function collectMcpRows(orchestrator: AgentOrchestrator | undefined): McpServerRow[] {
  if (!orchestrator) return [];
  return orchestrator.mcps.getAll().map((entry) => ({
    name: entry.name,
    connected: orchestrator.mcps.isConnected(entry.name),
    toolCount: orchestrator.mcps.getToolsFromServer(entry.name).length,
  }));
}

export function registerIntrospectionCommands(_refs: AIServiceRefs): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  useContext('command', (commandService) => {
    if (!commandService) return;
    const disposers: (() => void)[] = [];

    const listCommands = () => {
      const rows = commandRowsFromService(commandService.items);
      return formatCommandsList(rows) + introspectionHelpFooter();
    };
    registerIntrospectionCommand(
      commandService,
      root.name,
      root,
      disposers,
      '/cmd',
      '列出已注册的 IM 命令',
      listCommands,
    );

    registerIntrospectionCommand(
      commandService,
      root.name,
      root,
      disposers,
      '/endpoints',
      '列出各适配器下的 Endpoint 及在线状态',
      () => formatEndpointsList(collectEndpoints(root)),
    );

    registerIntrospectionCommand(
      commandService,
      root.name,
      root,
      disposers,
      '/bindings',
      '列出 ai.agents 绑定（provider / model / mcp）',
      () => {
        const ai = root.inject('ai') as import('../service.js').AIService | undefined;
        if (!ai?.isReady?.()) return '❌ AI 未就绪';
        const registry = ai.getBindingRegistry();
        const agents = registry.listAgentNames().map((name) => {
          const b = registry.getBinding(name);
          return {
            name,
            provider: b?.providerAlias ?? '-',
            model: b?.model ?? '-',
            mcpServers: b?.mcpServers ?? [],
            hasAgentFile: registry.hasAgentFile(name),
          };
        });
        return formatAgentsList(agents);
      },
    );

    registerIntrospectionCommand(
      commandService,
      root.name,
      root,
      disposers,
      '/tools',
      '列出 ToolFeature 已注册工具',
      () => {
        const toolService = root.inject('tool');
        if (!toolService) return '🛠 ToolFeature 不可用';
        const tools = toolService.getAll().map((t) => ({
          name: t.name,
          source: t.source,
          description: t.description ?? '',
        }));
        return formatToolsList(tools);
      },
    );

    registerIntrospectionCommand(
      commandService,
      root.name,
      root,
      disposers,
      '/mcp',
      '列出已注册的 MCP Server 及连接状态',
      () => {
        const orchestrator = root.inject('agent') as AgentOrchestrator | undefined;
        const configServers = (root.inject('config') as { getPrimary?: () => { ai?: { mcpServers?: { name: string }[] } } } | undefined)
          ?.getPrimary?.()?.ai?.mcpServers?.map((s) => s.name) ?? [];
        const rows = collectMcpRows(orchestrator);
        if (rows.length === 0 && configServers.length > 0) {
          return formatMcpServersList(
            configServers.map((name) => ({ name, connected: false, toolCount: 0 })),
          ) + '\n\n（配置已加载，Orchestrator 尚未注册 — 等待 AI 初始化）';
        }
        return formatMcpServersList(rows);
      },
    );

    logger.debug(`Registered introspection commands (${disposers.length} patterns)`);
    return () => {
      for (const d of disposers) d();
    };
  });
}
