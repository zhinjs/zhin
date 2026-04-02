/**
 * Agent 预设发现（*.agent.md 文件扫描）
 *
 * 加载顺序与 skills 一致：Workspace > ~/.zhin > data > 插件包
 * 同名先发现者优先
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Logger, type Plugin } from '@zhin.js/core';
import { getDataDir } from './discovery-utils.js';

const logger = new Logger(null, 'builtin-tools');

// ============================================================================
// 类型
// ============================================================================

export interface AgentMeta {
  name: string;
  description: string;
  keywords?: string[];
  tags?: string[];
  /** frontmatter 中声明的工具名列表 */
  toolNames?: string[];
  /** *.agent.md 文件的绝对路径 */
  filePath: string;
  /** 首选模型名 */
  model?: string;
  /** 首选 Provider 名 */
  provider?: string;
  /** 最大工具调用迭代次数 */
  maxIterations?: number;
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
  if (root) {
    const addPluginDir = (p: Plugin) => {
      if (!p?.filePath) return;
      const dir = path.dirname(p.filePath);
      const d = path.join(dir, 'agents');
      if (!agentDirs.includes(d)) agentDirs.push(d);
      const dirName = path.basename(dir);
      if (dirName === 'src' || dirName === 'lib') {
        const d2 = path.join(path.dirname(dir), 'agents');
        if (!agentDirs.includes(d2)) agentDirs.push(d2);
      }
    };
    addPluginDir(root);
    for (const child of root.children || []) {
      addPluginDir(child);
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

        agents.push({
          name: metadata.name,
          description: metadata.description,
          keywords: metadata.keywords || [],
          tags: metadata.tags || [],
          toolNames: Array.isArray(metadata.tools) ? metadata.tools : [],
          filePath: agentMdPath,
          model: metadata.model,
          provider: metadata.provider,
          maxIterations: typeof metadata.maxIterations === 'number' ? metadata.maxIterations : undefined,
        });
        logger.debug(`Agent发现成功: ${metadata.name}`);
      } catch (e) {
        logger.warn(`Failed to parse agent.md in ${agentMdPath}:`, e);
      }
    }
  }
  return agents;
}
