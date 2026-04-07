/**
 * 技能发现（SKILL.md 文件扫描与加载）
 *
 * 加载顺序：Workspace（cwd/skills）> Local（~/.zhin/skills）> data/skills > 已加载插件包 skills/
 * 同名先发现者优先，支持平台/依赖兼容性过滤
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger, type Plugin } from '@zhin.js/core';
import { getSkillSearchDirectories, getDataDir } from './discovery-utils.js';

const execAsync = promisify(exec);
const logger = new Logger(null, 'builtin-tools');

// ============================================================================
// 类型
// ============================================================================

export interface SkillMeta {
  name: string;
  description: string;
  keywords?: string[];
  tags?: string[];
  /** SKILL.md frontmatter 中声明的关联工具名列表 */
  toolNames?: string[];
  /** 支持的平台列表（如 ['icqq', 'discord']），不填则为通用 Skill */
  platforms?: string[];
  filePath: string;
  /** 是否常驻注入 system prompt（frontmatter always: true） */
  always?: boolean;
  /** 当前环境是否满足依赖（bins/env） */
  available?: boolean;
  /** 缺失的依赖描述（如 "CLI: ffmpeg", "ENV: API_KEY") */
  requiresMissing?: string[];
}

// ============================================================================
// 发现
// ============================================================================

/**
 * 扫描技能目录，发现 SKILL.md 技能文件
 * @param root 根插件（可选）：用于追加插件包内 `skills/` 扫描，与 `activate_skill` 查找路径一致
 */
export async function discoverWorkspaceSkills(root?: Plugin | null): Promise<SkillMeta[]> {
  const skills: SkillMeta[] = [];
  const seenNames = new Set<string>();
  const dataDir = getDataDir();
  const skillDirs = getSkillSearchDirectories(root ?? undefined);

  // 确保 data/skills 目录存在
  const defaultSkillDir = path.join(dataDir, 'skills');
  if (!fs.existsSync(defaultSkillDir)) {
    fs.mkdirSync(defaultSkillDir, { recursive: true });
    logger.debug(`Created skill directory: ${defaultSkillDir}`);
  }

  for (const skillsDir of skillDirs) {
    if (!fs.existsSync(skillsDir)) continue;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(skillsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      try {
        const content = await fs.promises.readFile(skillMdPath, 'utf-8');
        const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
        if (!match) {
          logger.debug(`Skill文件 ${skillMdPath} 没有有效的frontmatter格式`);
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
          logger.debug(`Skill文件 ${skillMdPath} 缺少必需的 name/description 字段`);
          continue;
        }

        // 平台兼容检查
        const compat = metadata.compatibility || {};
        if (compat.os && Array.isArray(compat.os)) {
          const currentOs = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux';
          if (!compat.os.includes(currentOs)) {
            logger.debug(`Skipping skill '${metadata.name}' (unsupported OS)`);
            continue;
          }
        }

        // 依赖检查
        const requiresBins: string[] = metadata.requires?.bins || compat.deps || metadata.deps || [];
        const requiresEnv: string[] = metadata.requires?.env || [];
        const binsToCheck = Array.isArray(requiresBins) ? requiresBins : [];
        const envToCheck = Array.isArray(requiresEnv) ? requiresEnv : [];
        const requiresMissing: string[] = [];
        for (const bin of binsToCheck) {
          try {
            await execAsync(`which ${bin} 2>/dev/null`);
          } catch {
            requiresMissing.push(`CLI: ${bin}`);
          }
        }
        for (const envKey of envToCheck) {
          if (!process.env[envKey]) {
            requiresMissing.push(`ENV: ${envKey}`);
          }
        }
        const available = requiresMissing.length === 0;

        if (seenNames.has(metadata.name)) {
          logger.debug(`Skill '${metadata.name}' 已由先序目录加载，跳过: ${skillMdPath}`);
          continue;
        }
        seenNames.add(metadata.name);

        skills.push({
          name: metadata.name,
          description: metadata.description,
          keywords: metadata.keywords || [],
          tags: [...(metadata.tags || []), 'workspace-skill'],
          toolNames: Array.isArray(metadata.tools) ? metadata.tools : [],
          platforms: Array.isArray(metadata.platforms) ? metadata.platforms : undefined,
          filePath: skillMdPath,
          always: Boolean(metadata.always),
          available,
          requiresMissing: requiresMissing.length > 0 ? requiresMissing : undefined,
        });
        logger.debug(`Skill发现成功: ${metadata.name}, tools: ${JSON.stringify(metadata.tools || [])}, platforms: ${JSON.stringify(metadata.platforms || '(all)')}`);
      } catch (e) {
        logger.warn(`Failed to parse SKILL.md in ${skillMdPath}:`, e);
      }
    }
  }

  return skills;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取 frontmatter 中 always: true 的技能名列表（用于常驻注入 system prompt）
 */
export function getAlwaysSkillNames(skills: SkillMeta[]): string[] {
  return skills.filter(s => s.always && s.available).map(s => s.name);
}

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/);
  if (match) return content.slice(match[0].length).trim();
  return content.trim();
}

/**
 * 加载 always 技能的正文内容并拼接为「Active Skills」段
 */
export async function loadAlwaysSkillsContent(skills: SkillMeta[]): Promise<string> {
  const always = skills.filter(s => s.always && s.available);
  if (always.length === 0) return '';
  const parts: string[] = [];
  for (const s of always) {
    try {
      const content = await fs.promises.readFile(s.filePath, 'utf-8');
      const body = stripFrontmatter(content);
      parts.push(`### Skill: ${s.name}\n\n${body}`);
    } catch (e) {
      logger.warn(`Failed to load always skill ${s.name}: ${(e as Error).message}`);
    }
  }
  return parts.join('\n\n---\n\n');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 构建技能列表的 XML 摘要，供 model 区分可用/不可用及缺失依赖
 */
export function buildSkillsSummaryXML(skills: SkillMeta[]): string {
  if (skills.length === 0) return '';
  const lines = ['<skills>'];
  for (const s of skills) {
    const available = s.available !== false;
    lines.push(`  <skill available="${available}">`);
    lines.push(`    <name>${escapeXml(s.name)}</name>`);
    lines.push(`    <description>${escapeXml(s.description)}</description>`);
    lines.push(`    <location>${escapeXml(s.filePath)}</location>`);
    if (!available && s.requiresMissing && s.requiresMissing.length > 0) {
      lines.push(`    <requires>${escapeXml(s.requiresMissing.join(', '))}</requires>`);
    }
    lines.push('  </skill>');
  }
  lines.push('</skills>');
  return lines.join('\n');
}

// ============================================================================
// 技能内容解析（activate_skill 使用）
// ============================================================================

/**
 * 检查技能声明的依赖是否在环境中可用；若有缺失返回提示文案，否则返回空字符串
 */
export async function checkSkillDeps(content: string): Promise<string> {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return '';
  let jsYaml: any;
  try {
    jsYaml = await import('js-yaml');
    if (jsYaml.default) jsYaml = jsYaml.default;
  } catch {
    return '';
  }
  const metadata = jsYaml.load(fmMatch[1]);
  if (!metadata) return '';
  const compat = metadata.compatibility || {};
  const deps = compat.deps || metadata.deps;
  if (!deps || !Array.isArray(deps)) return '';
  const missing: string[] = [];
  for (const dep of deps) {
    try {
      await execAsync(`which ${dep} 2>/dev/null`);
    } catch {
      missing.push(dep);
    }
  }
  if (missing.length === 0) return '';
  return `⚠️ 当前环境缺少以下依赖，请先安装后再使用本技能：${missing.join(', ')}`;
}

/**
 * 从 SKILL.md 全文中提取精简的执行指令
 * 只保留 frontmatter（工具列表）和执行规则，去掉示例、测试场景等冗余内容
 */
export function extractSkillInstructions(name: string, content: string, maxBodyLen: number = 4000): string {
  const lines: string[] = [];
  lines.push(`Skill '${name}' activated. 请立即根据以下指导执行工具调用：`);
  lines.push('');

  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fmContent = fmMatch[1];
    const toolsMatch = fmContent.match(/tools:\s*\n((?:\s+-\s+.+\n?)+)/);
    if (toolsMatch) {
      lines.push('## 可用工具');
      lines.push(toolsMatch[0].trim());
      lines.push('');
    }
  }

  const bodyAfterFm = fmMatch && fmMatch.index !== undefined
    ? content.slice(fmMatch.index + fmMatch[0].length).replace(/^\s+/, '')
    : content;

  // Priority: "## 快速操作" / "## Quick Actions" summary for small models
  const quickActionsMatch = bodyAfterFm.match(/## (?:快速操作|Quick\s*Actions)[\s\S]*?(?=\n## [^\s]|$)/i);
  if (quickActionsMatch && maxBodyLen <= 2000) {
    lines.push(quickActionsMatch[0].trim());
    lines.push('');
    lines.push('## 立即行动');
    lines.push('根据上面的指导，立即调用工具完成用户请求。禁止重复调用 activate_skill，禁止用文本描述代替实际工具调用。');
    return lines.join('\n');
  }

  const rulesMatch = content.match(/## 执行规则[\s\S]*?(?=\n## [^\s]|$)/);
  const workflowMatch = content.match(/## (?:Workflow|Instructions|使用说明)[\s\S]*?(?=\n## [^\s]|$)/);

  if (rulesMatch) {
    lines.push(rulesMatch[0].trim());
    lines.push('');
  } else if (workflowMatch) {
    lines.push(workflowMatch[0].trim());
    lines.push('');
  } else if (bodyAfterFm.trim()) {
    const firstH2 = bodyAfterFm.match(/\n## [^\s]/);
    const intro = firstH2 ? bodyAfterFm.slice(0, firstH2.index).trim() : bodyAfterFm.trim();

    const quickStartMatch = bodyAfterFm.match(/## (?:快速开始|Quick\s*Start|Getting\s*Started)[\s\S]*?(?=\n## [^\s]|$)/i);
    const authMatch = bodyAfterFm.match(/## (?:认证|Authentication|Auth)[\s\S]*?(?=\n## [^\s]|$)/i);

    if (quickStartMatch || (intro.length < 200 && bodyAfterFm.length > intro.length)) {
      lines.push('## 指导');
      lines.push(intro);
      lines.push('');
      const extra: string[] = [];
      if (quickStartMatch) extra.push(quickStartMatch[0].trim());
      if (authMatch) extra.push(authMatch[0].trim());
      if (extra.length > 0) {
        const joined = extra.join('\n\n');
        lines.push(joined.length > maxBodyLen ? joined.slice(0, maxBodyLen) + '\n...(truncated)' : joined);
      } else {
        const rest = bodyAfterFm.slice(intro.length).trim();
        lines.push(rest.length > maxBodyLen ? rest.slice(0, maxBodyLen) + '\n...(truncated)' : rest);
      }
      lines.push('');
    } else if (intro) {
      lines.push('## 指导');
      lines.push(intro);
      lines.push('');
    }
  }

  lines.push('## 立即行动');
  lines.push('根据上面的指导，立即调用工具完成用户请求。禁止重复调用 activate_skill，禁止用文本描述代替实际工具调用。');

  return lines.join('\n');
}
