import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

type AgentConfiguration = {
  readonly agents?: Record<string, {
    readonly provider?: string;
    readonly model?: string;
    readonly nickname?: string;
    readonly mcpServers?: string[];
  }>;
  readonly mcpServers?: { readonly name?: string; readonly transport?: string }[];
};

/** Reads the persisted Agent configuration projected by Console introspection. */
export class AgentConfigProjection {
  readonly #projectRoot: string;

  constructor(projectRoot: string) {
    this.#projectRoot = projectRoot;
  }

  listBindings(): readonly Record<string, unknown>[] {
    const agents = this.#read()?.agents;
    if (!agents || typeof agents !== 'object') return [];
    return Object.entries(agents).map(([name, binding]) => ({
      name,
      provider: binding?.provider ?? '-',
      model: binding?.model ?? '-',
      mcpServers: binding?.mcpServers ?? [],
      hasAgentFile: false,
    }));
  }

  listMcpServers(): readonly { name: string; transport?: string }[] {
    const servers = this.#read()?.mcpServers;
    if (!Array.isArray(servers)) return [];
    return servers
      .filter((entry): entry is { name: string; transport?: string } =>
        !!entry && typeof entry.name === 'string')
      .map((entry) => ({ name: entry.name, transport: entry.transport }));
  }

  #read(): AgentConfiguration | undefined {
    const file = findConfigFileSync(this.#projectRoot);
    if (!file) return undefined;
    try {
      const text = readFileSync(file, 'utf8');
      const document = (file.endsWith('.json') ? JSON.parse(text) : parseYaml(text)) as {
        readonly ai?: AgentConfiguration;
      };
      return document?.ai;
    } catch {
      return undefined;
    }
  }
}

function findConfigFileSync(projectRoot: string): string | undefined {
  for (const candidate of [
    'config.yml', 'config.yaml', 'config.json',
    'zhin.config.yml', 'zhin.config.yaml', 'zhin.config.json',
  ]) {
    const file = join(projectRoot, candidate);
    if (existsSync(file)) return file;
  }
  return undefined;
}
