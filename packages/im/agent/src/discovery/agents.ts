/**
 * Canonical sub-agent discovery.
 *
 * A main Agent reads the standard project AGENTS.md chain. Named sub-agents are
 * self-contained packages under agents/<name>/ and are described by agent.json.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getLogger } from '@zhin.js/logger';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import {
  agentFeatureId,
  parseAgentPackage,
  type AgentDefinition,
  type AgentPackageSource,
  type AgentResource,
} from '@zhin.js/agent-feature';
import { workspaceRoot } from './utils.js';

export type SubagentContextMode = 'fork' | 'fresh';
export type AgentEffortLevel = 'low' | 'medium' | 'high' | 'max';

const logger = getLogger('builtin-tools');

export interface AgentMeta {
  name: string;
  displayName: string;
  version: string;
  description: string;
  keywords?: string[];
  filePatterns?: string[];
  tags?: string[];
  toolNames?: string[];
  disallowedTools?: string[];
  filePath: string;
  systemPrompt: string;
  model?: string;
  provider?: string;
  maxIterations?: number;
  role?: string;
  contextMode?: SubagentContextMode;
  effort?: AgentEffortLevel;
  memory?: 'user' | 'session' | 'agent';
  skillNames?: string[];
}

async function readResourceDirectory(
  agentDir: string,
  name: 'workflows' | 'knowledge',
): Promise<readonly AgentResource[]> {
  const directory = path.join(agentDir, name);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return Promise.all(entries
    .filter((entry) => entry.isFile() && /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:md|txt|json|ya?ml|csv|sh)$/u.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(async (entry) => Object.freeze({
      path: `${name}/${entry.name}`,
      content: await fs.promises.readFile(path.join(directory, entry.name), 'utf8'),
    })));
}

async function loadAgentDefinition(agentDir: string): Promise<AgentDefinition> {
  const manifestPath = path.join(agentDir, 'agent.json');
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')) as unknown;
  const entries = await fs.promises.readdir(agentDir, { withFileTypes: true });
  const files = Object.fromEntries(await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name !== 'agent.json')
    .map(async (entry) => [
      entry.name,
      await fs.promises.readFile(path.join(agentDir, entry.name), 'utf8'),
    ] as const)));
  const source: AgentPackageSource = {
    manifest,
    files,
    workflows: await readResourceDirectory(agentDir, 'workflows'),
    knowledge: await readResourceDirectory(agentDir, 'knowledge'),
    privateToolNames: (await childDirectories(path.join(agentDir, 'tools')))
      .map((name) => `agent__${path.basename(agentDir)}__${name}`),
    privateSkillNames: (await childDirectories(path.join(agentDir, 'skills')))
      .map((name) => `agent__${path.basename(agentDir)}__${name}`),
  };
  return parseAgentPackage(source, {
    owner: rootPluginId(),
    feature: agentFeatureId,
    localName: path.basename(agentDir),
    source: manifestPath,
  });
}

function toAgentMeta(definition: AgentDefinition, agentDir: string): AgentMeta {
  return {
    name: definition.name,
    displayName: definition.displayName,
    version: definition.version,
    description: definition.description,
    keywords: [...definition.triggerRules.keywords],
    filePatterns: [...definition.triggerRules.filePatterns],
    tags: definition.tags ? [...definition.tags] : undefined,
    toolNames: definition.toolNames ? [...definition.toolNames] : undefined,
    disallowedTools: definition.disallowedTools ? [...definition.disallowedTools] : undefined,
    filePath: path.join(agentDir, 'agent.json'),
    systemPrompt: definition.instructions,
    maxIterations: definition.maxIterations,
    role: definition.role,
    contextMode: definition.contextMode,
    model: definition.model,
    provider: definition.provider,
    effort: definition.effort,
    memory: definition.memory,
    skillNames: definition.skillNames ? [...definition.skillNames] : undefined,
  };
}

async function childDirectories(directory: string): Promise<string[]> {
  try {
    return (await fs.promises.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^[a-z0-9][a-z0-9-]*$/u.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function discoverAgentPackages(agentsDir: string): Promise<AgentMeta[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(agentsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const agents: AgentMeta[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]*$/u.test(entry.name)) continue;
    const agentDir = path.join(agentsDir, entry.name);
    if (!fs.existsSync(path.join(agentDir, 'agent.json'))) continue;
    agents.push(toAgentMeta(await loadAgentDefinition(agentDir), agentDir));
  }
  return agents;
}

/**
 * Discover named sub-agents. Earlier roots take precedence.
 */
export async function discoverWorkspaceAgents(
  projectRoot = workspaceRoot(),
): Promise<AgentMeta[]> {
  const agents: AgentMeta[] = [];
  const seenNames = new Set<string>();
  const roots = [
    path.join(projectRoot, 'agents'),
    path.join(os.homedir(), '.zhin', 'agents'),
    path.join(projectRoot, 'data', 'agents'),
  ];
  for (const root of roots) {
    for (const meta of await discoverAgentPackages(root)) {
      if (seenNames.has(meta.name)) {
        logger.debug(`Agent '${meta.name}' is already loaded; skipping ${meta.filePath}`);
        continue;
      }
      seenNames.add(meta.name);
      agents.push(meta);
      logger.debug(`Agent discovered: ${meta.name}`);
    }
  }
  return agents;
}
