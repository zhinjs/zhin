/// <reference path="../adm-zip.d.ts" />
import { Command } from 'commander';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import inquirer from 'inquirer';
import yaml from 'yaml';
import AdmZip from 'adm-zip';
import { logger } from '../utils/logger.js';

const DEFAULT_REGISTRY_URL =
  process.env.ZHIN_SKILLS_REGISTRY || 'https://zhin.js.org/skills.json';

interface RegistrySkillInfo {
  id: string;
  name: string;
  description: string;
  keywords?: string[];
  tags?: string[];
  author?: string;
  source?: string;
  homepage?: string;
  lastUpdate?: string;
}

interface SkillMeta {
  name: string;
  description: string;
  keywords?: string[];
  tags?: string[];
  toolNames?: string[];
  dir: string;
  source: 'workspace' | 'local';
}

function getSkillDirs(): { dir: string; source: 'workspace' | 'local' }[] {
  return [
    { dir: path.join(process.cwd(), 'skills'), source: 'workspace' },
    { dir: path.join(os.homedir(), '.zhin', 'skills'), source: 'local' },
  ];
}

async function fetchRegistry(): Promise<{ skills: RegistrySkillInfo[] }> {
  const url = DEFAULT_REGISTRY_URL;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`获取技能列表失败: ${res.status} ${res.statusText}，请检查网络或设置 ZHIN_SKILLS_REGISTRY`);
  }
  const json = (await res.json()) as { skills?: RegistrySkillInfo[] };
  return { skills: json.skills || [] };
}

async function discoverSkills(): Promise<SkillMeta[]> {
  const results: SkillMeta[] = [];
  const seen = new Set<string>();

  for (const { dir, source } of getSkillDirs()) {
    if (!(await fs.pathExists(dir))) continue;

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(dir, entry.name, 'SKILL.md');
      if (!(await fs.pathExists(skillMd))) continue;

      try {
        const content = await fs.readFile(skillMd, 'utf-8');
        const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
        if (!match) continue;

        const meta = yaml.parse(match[1]);
        if (!meta?.name || !meta?.description) continue;
        if (seen.has(meta.name)) continue;
        seen.add(meta.name);

        results.push({
          name: meta.name,
          description: meta.description,
          keywords: Array.isArray(meta.keywords) ? meta.keywords : [],
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          toolNames: Array.isArray(meta.tools) ? meta.tools : [],
          dir: path.join(dir, entry.name),
          source,
        });
      } catch {
        // skip invalid skill
      }
    }
  }

  return results;
}

function matchKeyword(skill: RegistrySkillInfo, keyword: string): boolean {
  const k = keyword.toLowerCase();
  if (skill.name.toLowerCase().includes(k)) return true;
  if (skill.description.toLowerCase().includes(k)) return true;
  if (skill.keywords?.some(kw => kw.toLowerCase().includes(k))) return true;
  if (skill.tags?.some(t => t.toLowerCase().includes(k))) return true;
  if (skill.id.toLowerCase().includes(k)) return true;
  return false;
}

// --- list ---
const listCommand = new Command('list')
  .alias('ls')
  .description('列出本地已安装的技能（工作区与 ~/.zhin/skills）')
  .option('-l, --long', '显示更多信息', false)
  .action(async (options: { long?: boolean }) => {
    try {
      const skills = await discoverSkills();
      if (skills.length === 0) {
        logger.warn('未发现任何本地技能');
        logger.log('');
        logger.log('💡 使用 zhin skills search "关键词" 搜索云端，zhin skills add <id> 安装');
        return;
      }
      logger.success(`共 ${skills.length} 个本地技能：`);
      logger.log('');
      for (const s of skills) {
        const src = s.source === 'workspace' ? '工作区' : '本地';
        if (options.long) {
          logger.log(`  ${s.name}`);
          logger.log(`    描述: ${s.description}`);
          logger.log(`    来源: ${src}  ${s.dir}`);
          if (s.toolNames?.length) logger.log(`    工具: ${s.toolNames.join(', ')}`);
          logger.log('');
        } else {
          logger.log(`  ${s.name}  (${src})`);
        }
      }
    } catch (e: any) {
      logger.error(`列出技能失败: ${e.message}`);
      process.exit(1);
    }
  });

// --- search (cloud) ---
const searchCommand = new Command('search')
  .description('从云端技能商店搜索（按关键词匹配名称、描述、标签）')
  .argument('[keyword]', '搜索关键词')
  .action(async (keyword: string) => {
    try {
      const { skills } = await fetchRegistry();
      const filtered = keyword
        ? skills.filter(s => matchKeyword(s, keyword))
        : skills;
      if (filtered.length === 0) {
        logger.warn(keyword ? `未找到包含 “${keyword}” 的技能` : '云端暂无技能');
        logger.log('');
        logger.log('💡 使用 zhin skills add --new 本地创建技能');
        return;
      }
      logger.success(keyword ? `找到 ${filtered.length} 个匹配技能：` : `共 ${filtered.length} 个技能：`);
      logger.log('');
      for (const s of filtered) {
        logger.log(`  ${s.id}  ${s.name}`);
        logger.log(`    ${s.description}`);
        if (s.author) logger.log(`    作者: ${s.author}`);
        logger.log(`    安装: zhin skills add ${s.id}`);
        logger.log('');
      }
    } catch (e: any) {
      logger.error(`搜索技能失败: ${e.message}`);
      process.exit(1);
    }
  });

// --- add: from registry or --new ---
async function installFromRegistry(skill: RegistrySkillInfo, targetDir: string): Promise<void> {
  if (!skill.source) {
    throw new Error(`该技能暂不支持一键安装（缺少 source）`);
  }

  const res = await fetch(skill.source);
  if (!res.ok) {
    throw new Error(`下载失败: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buf);
  const entries = zip.getEntries();

  let skillRoot: { basePath: string } | null = null;
  for (const entry of entries) {
    const name = entry.entryName.replace(/\/$/, '');
    if (name.endsWith('SKILL.md')) {
      const base = name.slice(0, -'SKILL.md'.length).replace(/\/$/, '');
      if (!skillRoot || base.length < skillRoot.basePath.length) {
        skillRoot = { basePath: base || '' };
      }
    }
  }
  if (!skillRoot) {
    throw new Error('ZIP 内未找到 SKILL.md');
  }

  const basePath = skillRoot.basePath ? skillRoot.basePath + '/' : '';
  await fs.ensureDir(targetDir);
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    if (!name.startsWith(basePath)) continue;
    const rel = name.slice(basePath.length);
    if (!rel) continue;
    const dest = path.join(targetDir, rel);
    await fs.ensureDir(path.dirname(dest));
    const data = entry.getData();
    if (Buffer.isBuffer(data)) {
      await fs.writeFile(dest, data);
    }
  }
}

const addCommand = new Command('add')
  .description('从云端安装技能，或使用 --new 交互式创建本地技能')
  .argument('[id]', '技能 id 或 name（从云端安装时必填）')
  .option('--new', '交互式创建新技能（不从云端安装）', false)
  .option('--local', '安装到 ~/.zhin/skills（默认安装到当前项目 skills/）', false)
  .option('-d, --dir <path>', '指定技能目录（仅 --new 时生效）')
  .action(async (id: string, options: { new?: boolean; local?: boolean; dir?: string }) => {
    try {
      if (options.new) {
        const baseDir = path.resolve(
          options.dir ?? (options.local ? path.join(os.homedir(), '.zhin', 'skills') : path.join(process.cwd(), 'skills')),
        );
        const { name, description } = await inquirer.prompt([
          {
            type: 'input',
            name: 'name',
            message: '技能名称:',
            validate: (v: string) => {
              if (!v.trim()) return '名称不能为空';
              if (!/^[a-zA-Z0-9_-]+$/.test(v)) return '名称只能包含字母、数字、下划线和横线';
              return true;
            },
          },
          {
            type: 'input',
            name: 'description',
            message: '技能描述:',
            validate: (v: string) => (v.trim() ? true : '描述不能为空'),
          },
        ]);

        const skillDir = path.join(baseDir, name);
        if (await fs.pathExists(skillDir)) {
          logger.error(`技能已存在: ${skillDir}`);
          process.exit(1);
        }

        await fs.ensureDir(skillDir);
        const skillMd = path.join(skillDir, 'SKILL.md');
        const content = `---
name: ${name}
description: ${description}
keywords: []
tags: []
tools: []
---

## 执行规则

（在此填写该技能的执行步骤与工具使用说明）

## 示例

（可选）
`;
        await fs.writeFile(skillMd, content, 'utf-8');
        logger.success(`已创建技能: ${name}`);
        logger.log(`  路径: ${skillMd}`);
        return;
      }

      if (!id || !id.trim()) {
        logger.error('请指定技能 id（如 zhin skills add <id>），或使用 --new 创建新技能');
        process.exit(1);
      }

      const { skills } = await fetchRegistry();
      const skill = skills.find(s => s.id === id.trim() || s.name === id.trim());
      if (!skill) {
        logger.error(`未找到技能: ${id.trim()}，请使用 zhin skills search 查看可用技能`);
        process.exit(1);
      }
      const installName = skill.name;
      const finalDir = options.local
        ? path.join(os.homedir(), '.zhin', 'skills', installName)
        : path.join(process.cwd(), 'skills', installName);

      if (await fs.pathExists(finalDir)) {
        logger.error(`技能已存在: ${finalDir}，请先 remove 或选择其他目录`);
        process.exit(1);
      }

      logger.info(`正在安装技能: ${installName} ...`);
      await installFromRegistry(skill, finalDir);
      logger.success(`已安装技能: ${installName}`);
      logger.log(`  路径: ${finalDir}`);
    } catch (e: any) {
      logger.error(`添加技能失败: ${e.message}`);
      process.exit(1);
    }
  });

// --- remove ---
const removeCommand = new Command('remove')
  .alias('rm')
  .description('移除本地已安装的技能目录')
  .argument('<name>', '技能名称')
  .option('--local', '从 ~/.zhin/skills 删除（默认优先删除工作区）', false)
  .action(async (name: string, options: { local?: boolean }) => {
    try {
      const skills = await discoverSkills();
      const matches = skills.filter(s => s.name === name);
      if (matches.length === 0) {
        logger.error(`未找到本地技能: ${name}`);
        process.exit(1);
      }

      let target: SkillMeta;
      if (options.local) {
        target = matches.find(m => m.source === 'local') ?? matches[0];
      } else {
        target = matches.find(m => m.source === 'workspace') ?? matches[0];
      }

      const { confirm } = await inquirer.prompt([
        { type: 'confirm', name: 'confirm', message: `确认删除技能 “${name}”？（目录: ${target.dir}）`, default: false },
      ]);
      if (!confirm) {
        logger.log('已取消');
        return;
      }
      await fs.remove(target.dir);
      logger.success(`已删除技能: ${name}`);
    } catch (e: any) {
      logger.error(`删除技能失败: ${e.message}`);
      process.exit(1);
    }
  });

export const skillsCommand = new Command('skills')
  .description('管理 AI 技能：search 云端搜索，add 从云端安装或 --new 本地创建，list/remove 本地')
  .addCommand(listCommand)
  .addCommand(searchCommand)
  .addCommand(addCommand)
  .addCommand(removeCommand);
