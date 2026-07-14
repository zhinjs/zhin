/**
 * Register @modelcontextprotocol/server-github when a PAT is available.
 */
import type { Plugin } from 'zhin.js';
import type { AIConfig } from 'zhin.js/ai';
import 'zhin.js/agent';

interface GithubMcpServerEntry {
  name: string;
  transport: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface AgentOrchestratorLike {
  mcps: { has(name: string): boolean };
  addMcp(config: GithubMcpServerEntry, scope?: object, source?: string): () => void;
}

function resolveGithubMcpToken(ai?: AIConfig): string | undefined {
  const fromConfig = ai?.githubMcp?.token?.trim();
  if (fromConfig) return fromConfig;
  return (
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    undefined
  );
}

export function registerGithubMcp(plugin: Plugin): void {
  const { useContext, root, logger } = plugin;

  useContext('ai', (ai) => {
    if (!ai?.isReady?.()) return;

    const orchestrator = root.inject('agent') as AgentOrchestratorLike | undefined;
    if (!orchestrator) return;

    if (orchestrator.mcps.has('github')) return;

    const configService = root.inject('config');
    const appConfig = configService?.getPrimary<{ ai?: AIConfig }>() || {};
    const githubMcp = appConfig.ai?.githubMcp as { token?: string; enabled?: boolean } | undefined;
    if (githubMcp?.enabled !== true) {
      logger.debug('[MCP] server-github skipped: set ai.githubMcp.enabled=true to opt in (PAT / human identity)');
      return;
    }
    const token = resolveGithubMcpToken(appConfig.ai);
    if (!token) {
      logger.debug('[MCP] server-github skipped: set GITHUB_PERSONAL_ACCESS_TOKEN or ai.githubMcp.token');
      return;
    }

    return orchestrator.addMcp(
      {
        name: 'github',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: token },
      },
      {},
      'adapter-github',
    );
  });
}
