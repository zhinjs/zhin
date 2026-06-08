/**
 * IM 内省指令格式化（/cmd、/bots、/tools 等）
 */
import type { MessageCommand } from '@zhin.js/core';

export interface CommandRow {
  pattern: string;
  desc: string;
  plugin?: string;
}

export interface BotRow {
  adapter: string;
  name: string;
  online: boolean;
}

export interface AgentRow {
  name: string;
  provider: string;
  model: string;
  mcpServers: string[];
  hasAgentFile: boolean;
}

export interface ToolRow {
  name: string;
  source?: string;
  description: string;
}

export interface McpServerRow {
  name: string;
  connected: boolean;
  toolCount: number;
}

export function formatCommandsList(commands: CommandRow[], max = commands.length): string {
  if (commands.length === 0) return '📋 暂无已注册命令';
  const sorted = [...commands].sort((a, b) => a.pattern.localeCompare(b.pattern));
  const lines = ['📋 已注册命令 (' + commands.length + ')', ''];
  const show = sorted.slice(0, max);
  for (const c of show) {
    const desc = c.desc ? ` — ${c.desc}` : '';
    lines.push(`  • ${c.pattern}${desc}`);
  }
  if (sorted.length > max) {
    lines.push('', `… 还有 ${sorted.length - max} 条，可用 /cmd 查看完整列表（当前截断 ${max}）`);
  }
  return lines.join('\n');
}

export function formatAdaptersList(adapters: string[]): string {
  if (adapters.length === 0) return '🔌 暂无已注册适配器';
  const lines = ['🔌 已注册适配器 (' + adapters.length + ')', ''];
  for (const name of [...adapters].sort()) {
    lines.push(`  • ${name}`);
  }
  return lines.join('\n');
}

export function formatBotsList(bots: BotRow[]): string {
  if (bots.length === 0) return '🤖 暂无 Bot 实例';
  const lines = ['🤖 Bot 列表 (' + bots.length + ')', ''];
  for (const b of [...bots].sort((a, c) => a.adapter.localeCompare(c.adapter) || a.name.localeCompare(c.name))) {
    const mark = b.online ? '● online' : '○ offline';
    lines.push(`  ${mark}  ${b.adapter}/${b.name}`);
  }
  return lines.join('\n');
}

export function formatAgentsList(agents: AgentRow[]): string {
  if (agents.length === 0) return '🧠 暂无 ai.agents 绑定';
  const lines = ['🧠 ai.agents 绑定 (' + agents.length + ')', ''];
  for (const a of agents) {
    const mcp = a.mcpServers.length ? a.mcpServers.join(', ') : '-';
    const file = a.hasAgentFile ? 'agent.md ✓' : 'agent.md -';
    lines.push(`  • ${a.name}  ${a.provider}/${a.model}`);
    lines.push(`      mcp: ${mcp}  ${file}`);
  }
  return lines.join('\n');
}

export function formatToolsList(tools: ToolRow[], max = 50): string {
  if (tools.length === 0) return '🛠 暂无已注册工具';
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  const lines = ['🛠 工具列表 (' + tools.length + ')', ''];
  for (const t of sorted.slice(0, max)) {
    const src = t.source ? ` [${t.source}]` : '';
    const desc = truncate(t.description, 56);
    lines.push(`  • ${t.name}${src}`);
    if (desc) lines.push(`      ${desc}`);
  }
  if (sorted.length > max) {
    lines.push('', `… 还有 ${sorted.length - max} 个工具`);
  }
  return lines.join('\n');
}

export function formatMcpServersList(servers: McpServerRow[]): string {
  if (servers.length === 0) return '🔌 暂无 MCP Server';
  const lines = ['🔌 MCP Server (' + servers.length + ')', ''];
  for (const s of [...servers].sort((a, b) => a.name.localeCompare(b.name))) {
    const st = s.connected ? 'connected' : 'idle';
    lines.push(`  • ${s.name}  ${st}  tools:${s.toolCount}`);
  }
  return lines.join('\n');
}

export function commandRowsFromService(
  items: MessageCommand[],
  pluginMap?: Map<string, string>,
): CommandRow[] {
  return items.map((cmd) => ({
    pattern: cmd.pattern,
    desc: cmd.helpInfo.desc[0] ?? '',
    plugin: pluginMap?.get(cmd.pattern),
  }));
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

export function introspectionHelpFooter(): string {
  return [
    '',
    '💡 内省指令：/cmd · /bots · /bindings · /tools · /mcp',
  ].join('\n');
}
