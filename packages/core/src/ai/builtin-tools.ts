/**
 * AI 内置系统工具
 *
 * 借鉴 OpenClaw/MicroClaw 的实用工具设计，为 ZhinAgent 提供：
 *
 * 文件工具:  read_file, write_file, edit_file, glob, grep
 * Shell:     bash
 * 网络:      web_search, web_fetch
 * 计划:      todo_read, todo_write
 * 记忆:      read_memory, write_memory (AGENTS.md)
 * 技能:      activate_skill
 * 会话:      session_status, compact_session
 * 技能发现:  工作区 skills/ 目录自动扫描
 * 引导文件:  SOUL.md, TOOLS.md, AGENTS.md 自动加载
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger } from '@zhin.js/logger';
import { ZhinTool } from '../built/tool.js';

// 从新模块中 re-export 向后兼容的函数
export { loadSoulPersona, loadToolsGuide, loadAgentsMemory } from './bootstrap.js';

const execAsync = promisify(exec);
const logger = new Logger(null, 'builtin-tools');

/**
 * 获取数据目录路径
 */
function getDataDir(): string {
  const dir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ============================================================================
// 工具工厂函数
// ============================================================================

/**
 * 创建所有内置系统工具
 */
export function createBuiltinTools(): ZhinTool[] {
  const DATA_DIR = getDataDir();

  const tools: ZhinTool[] = [];

  // ── read_file ──
  tools.push(
    new ZhinTool('read_file')
      .desc('读取文件内容（带行号，支持 offset/limit 分页）')
      .keyword('读文件', '查看', '打开', 'cat', 'read')
      .tag('file', 'read')
      .param('file_path', { type: 'string', description: '文件路径（绝对或相对）' }, true)
      .param('offset', { type: 'number', description: '起始行号（0-based，默认 0）' })
      .param('limit', { type: 'number', description: '最大读取行数（默认全部）' })
      .execute(async (args) => {
        try {
          const content = await fs.promises.readFile(args.file_path, 'utf-8');
          const lines = content.split('\n');
          const offset = args.offset ?? 0;
          const limit = args.limit ?? lines.length;
          const sliced = lines.slice(offset, offset + limit);
          const numbered = sliced.map((line: string, i: number) => `${offset + i + 1} | ${line}`).join('\n');
          return `File: ${args.file_path} (${lines.length} lines, showing ${offset + 1}-${Math.min(offset + limit, lines.length)})\n${numbered}`;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }),
  );

  // ── write_file ──
  tools.push(
    new ZhinTool('write_file')
      .desc('创建或覆盖文件（自动创建目录）')
      .keyword('写文件', '创建文件', '保存', 'write')
      .tag('file', 'write')
      .param('file_path', { type: 'string', description: '文件路径' }, true)
      .param('content', { type: 'string', description: '写入内容' }, true)
      .execute(async (args) => {
        try {
          await fs.promises.mkdir(path.dirname(args.file_path), { recursive: true });
          await fs.promises.writeFile(args.file_path, args.content, 'utf-8');
          return `✅ Wrote ${Buffer.byteLength(args.content)} bytes to ${args.file_path}`;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }),
  );

  // ── edit_file ──
  tools.push(
    new ZhinTool('edit_file')
      .desc('查找并替换文件内容（old_string 必须唯一匹配）。注意：old_string 应包含完整的行内容（含前后文），不要只匹配单个数字或单词')
      .keyword('编辑', '修改', '替换', 'edit')
      .tag('file', 'edit')
      .param('file_path', { type: 'string', description: '文件路径' }, true)
      .param('old_string', { type: 'string', description: '要替换的原文（必须在文件中唯一出现，建议包含完整行）' }, true)
      .param('new_string', { type: 'string', description: '替换后的文本（必须是替换 old_string 后的完整内容）' }, true)
      .execute(async (args) => {
        try {
          const content = await fs.promises.readFile(args.file_path, 'utf-8');
          const count = content.split(args.old_string).length - 1;
          if (count === 0) return `Error: old_string not found in ${args.file_path}. Use read_file to check current content first.`;
          if (count > 1) return `Error: old_string matches ${count} locations (must be unique). Include more context to make it unique.`;
          const newContent = content.replace(args.old_string, args.new_string);
          await fs.promises.writeFile(args.file_path, newContent, 'utf-8');

          // 返回修改前后的差异上下文，帮助 AI 确认修改正确
          const oldLines = args.old_string.split('\n');
          const newLines = args.new_string.split('\n');
          return `✅ Edited ${args.file_path}\n--- before ---\n${oldLines.slice(0, 5).join('\n')}${oldLines.length > 5 ? '\n...' : ''}\n--- after ---\n${newLines.slice(0, 5).join('\n')}${newLines.length > 5 ? '\n...' : ''}`;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }),
  );

  // ── glob ──
  tools.push(
    new ZhinTool('glob')
      .desc('按 glob 模式查找文件（如 **/*.ts）')
      .keyword('查找文件', '搜索文件', '文件列表', 'ls', 'find')
      .tag('file', 'search')
      .param('pattern', { type: 'string', description: 'Glob 模式（如 **/*.ts）' }, true)
      .param('cwd', { type: 'string', description: '工作目录（默认项目根目录）' })
      .execute(async (args) => {
        try {
          const cwd = args.cwd || process.cwd();
          const { stdout } = await execAsync(
            `find . -path './${args.pattern}' -type f 2>/dev/null | head -100`,
            { cwd },
          );
          const files = stdout.trim().split('\n').filter(Boolean);
          return files.length === 0
            ? `No files matching '${args.pattern}'`
            : `Found ${files.length} files:\n${files.join('\n')}`;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }),
  );

  // ── grep ──
  tools.push(
    new ZhinTool('grep')
      .desc('按正则搜索文件内容，返回匹配行和行号')
      .keyword('搜索', '查找内容', 'grep', '正则')
      .tag('search', 'regex')
      .param('pattern', { type: 'string', description: '正则表达式' }, true)
      .param('path', { type: 'string', description: '搜索路径（默认 .）' })
      .param('include', { type: 'string', description: '文件类型过滤（如 *.ts）' })
      .execute(async (args) => {
        try {
          const searchPath = args.path || '.';
          const includeFlag = args.include ? `--include='${args.include}'` : '';
          const { stdout } = await execAsync(
            `grep -rn ${includeFlag} '${args.pattern}' ${searchPath} 2>/dev/null | head -50`,
            { cwd: process.cwd() },
          );
          return stdout.trim() || `No matches for '${args.pattern}'`;
        } catch (e: any) {
          if (e.code === 1) return `No matches for '${args.pattern}'`;
          return `Error: ${e.message}`;
        }
      }),
  );

  // ── bash ──
  tools.push(
    new ZhinTool('bash')
      .desc('执行 Shell 命令（带超时保护）')
      .keyword('执行', '运行', '命令', '终端', 'shell', 'bash')
      .tag('shell', 'exec')
      .param('command', { type: 'string', description: 'Shell 命令' }, true)
      .param('cwd', { type: 'string', description: '工作目录' })
      .param('timeout', { type: 'number', description: '超时毫秒数（默认 30000）' })
      .execute(async (args) => {
        try {
          const timeout = args.timeout ?? 30000;
          const { stdout, stderr } = await execAsync(args.command, {
            cwd: args.cwd || process.cwd(),
            timeout,
            maxBuffer: 1024 * 1024,
          });
          let result = '';
          if (stdout.trim()) result += `STDOUT:\n${stdout.trim()}`;
          if (stderr.trim()) result += `${result ? '\n' : ''}STDERR:\n${stderr.trim()}`;
          return result || '(no output)';
        } catch (e: any) {
          return `Error (exit ${e.code || '?'}): ${e.message}\nSTDOUT:\n${e.stdout || ''}\nSTDERR:\n${e.stderr || ''}`;
        }
      }),
  );

  // ── web_search ──
  tools.push(
    new ZhinTool('web_search')
      .desc('通过 DuckDuckGo 搜索网页，返回标题、URL 和摘要（零依赖）')
      .keyword('搜索', '网上', '谷歌', '百度', '查询', 'search')
      .tag('web', 'search')
      .param('query', { type: 'string', description: '搜索关键词' }, true)
      .param('limit', { type: 'number', description: '最大结果数（默认 5）' })
      .execute(async (args) => {
        try {
          const limit = args.limit ?? 5;
          const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
          const res = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; ZhinBot/1.0)',
              'Accept': 'text/html',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`;
          const html = await res.text();

          // 从 DuckDuckGo HTML 页面提取搜索结果
          const results: { title: string; url: string; snippet: string }[] = [];
          const resultBlocks = html.split(/class="result\s/);

          for (let i = 1; i < resultBlocks.length && results.length < limit; i++) {
            const block = resultBlocks[i];

            // 提取标题和 URL
            const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
            if (!titleMatch) continue;

            let href = titleMatch[1];
            // DuckDuckGo 会将 URL 编码到 uddg 参数中
            const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
            if (uddgMatch) href = decodeURIComponent(uddgMatch[1]);

            const title = titleMatch[2].replace(/<[^>]+>/g, '').trim();

            // 提取摘要
            const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
            const snippet = snippetMatch
              ? snippetMatch[1].replace(/<[^>]+>/g, '').trim()
              : '';

            if (title && href) {
              results.push({ title, url: href, snippet });
            }
          }

          if (results.length === 0) return 'No results found.';
          return results.map((r, i) =>
            `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`,
          ).join('\n\n');
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }),
  );

  // ── web_fetch ──
  tools.push(
    new ZhinTool('web_fetch')
      .desc('抓取网页内容（去除 HTML 标签，最大 20KB）')
      .keyword('抓取', '网页', 'fetch', 'url', '链接')
      .tag('web', 'fetch')
      .param('url', { type: 'string', description: 'URL 地址' }, true)
      .execute(async (args) => {
        try {
          const response = await fetch(args.url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZhinBot/1.0)' },
            signal: AbortSignal.timeout(15000),
          });
          if (!response.ok) return `HTTP ${response.status}: ${response.statusText}`;
          const html = await response.text();
          const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          const maxLen = 20 * 1024;
          return text.length > maxLen ? text.slice(0, maxLen) + '\n...(truncated)' : text;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }),
  );

  // ── todo_read ──
  tools.push(
    new ZhinTool('todo_read')
      .desc('读取当前任务计划列表，用于查看进度和待办事项')
      .keyword('任务', '计划', '进度', 'todo', '待办')
      .tag('plan', 'todo')
      .param('chat_id', { type: 'string', description: '聊天范围（传 "global" 表示全局，或传具体聊天 ID）' }, true)
      .execute(async (args) => {
        try {
          const dir = args.chat_id && args.chat_id !== 'global' ? path.join(DATA_DIR, 'groups', args.chat_id) : DATA_DIR;
          const todoPath = path.join(dir, 'TODO.json');
          if (!fs.existsSync(todoPath)) return 'No tasks found. Use todo_write to create a plan.';
          const data = JSON.parse(await fs.promises.readFile(todoPath, 'utf-8'));
          if (!data.items || data.items.length === 0) return 'Task list is empty.';
          const lines = data.items.map((item: any, i: number) => {
            const status = item.status === 'done' ? '✅' : item.status === 'in-progress' ? '🔄' : '⬜';
            return `${status} ${i + 1}. ${item.title}${item.detail ? ' — ' + item.detail : ''}`;
          });
          return `📋 Tasks (${data.items.filter((i: any) => i.status === 'done').length}/${data.items.length} done):\n${lines.join('\n')}`;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }),
  );

  // ── todo_write ──
  tools.push(
    new ZhinTool('todo_write')
      .desc('创建或更新任务计划，用于分解复杂任务并跟踪进度')
      .keyword('创建计划', '更新任务', '标记完成', 'todo')
      .tag('plan', 'todo')
      .param('items', { type: 'array', description: '任务列表 [{title, detail?, status: pending|in-progress|done}]' } as any, true)
      .param('chat_id', { type: 'string', description: '聊天范围（可选）' })
      .execute(async (args) => {
        try {
          const dir = args.chat_id ? path.join(DATA_DIR, 'groups', args.chat_id) : DATA_DIR;
          const todoPath = path.join(dir, 'TODO.json');
          await fs.promises.mkdir(path.dirname(todoPath), { recursive: true });
          const data = { updated_at: new Date().toISOString(), items: args.items };
          await fs.promises.writeFile(todoPath, JSON.stringify(data, null, 2), 'utf-8');
          const done = args.items.filter((i: any) => i.status === 'done').length;
          return `✅ Tasks updated (${done}/${args.items.length} done)`;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }),
  );

  // ── read_memory ──
  tools.push(
    new ZhinTool('read_memory')
      .desc('读取持久化记忆（AGENTS.md）。记忆跨会话保持。scope: global（共享）或 chat（按聊天隔离）')
      .keyword('记忆', '记住', '回忆', '之前', '上次', 'memory')
      .tag('memory', 'agents')
      .param('scope', { type: 'string', description: "'global' 或 'chat'（默认 chat）", enum: ['global', 'chat'] }, true)
      .param('chat_id', { type: 'string', description: '聊天 ID（chat scope 时使用）' })
      .execute(async (args) => {
        try {
          const memPath = args.scope === 'global'
            ? path.join(DATA_DIR, 'AGENTS.md')
            : path.join(DATA_DIR, 'groups', args.chat_id || 'default', 'AGENTS.md');
          if (!fs.existsSync(memPath)) return 'No memory stored yet.';
          return await fs.promises.readFile(memPath, 'utf-8');
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }),
  );

  // ── write_memory ──
  tools.push(
    new ZhinTool('write_memory')
      .desc('写入持久化记忆。当用户说"记住…"、"记录…"时使用此工具')
      .keyword('记住', '保存', 'remember', '记录')
      .tag('memory', 'agents')
      .param('content', { type: 'string', description: '要保存的记忆内容（Markdown）' }, true)
      .param('scope', { type: 'string', description: "'global' 或 'chat'（默认 chat）", enum: ['global', 'chat'] })
      .param('chat_id', { type: 'string', description: '聊天 ID' })
      .execute(async (args) => {
        try {
          const memPath = args.scope === 'global'
            ? path.join(DATA_DIR, 'AGENTS.md')
            : path.join(DATA_DIR, 'groups', args.chat_id || 'default', 'AGENTS.md');
          await fs.promises.mkdir(path.dirname(memPath), { recursive: true });
          await fs.promises.writeFile(memPath, args.content, 'utf-8');
          return `✅ Memory saved (${args.scope || 'chat'} scope)`;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }),
  );

  // ── activate_skill ──
  tools.push(
    new ZhinTool('activate_skill')
      .desc('按名称激活技能，加载其完整指令。当判断某个技能与用户请求相关时使用')
      .keyword('技能', '激活', '启用', '使用', 'skill', 'activate', 'use')
      .tag('skill', 'activate')
      .param('name', { type: 'string', description: '技能名称' }, true)
      .execute(async (args) => {
        try {
          const dirs = [
            path.join(process.cwd(), 'skills'),
            path.join(DATA_DIR, 'skills'),
          ];
          for (const dir of dirs) {
            const skillPath = path.join(dir, args.name, 'SKILL.md');
            if (fs.existsSync(skillPath)) {
              const fullContent = await fs.promises.readFile(skillPath, 'utf-8');
              // 提取精简的执行指令，避免全文输出占用太多 token
              return extractSkillInstructions(args.name, fullContent);
            }
          }
          return `Skill '${args.name}' not found. Check skills/ directory.`;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }),
  );

  logger.info(`已创建 ${tools.length} 个内置系统工具`);
  return tools;
}

/**
 * 从 SKILL.md 全文中提取精简的执行指令
 * 只保留 frontmatter（工具列表）和执行规则，去掉示例、测试场景等冗余内容
 * 这样可以大幅减少 token 占用，让小模型能有足够空间继续调用工具
 */
function extractSkillInstructions(name: string, content: string): string {
  const lines: string[] = [];
  lines.push(`Skill '${name}' activated. 请立即根据以下指导执行工具调用：`);
  lines.push('');

  // 1. 提取 frontmatter 中的 tools 列表
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

  // 2. 提取"执行规则"或"规则"部分（关键的行动指导）
  const rulesMatch = content.match(/## 执行规则[\s\S]*?(?=\n## [^执]|$)/);
  if (rulesMatch) {
    lines.push(rulesMatch[0].trim());
    lines.push('');
  }

  // 3. 添加强制执行提醒
  lines.push('## 立即行动');
  lines.push('你现在必须根据用户的原始请求，立即调用上述工具。不要描述步骤，直接执行 tool_calls。');

  return lines.join('\n');
}

// ============================================================================
// 技能发现
// ============================================================================

interface SkillMeta {
  name: string;
  description: string;
  keywords?: string[];
  tags?: string[];
  /** SKILL.md frontmatter 中声明的关联工具名列表 */
  toolNames?: string[];
  filePath: string;
}

/**
 * 扫描工作区 skills/ 目录，发现 SKILL.md 技能文件
 * 支持平台/依赖兼容性过滤
 */
export async function discoverWorkspaceSkills(): Promise<SkillMeta[]> {
  const skills: SkillMeta[] = [];
  const dataDir = getDataDir();
  const skillDirs = [
    path.join(process.cwd(), 'skills'),
    path.join(dataDir, 'skills'),
  ];

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
        // 改进的 frontmatter 正则：支持多种换行符、可选的尾部空白
        const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
        if (!match) {
          logger.debug(`Skill文件 ${skillMdPath} 没有有效的frontmatter格式`);
          continue;
        }

        // 动态导入 yaml，使用 .default 兼容 ESM 模块
        let yaml: any;
        try {
          yaml = await import('yaml');
          if (yaml.default) yaml = yaml.default;
        } catch (e) {
          logger.warn(`Unable to import yaml module: ${e}`);
          continue;
        }

        const metadata = yaml.parse(match[1]);
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
        const deps = compat.deps || metadata.deps;
        if (deps && Array.isArray(deps)) {
          let missing = false;
          for (const dep of deps) {
            try {
              await execAsync(`which ${dep} 2>/dev/null`);
            } catch {
              logger.debug(`Skipping skill '${metadata.name}' (missing dep: ${dep})`);
              missing = true;
              break;
            }
          }
          if (missing) continue;
        }

        skills.push({
          name: metadata.name,
          description: metadata.description,
          keywords: metadata.keywords || [],
          tags: [...(metadata.tags || []), 'workspace-skill'],
          toolNames: Array.isArray(metadata.tools) ? metadata.tools : [],
          filePath: skillMdPath,
        });
        logger.debug(`Skill发现成功: ${metadata.name}, tools: ${JSON.stringify(metadata.tools || [])}`);
      } catch (e) {
        logger.warn(`Failed to parse SKILL.md in ${skillMdPath}:`, e);
      }
    }
  }

  if (skills.length > 0) {
    logger.info(`发现 ${skills.length} 个工作区技能: ${skills.map(s => `${s.name}(tools:${(s.toolNames || []).join(',')})`).join(', ')}`);
  }

  return skills;
}
