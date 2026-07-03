/**
 * Agent 预设发现（*.agent.md 文件扫描）
 *
 * 加载顺序与 skills 一致：Workspace > ~/.zhin > data > 插件包
 * 同名先发现者优先
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Logger, type Plugin } from '@zhin.js/core';
import { getDataDir } from './utils.js';

export type SubagentContextMode = 'fork' | 'fresh';

const KNOWN_AGENT_ROLES = new Set([
  'subtask', 'worker', 'researcher', 'evaluator', 'executor', 'reviewer', 'planner',
]);

const logger = new Logger(null, 'builtin-tools');

// ============================================================================
// 类型
// ============================================================================

export type AgentEffortLevel = 'low' | 'medium' | 'high' | 'max';

export interface AgentMeta {
  name: string;
  description: string;
  keywords?: string[];
  tags?: string[];
  /** frontmatter 中声明的工具名列表（白名单） */
  toolNames?: string[];
  /** 工具黑名单 — 与 toolNames 互斥，从可用工具池中排除 */
  disallowedTools?: string[];
  /** *.agent.md 文件的绝对路径 */
  filePath: string;
  /** 首选模型名 */
  model?: string;
  /** 首选 Provider 名 */
  provider?: string;
  /** 最大工具调用迭代次数 */
  maxIterations?: number;
  /** 所属插件名（从 agents/ 目录归属推断） */
  ownerPlugin?: string;
  /** spawn_task 使用的 AgentRole（默认 subtask 或按预设名推断） */
  role?: string;
  /** fork：注入主会话快照；fresh：空 standalone 上下文 */
  contextMode?: SubagentContextMode;
  /** 工具名重定向映射 — key 是 LLM 看到的名字，value 是实际执行的工具名 */
  toolAliases?: Record<string, string>;
  /** effort 级别 — 映射到 maxIterations 和 reasoning_effort */
  effort?: AgentEffortLevel;
  /** 记忆范围 — 决定 ContextRepository key 隔离粒度 */
  memory?: 'user' | 'session' | 'agent';
}

// ============================================================================
// 发现
// ============================================================================

/**
 * 扫描 agents/ 目录，发现 *.agent.md 文件
 */
export async function discoverWorkspaceAgents(root?: Plugin | null): Promise<AgentMeta[]> {
  const agents: AgentMeta[] = [];
  const seenNames = new Set<string>();

  const agentDirs: string[] = [
    path.join(process.cwd(), 'agents'),
    path.join(os.homedir(), '.zhin', 'agents'),
    path.join(getDataDir(), 'agents'),
  ];
  // Build dir → pluginName mapping for attribution
  const dirToPlugin = new Map<string, string>();
  if (root) {
    const addPluginDir = (p: Plugin) => {
      if (!p?.filePath) return;
      const dir = path.dirname(p.filePath);
      const d = path.join(dir, 'agents');
      if (!agentDirs.includes(d)) agentDirs.push(d);
      dirToPlugin.set(d, p.name);
      const dirName = path.basename(dir);
      if (dirName === 'src' || dirName === 'lib') {
        const d2 = path.join(path.dirname(dir), 'agents');
        if (!agentDirs.includes(d2)) agentDirs.push(d2);
        dirToPlugin.set(d2, p.name);
      }
    };
    addPluginDir(root);
    for (const child of (root.children || []) as Plugin[]) {
      addPluginDir(child as Plugin);
    }
  }

  for (const agentsDir of agentDirs) {
    if (!fs.existsSync(agentsDir)) continue;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(agentsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      let agentMdPath: string | undefined;
      if (entry.isFile() && entry.name.endsWith('.agent.md')) {
        agentMdPath = path.join(agentsDir, entry.name);
      } else if (entry.isDirectory()) {
        const nested = path.join(agentsDir, entry.name, `${entry.name}.agent.md`);
        if (fs.existsSync(nested)) agentMdPath = nested;
      }
      if (!agentMdPath) continue;

      try {
        const content = await fs.promises.readFile(agentMdPath, 'utf-8');
        const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
        if (!match) {
          logger.debug(`Agent文件 ${agentMdPath} 没有有效的frontmatter格式`);
          continue;
        }

        let jsYaml: any;
        try {
          jsYaml = await import('js-yaml');
          if (jsYaml.default) jsYaml = jsYaml.default;
        } catch (e) {
          logger.warn(`Unable to import js-yaml module: ${e}`);
          continue;
        }

        const metadata = jsYaml.load(match[1]);
        if (!metadata || !metadata.name || !metadata.description) {
          logger.debug(`Agent文件 ${agentMdPath} 缺少必需的 name/description 字段`);
          continue;
        }

        if (seenNames.has(metadata.name)) {
          logger.debug(`Agent '${metadata.name}' 已由先序目录加载，跳过: ${agentMdPath}`);
          continue;
        }
        seenNames.add(metadata.name);

        const roleRaw = typeof metadata.role === 'string' ? metadata.role.trim() : undefined;
        const contextRaw = typeof metadata.contextMode === 'string' ? metadata.contextMode.trim() : undefined;
        const effortRaw = typeof metadata.effort === 'string' ? metadata.effort.trim() : undefined;
        const memoryRaw = typeof metadata.memory === 'string' ? metadata.memory.trim() : undefined;
        const VALID_EFFORT = new Set<AgentEffortLevel>(['low', 'medium', 'high', 'max']);
        const VALID_MEMORY = new Set(['user', 'session', 'agent']);
        agents.push({
          name: metadata.name,
          description: metadata.description,
          keywords: metadata.keywords || [],
          tags: metadata.tags || [],
          toolNames: Array.isArray(metadata.tools) ? metadata.tools : [],
          disallowedTools: Array.isArray(metadata.disallowedTools) ? metadata.disallowedTools : undefined,
          filePath: agentMdPath,
          model: metadata.model,
          provider: metadata.provider,
          maxIterations: typeof metadata.maxIterations === 'number' ? metadata.maxIterations : undefined,
          ownerPlugin: dirToPlugin.get(agentsDir),
          role: roleRaw && KNOWN_AGENT_ROLES.has(roleRaw) ? roleRaw : undefined,
          contextMode: contextRaw === 'fork' || contextRaw === 'fresh' ? contextRaw : undefined,
          toolAliases: metadata.toolAliases && typeof metadata.toolAliases === 'object' && !Array.isArray(metadata.toolAliases)
            ? metadata.toolAliases as Record<string, string>
            : undefined,
          effort: effortRaw && VALID_EFFORT.has(effortRaw as AgentEffortLevel) ? effortRaw as AgentEffortLevel : undefined,
          memory: memoryRaw && VALID_MEMORY.has(memoryRaw) ? memoryRaw as 'user' | 'session' | 'agent' : undefined,
        });
        logger.debug(`Agent发现成功: ${metadata.name}`);
      } catch (e) {
        logger.warn(`Failed to parse agent.md in ${agentMdPath}:`, e);
      }
    }
  }
  return agents;
}

/** 读取 *.agent.md 正文（去掉 frontmatter），供 subagent / route 使用 */
export async function loadAgentMarkdownBody(filePath: string): Promise<string> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '').trim();
}
