/**
 * Agent 预设发现（分形 agents/<name>/ 目录）
 *
 * 加载顺序：Workspace > ~/.zhin > data > 插件包 agent/subagents（由 register-agent-surface 处理）
 * 同名先发现者优先
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { type Plugin, getLogger } from '@zhin.js/core';
import { getDataDir } from './utils.js';
import {
  discoverWorkspaceFractalAgent,
  resolvePluginPackageRoot,
} from './agent-surface.js';
import { isAuthoringDefinition, type AuthoringAgentDefinition } from '../authoring/types.js';
import { normalizeToolDenylist } from '../authoring/disable-tool.js';

export type SubagentContextMode = 'fork' | 'fresh';

const KNOWN_AGENT_ROLES = new Set([
  'subtask', 'worker', 'researcher', 'evaluator', 'executor', 'reviewer', 'planner',
]);

const logger = getLogger('builtin-tools');

export type AgentEffortLevel = 'low' | 'medium' | 'high' | 'max';

export interface AgentMeta {
  name: string;
  description: string;
  keywords?: string[];
  tags?: string[];
  toolNames?: string[];
  disallowedTools?: string[];
  filePath: string;
  model?: string;
  provider?: string;
  maxIterations?: number;
  ownerPlugin?: string;
  role?: string;
  contextMode?: SubagentContextMode;
  toolAliases?: Record<string, string>;
  effort?: AgentEffortLevel;
  memory?: 'user' | 'session' | 'agent';
}

async function importAgentDefinition(agentFile: string): Promise<AuthoringAgentDefinition | undefined> {
  try {
    const url = `file://${path.resolve(agentFile)}?t=${Date.now()}`;
    const mod = await import(url);
    const exported = mod.default ?? mod;
    if (isAuthoringDefinition(exported, 'agent')) return exported as AuthoringAgentDefinition;
  } catch (e) {
    logger.debug(`Failed to import agent definition ${agentFile}: ${e}`);
  }
  return undefined;
}

function agentMetaFromFractal(
  name: string,
  agentDir: string,
  def: AuthoringAgentDefinition | undefined,
  instructionsBody: string | undefined,
  ownerPlugin?: string,
): AgentMeta | null {
  const description = def?.description;
  if (!description && !instructionsBody) return null;
  const agentFile = [path.join(agentDir, 'agent.ts'), path.join(agentDir, 'agent.js')]
    .find((p) => fs.existsSync(p)) ?? path.join(agentDir, 'agent.ts');
  const roleRaw = def?.role?.trim();
  return {
    name,
    description: description ?? name,
    keywords: def?.keywords,
    tags: def?.tags,
    toolNames: def?.toolNames,
    disallowedTools: normalizeToolDenylist(def?.disallowedTools),
    filePath: agentFile,
    maxIterations: def?.maxIterations,
    ownerPlugin,
    role: roleRaw && KNOWN_AGENT_ROLES.has(roleRaw) ? roleRaw : undefined,
    contextMode: def?.contextMode,
  };
}

async function discoverFractalAgentsInDir(
  agentsDir: string,
  ownerPlugin?: string,
): Promise<AgentMeta[]> {
  const agents: AgentMeta[] = [];
  if (!fs.existsSync(agentsDir)) return agents;

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(agentsDir, { withFileTypes: true });
  } catch {
    return agents;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const agentDir = path.join(agentsDir, entry.name);
    const fractal = await discoverWorkspaceFractalAgent(agentDir);
    if (!fractal) continue;
    const def = fractal.agentDefinition ?? await importAgentDefinition(path.join(agentDir, 'agent.ts'));
    const meta = agentMetaFromFractal(
      fractal.name,
      agentDir,
      def,
      fractal.instructionsBody,
      ownerPlugin,
    );
    if (meta) agents.push(meta);
  }
  return agents;
}

/**
 * 扫描 agents/ 分形目录，发现 workspace / plugin workspace agents
 */
export async function discoverWorkspaceAgents(root?: Plugin | null): Promise<AgentMeta[]> {
  const agents: AgentMeta[] = [];
  const seenNames = new Set<string>();

  const agentDirs: string[] = [
    path.join(process.cwd(), 'agents'),
    path.join(os.homedir(), '.zhin', 'agents'),
    path.join(getDataDir(), 'agents'),
  ];

  const dirToPlugin = new Map<string, string>();
  if (root) {
    const addPluginDir = (p: Plugin) => {
      if (!p?.filePath) return;
      const packageRoot = resolvePluginPackageRoot(p.filePath);
      const d = path.join(packageRoot, 'agents');
      if (!agentDirs.includes(d)) agentDirs.push(d);
      dirToPlugin.set(d, p.name);
    };
    addPluginDir(root);
    for (const child of (root.children || []) as Plugin[]) {
      addPluginDir(child as Plugin);
    }
  }

  for (const agentsDir of agentDirs) {
    const found = await discoverFractalAgentsInDir(agentsDir, dirToPlugin.get(agentsDir));
    for (const meta of found) {
      if (seenNames.has(meta.name)) {
        logger.debug(`Agent '${meta.name}' 已由先序目录加载，跳过: ${meta.filePath}`);
        continue;
      }
      seenNames.add(meta.name);
      agents.push(meta);
      logger.debug(`Agent发现成功: ${meta.name}`);
    }
  }
  return agents;
}

/** 读取分形 agent instructions.md 正文 */
export async function loadAgentInstructionsBody(agentDir: string): Promise<string> {
  const instructionsPath = path.join(agentDir, 'instructions.md');
  if (!fs.existsSync(instructionsPath)) return '';
  const content = await fs.promises.readFile(instructionsPath, 'utf-8');
  return content.trim();
}

/** @deprecated 使用 loadAgentInstructionsBody */
export async function loadAgentMarkdownBody(filePath: string): Promise<string> {
  if (filePath.endsWith('agent.ts') || filePath.endsWith('agent.js')) {
    return loadAgentInstructionsBody(path.dirname(filePath));
  }
  const content = await fs.promises.readFile(filePath, 'utf-8');
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '').trim();
}
