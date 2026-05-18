/**
 * Register MCP server entries from zhin.config ai.mcpServers (global/common scope).
 */
import { getPlugin } from '@zhin.js/core';
import type { AIConfig } from '@zhin.js/core';
import type { AgentOrchestrator } from '../orchestrator/index.js';
import type { McpServerEntry } from '../orchestrator/types.js';
import { resolveConfigEnvString } from '../utils/config-env.js';

type McpServerConfig = NonNullable<AIConfig['mcpServers']>[number];

function resolveHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = resolveConfigEnvString(String(v)) ?? String(v);
  }
  return out;
}

function resolveEnvRecord(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!env) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = resolveConfigEnvString(String(v)) ?? String(v);
  }
  return out;
}

function validateMcpServerEntry(raw: McpServerConfig): McpServerEntry | null {
  if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const transport = raw.transport;
  if (transport !== 'stdio' && transport !== 'streamable-http' && transport !== 'sse') return null;
  const url = resolveConfigEnvString(raw.url);
  const command = resolveConfigEnvString(raw.command);
  if (transport === 'stdio') {
    if (!command?.trim()) return null;
  } else if (!url?.trim()) {
    return null;
  }
  return {
    name: raw.name.trim(),
    transport,
    url,
    command,
    args: raw.args?.map(a => resolveConfigEnvString(String(a)) ?? String(a)),
    env: resolveEnvRecord(raw.env),
    headers: resolveHeaders(raw.headers),
  };
}

export function registerMcpFromConfig(): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  useContext('ai', (ai) => {
    if (!ai?.isReady?.()) return;

    const orchestrator = root.inject('agent') as AgentOrchestrator | undefined;
    if (!orchestrator) {
      logger.warn('AgentOrchestrator not available; ai.mcpServers skipped');
      return;
    }

    const configService = root.inject('config');
    const appConfig = configService?.getPrimary<{ ai?: AIConfig }>() || {};
    const servers = appConfig.ai?.mcpServers;
    if (!servers?.length) return;

    let registered = 0;
    for (const raw of servers) {
      const entry = validateMcpServerEntry(raw);
      if (!entry) {
        logger.warn(`[MCP] Invalid mcpServers entry skipped: ${JSON.stringify(raw)}`);
        continue;
      }
      if (orchestrator.mcps.has(entry.name)) {
        logger.warn(`[MCP] Duplicate server name "${entry.name}" in ai.mcpServers; skipping`);
        continue;
      }
      orchestrator.addMcp(entry, {}, 'config');
      registered++;
    }
    if (registered > 0) {
      logger.info(`[MCP] Registered ${registered} server(s) from ai.mcpServers (lazy connect on AI turn)`);
    }
  });
}
