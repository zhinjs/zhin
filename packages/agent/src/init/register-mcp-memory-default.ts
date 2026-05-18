/**
 * Register default @modelcontextprotocol/server-memory MCP (knowledge graph).
 * Registered only when ai.memoryMcp === true (default off). Skipped if name "memory" already registered.
 */
import * as path from 'node:path';
import { getPlugin } from '@zhin.js/core';
import type { AIConfig } from '@zhin.js/core';
import { getDataDir } from '../discovery/utils.js';
import type { AgentOrchestrator } from '../orchestrator/index.js';

export function registerMcpMemoryDefault(): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  useContext('ai', (ai) => {
    if (!ai?.isReady?.()) return;

    const orchestrator = root.inject('agent') as AgentOrchestrator | undefined;
    if (!orchestrator) return;

    const configService = root.inject('config');
    const appConfig = configService?.getPrimary<{ ai?: AIConfig }>() || {};
    if (appConfig.ai?.memoryMcp !== true) return;

    if (orchestrator.mcps.has('memory')) return;

    const memoryPath = path.join(getDataDir(), 'knowledge-graph.jsonl');
    orchestrator.addMcp(
      {
        name: 'memory',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        env: { MEMORY_FILE_PATH: memoryPath },
      },
      {},
      'agent-default',
    );
    logger.info(
      `[MCP] Registered default memory server (MEMORY_FILE_PATH=${memoryPath}, lazy connect on AI turn)`,
    );
  });
}
