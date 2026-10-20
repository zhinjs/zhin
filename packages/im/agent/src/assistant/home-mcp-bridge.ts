/**
 * Home MCP 通道校验与说明（assistant.home.mcpServer）
 *
 * REST 为主路径；配置 mcpServer 时与 ai.mcpServers 对齐，供 Agent binding 挂载 MCP 工具。
 */
import type { AIConfig } from '@zhin.js/ai';
import { type AssistantHomeConfig, resolveAssistantHomeConfig } from './home-config.js';
export function listConfiguredMcpServerNames(ai?: AIConfig): string[] {
  const names = new Set<string>();
  for (const entry of ai?.mcpServers ?? []) {
    const name = entry.name?.trim();
    if (name) names.add(name);
  }
  return [...names];
}

/** 校验 mcpServer 已在 ai.mcpServers 注册；返回警告文案（无则 null） */
export function validateHomeMcpServer(
  home?: AssistantHomeConfig,
  ai?: AIConfig,
): string | null {
  const cfg = resolveAssistantHomeConfig(home);
  const name = cfg.mcpServer?.trim();
  if (!name) return null;
  const registered = listConfiguredMcpServerNames(ai);
  if (registered.includes(name)) return null;
  return `assistant.home.mcpServer="${name}" 未在 ai.mcpServers 中注册；REST 仍可用，MCP 工具需补全配置`;
}

export function isHomeMcpMode(home?: AssistantHomeConfig): boolean {
  const cfg = resolveAssistantHomeConfig(home);
  return Boolean(cfg.mcpServer?.trim() && !cfg.restUrl);
}
