/**
 * AI 内置系统工具
 *
 * 借鉴 OpenClaw/MicroClaw 的实用工具设计，为 ZhinAgent 提供：
 *
 * 文件工具:  read_file, write_file, edit_file, list_dir, glob, grep
 * Shell:     bash
 * 网络:      web_search, web_fetch
 * 计划:      todo_read, todo_write
 * 记忆:      read_memory, write_memory (AGENTS.md)
 * 技能:      activate_skill, install_skill
 * 会话:      session_status, compact_session
 * 技能发现:  工作区 skills/ 目录自动扫描
 * 引导文件:  SOUL.md, TOOLS.md, AGENTS.md 自动加载
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger, type PropertySchema } from '@zhin.js/core';
import { ZhinTool } from '@zhin.js/core';

// 从新模块中 re-export 向后兼容的函数
export { loadSoulPersona, loadToolsGuide, loadAgentsMemory } from './bootstrap.js';

const execAsync = promisify(exec);
const logger = new Logger(null, 'builtin-tools');

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 获取数据目录路径
 */
function getDataDir(): string {
  const dir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 展开路径中的 ~ 为实际 home 目录 */
function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** 将 Node 文件错误转为 miniclawd 风格的结构化短句，便于模型区分并重试 */
function nodeErrToFileMessage(err: unknown, filePath: string, kind: 'read' | 'write' | 'edit' | 'list'): string {
  const e = err as NodeJS.ErrnoException;
  if (e?.code === 'ENOENT') {
    if (kind === 'list') return `Error: Directory not found: ${filePath}`;
    return `Error: File not found: ${filePath}`;
  }
  if (e?.code === 'EACCES') return `Error: Permission denied: ${filePath}`;
  const action = kind === 'read' ? 'reading file' : kind === 'write' ? 'writing file' : kind === 'edit' ? 'editing file' : 'listing directory';
  return `Error ${action}: ${e?.message ?? String(err)}`;
}

// ============================================================================
// 工具工厂函数
// ============================================================================

export interface BuiltinToolsOptions {
  /** Max chars for skill instruction extraction (model-size-aware) */
  skillInstructionMaxChars?: number;
}

/**
 * 创建所有内置系统工具
 */
export function createBuiltinTools(options?: BuiltinToolsOptions): ZhinTool[] {
  const DATA_DIR = getDataDir();
  const skillMaxChars = options?.skillInstructionMaxChars ?? 4000;

  const tools: ZhinTool[] = [];

  // ── read_file（清晰描述 + 强关键词） ──
  tools.push(
    new ZhinTool('read_file')
      .desc('读取指定路径的文件内容。用于查看、打开或读取任意文本文件。')
      .keyword('读文件', '读取文件', '查看文件', '打开文件', '文件内容', 'read file', 'read', 'cat', '查看', '打开')
      .tag('file', 'read')
      .kind('file')
      .param('file_path', { type: 'string', description: '要读取的文件路径（绝对路径或相对项目根目录）' }, true)
      .param('offset', { type: 'number', description: '起始行号（0-based，可选，默认从第 1 行开始）' })
      .param('limit', { type: 'number', description: '最多读取行数（可选，默认全部）' })
      .execute(async (args) => {
        try {
          const fp = expandHome(args.file_path);
          const stat = await fs.promises.stat(fp);
          if (!stat.isFile()) return `Error: Not a file: ${fp}`;
          const content = await fs.promises.readFile(fp, 'utf-8');
          const lines = content.split('\n');
          const offset = args.offset ?? 0;
          const limit = args.limit ?? lines.length;
          const sliced = lines.slice(offset, offset + limit);
          const numbered = sliced.map((line: string, i: number) => `${offset + i + 1} | ${line}`).join('\n');
          return `File: ${fp} (${lines.length} lines, showing ${offset + 1}-${Math.min(offset + limit, lines.length)})\n${numbered}`;
        } catch (e: unknown) {
          return nodeErrToFileMessage(e, args.file_path, 'read');
        }
      }),
  );

  // ── write_file ──
  tools.push(
    new ZhinTool('write_file')
      .desc('向指定路径写入内容，创建或覆盖文件；若目录不存在会自动创建。')
      .keyword('写文件', '写入文件', '创建文件', '保存文件', 'write file', 'write', '保存', '创建')
      .tag('file', 'write')
      .kind('file')
      .param('file_path', { type: 'string', description: '要写入的文件路径' }, true)
      .param('content', { type: 'string', description: '要写入的完整内容' }, true)
      .execute(async (args) => {
        try {
          const fp = expandHome(args.file_path);
          await fs.promises.mkdir(path.dirname(fp), { recursive: true });
          await fs.promises.writeFile(fp, args.content, 'utf-8');
          return `✅ Wrote ${Buffer.byteLength(args.content)} bytes to ${fp}`;
        } catch (e: unknown) {
          return nodeErrToFileMessage(e, args.file_path, 'write');
        }
      }),
  );

  // ── edit_file（old_text 必须精确匹配） ──
  tools.push(
    new ZhinTool('edit_file')
      .desc('在文件中查找并替换一段文本。old_string 必须在文件中精确存在且唯一；建议包含完整行或足够上下文以避免重复匹配。')
      .keyword('编辑文件', '修改文件', '替换内容', '查找替换', 'edit file', 'edit', '修改', '替换')
      .tag('file', 'edit')
      .kind('file')
      .param('file_path', { type: 'string', description: '要编辑的文件路径' }, true)
      .param('old_string', { type: 'string', description: '文件中要替换的原文（必须与文件内容完全一致）' }, true)
      .param('new_string', { type: 'string', description: '替换后的新文本' }, true)
      .execute(async (args) => {
        try {
          const fp = expandHome(args.file_path);
          const content = await fs.promises.readFile(fp, 'utf-8');
          const count = content.split(args.old_string).length - 1;
          if (count === 0) return `Error: old_string not found in file. Make sure it matches exactly.`;
          if (count > 1) return `Warning: old_string appears ${count} times. Please provide more context to make it unique.`;
          const newContent = content.replace(args.old_string, args.new_string);
          await fs.promises.writeFile(fp, newContent, 'utf-8');

          const oldLines = args.old_string.split('\n');
          const newLines = args.new_string.split('\n');
          return `✅ Edited ${fp}\n--- before ---\n${oldLines.slice(0, 5).join('\n')}${oldLines.length > 5 ? '\n...' : ''}\n--- after ---\n${newLines.slice(0, 5).join('\n')}${newLines.length > 5 ? '\n...' : ''}`;
        } catch (e: unknown) {
          return nodeErrToFileMessage(e, args.file_path, 'edit');
        }
      }),
  );

  // ── list_dir（列出目录内容，便于 AI 匹配「列表」「目录」「ls」） ──
  tools.push(
    new ZhinTool('list_dir')
      .desc('列出指定目录下的文件和子目录名称。用于查看目录结构、有哪些文件。')
      .keyword('列目录', '列出目录', '目录列表', '查看目录', 'list directory', 'list dir', 'ls', 'dir', '目录内容', '有哪些文件')
      .tag('file', 'list')
      .kind('file')
      .param('path', { type: 'string', description: '要列出的目录路径（绝对或相对项目根目录）' }, true)
      .execute(async (args) => {
        try {
          const dirPath = path.resolve(process.cwd(), expandHome(args.path));
          const stat = await fs.promises.stat(dirPath);
          if (!stat.isDirectory()) {
            return `Error: Not a directory: ${args.path}`;
          }
          const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
          if (entries.length === 0) {
            return `Directory ${args.path} is empty`;
          }
          const lines: string[] = [];
          for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            lines.push((e.isDirectory() ? '[DIR]  ' : '       ') + e.name);
          }
          return lines.join('\n');
        } catch (e: unknown) {
          return nodeErrToFileMessage(e, args.path, 'list');
        }
      }),
  );

  // ── glob ──
  tools.push(
    new ZhinTool('glob')
      .desc('按 glob 模式查找匹配的文件路径（如 **/*.ts）。用于按模式找文件，而非列出目录。')
      .keyword('glob', '查找文件', '按模式找文件', 'find', '匹配文件')
      .tag('file', 'search')
      .kind('file')
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
        } catch (e: unknown) {
          return `Error: ${errMsg(e)}`;
        }
      }),
  );

  // ── grep ──
  tools.push(
    new ZhinTool('grep')
      .desc('按正则搜索文件内容，返回匹配行和行号')
      .keyword('搜索', '查找内容', 'grep', '正则')
      .tag('search', 'regex')
      .kind('file')
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
        } catch (e: unknown) {
          const err = e as { code?: number; message?: string };
          if (err.code === 1) return `No matches for '${args.pattern}'`;
          return `Error: ${errMsg(e)}`;
        }
      }),
  );

  // ── bash ──
  tools.push(
    new ZhinTool('bash')
      .desc('执行 Shell 命令（带超时保护）')
      .keyword('执行', '运行', '命令', '终端', 'shell', 'bash')
      .tag('shell', 'exec')
      .kind('shell')
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
        } catch (e: unknown) {
          const err = e as { code?: number; message?: string; stdout?: string; stderr?: string };
          return `Error (exit ${err.code || '?'}): ${errMsg(e)}\nSTDOUT:\n${err.stdout || ''}\nSTDERR:\n${err.stderr || ''}`;
        }
      }),
  );

  // ── web_search（搜索网页，返回标题、URL、摘要） ──
  tools.push(
    new ZhinTool('web_search')
      .desc('在互联网上搜索，返回匹配的标题、URL 和摘要片段。用于查资料、找网页。')
      .keyword('搜索', '网上搜', '网页搜索', '搜索引擎', 'search', 'google', '百度', '查询', '搜一下')
      .tag('web', 'search')
      .kind('web')
      .param('query', { type: 'string', description: '搜索关键词或完整查询语句' }, true)
      .param('limit', { type: 'number', description: '返回结果数量（默认 5，建议 1–10）' })
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
        } catch (e: unknown) {
          return `Error: ${errMsg(e)}`;
        }
      }),
  );

  // ── web_fetch（抓取 URL 并提取正文） ──
  tools.push(
    new ZhinTool('web_fetch')
      .desc('抓取指定 URL 的网页内容并提取正文（去除广告等），返回可读文本。用于读文章、获取网页内容。')
      .keyword('抓取网页', '打开链接', '获取网页', '读网页', 'fetch', 'url', '链接内容', '网页内容')
      .tag('web', 'fetch')
      .kind('web')
      .param('url', { type: 'string', description: '要抓取的完整 URL（需 http 或 https）' }, true)
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
        } catch (e: unknown) {
          return `Error: ${errMsg(e)}`;
        }
      }),
  );

  // ── todo_read ──
  tools.push(
    new ZhinTool('todo_read')
      .desc('读取当前任务计划列表，用于查看进度和待办事项')
      .keyword('任务', '计划', '进度', 'todo', '待办')
      .tag('plan', 'todo')
      .kind('plan')
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
        } catch (e: unknown) {
          return `Error: ${errMsg(e)}`;
        }
      }),
  );

  // ── todo_write ──
  tools.push(
    new ZhinTool('todo_write')
      .desc('创建或更新任务计划，用于分解复杂任务并跟踪进度')
      .keyword('创建计划', '更新任务', '标记完成', 'todo')
      .tag('plan', 'todo')
      .kind('plan')
      .param('items', { type: 'array', description: '任务列表 [{title, detail?, status: pending|in-progress|done}]' } as PropertySchema<unknown[]>, true)
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
        } catch (e: unknown) {
          return `Error: ${errMsg(e)}`;
        }
      }),
  );

  // ── read_memory ──
  tools.push(
    new ZhinTool('read_memory')
      .desc('读取持久化记忆（AGENTS.md）。记忆跨会话保持。scope: global（共享）或 chat（按聊天隔离）')
      .keyword('记忆', '记住', '回忆', '之前', '上次', 'memory')
      .tag('memory', 'agents')
      .kind('memory')
      .param('scope', { type: 'string', description: "'global' 或 'chat'（默认 chat）", enum: ['global', 'chat'] }, true)
      .param('chat_id', { type: 'string', description: '聊天 ID（chat scope 时使用）' })
      .execute(async (args) => {
        try {
          const memPath = args.scope === 'global'
            ? path.join(DATA_DIR, 'AGENTS.md')
            : path.join(DATA_DIR, 'groups', args.chat_id || 'default', 'AGENTS.md');
          if (!fs.existsSync(memPath)) return 'No memory stored yet.';
          return await fs.promises.readFile(memPath, 'utf-8');
        } catch (e: unknown) {
          return `Error: ${errMsg(e)}`;
        }
      }),
  );

  // ── write_memory ──
  tools.push(
    new ZhinTool('write_memory')
      .desc('写入持久化记忆。当用户说"记住…"、"记录…"时使用此工具')
      .keyword('记住', '保存', 'remember', '记录')
      .tag('memory', 'agents')
      .kind('memory')
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
        } catch (e: unknown) {
          return `Error: ${errMsg(e)}`;
        }
      }),
  );

  // ── activate_skill ──
  tools.push(
    new ZhinTool('activate_skill')
      .desc('按名称激活技能，加载其完整指令。当判断某个技能与用户请求相关时使用')
      .keyword('技能', '激活', '启用', '使用', 'skill', 'activate', 'use')
      .tag('skill', 'activate')
      .kind('skill')
      .param('name', { type: 'string', description: '技能名称' }, true)
      .execute(async (args) => {
        try {
          // 与 discoverWorkspaceSkills 顺序一致：Workspace > Local > Bundled
          const dirs = [
            path.join(process.cwd(), 'skills'),
            path.join(os.homedir(), '.zhin', 'skills'),
            path.join(DATA_DIR, 'skills'),
          ];
          for (const dir of dirs) {
            const skillPath = path.join(dir, args.name, 'SKILL.md');
            if (fs.existsSync(skillPath)) {
              const fullContent = await fs.promises.readFile(skillPath, 'utf-8');
              // 5.3 可执行环境检查：若 SKILL 声明了 deps，再次检查；缺失则在返回内容中提示
              const depWarning = await checkSkillDeps(fullContent);
              const instructions = extractSkillInstructions(args.name, fullContent, skillMaxChars);
              return depWarning ? `${depWarning}\n\n${instructions}` : instructions;
            }
          }
          return `Skill '${args.name}' not found. Check skills/ directory.`;
        } catch (e: unknown) {
          return `Error: ${errMsg(e)}`;
        }
      }),
  );

  // ── install_skill（从 URL 下载并安装技能） ──
  tools.push(
    new ZhinTool('install_skill')
      .desc('从 URL 下载 SKILL.md 并安装到本地 skills/ 目录。用户要求加入/安装/下载某个技能时使用')
      .keyword('安装技能', '下载技能', '加入', '添加技能', 'install', 'skill', 'join', '学会', '学习技能')
      .tag('skill', 'install')
      .kind('skill')
      .param('url', { type: 'string', description: 'SKILL.md 文件的完整 URL（如 https://example.com/skill.md）' }, true)
      .execute(async (args) => {
        try {
          const response = await fetch(args.url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZhinBot/1.0)' },
            signal: AbortSignal.timeout(15000),
          });
          if (!response.ok) return `Error: HTTP ${response.status} ${response.statusText}`;
          const content = await response.text();

          const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
          if (!fmMatch) return 'Error: 无效的 SKILL.md 文件（缺少 frontmatter）';

          let yaml: any;
          try {
            yaml = await import('yaml');
            if (yaml.default) yaml = yaml.default;
          } catch {
            return 'Error: 无法加载 yaml 解析器';
          }

          const metadata = yaml.parse(fmMatch[1]);
          if (!metadata?.name) return 'Error: SKILL.md 缺少 name 字段';

          const skillName: string = metadata.name;
          const skillDir = path.join(process.cwd(), 'skills', skillName);
          await fs.promises.mkdir(skillDir, { recursive: true });
          const skillPath = path.join(skillDir, 'SKILL.md');
          await fs.promises.writeFile(skillPath, content, 'utf-8');

          logger.info(`技能已安装: ${skillName} → ${skillPath}`);
          return `✅ 技能「${skillName}」已安装到 ${skillPath}。现在可以用 activate_skill("${skillName}") 激活它。`;
        } catch (e: unknown) {
          return `Error: ${errMsg(e)}`;
        }
      }),
  );

  logger.info(`已创建 ${tools.length} 个内置系统工具`);
  return tools;
}

/**
 * 检查技能声明的依赖是否在环境中可用；若有缺失返回提示文案，否则返回空字符串
 */
async function checkSkillDeps(content: string): Promise<string> {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return '';
  let yaml: any;
  try {
    yaml = await import('yaml');
    if (yaml.default) yaml = yaml.default;
  } catch {
    return '';
  }
  const metadata = yaml.parse(fmMatch[1]);
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
 * 这样可以大幅减少 token 占用，让小模型能有足够空间继续调用工具
 */
function extractSkillInstructions(name: string, content: string, maxBodyLen: number = 4000): string {
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

// ============================================================================
// 技能发现
// ============================================================================

export interface SkillMeta {
  name: string;
  description: string;
  keywords?: string[];
  tags?: string[];
  /** SKILL.md frontmatter 中声明的关联工具名列表 */
  toolNames?: string[];
  filePath: string;
  /** 是否常驻注入 system prompt（frontmatter always: true） */
  always?: boolean;
  /** 当前环境是否满足依赖（bins/env） */
  available?: boolean;
  /** 缺失的依赖描述（如 "CLI: ffmpeg", "ENV: API_KEY"） */
  requiresMissing?: string[];
}

/**
 * 扫描技能目录，发现 SKILL.md 技能文件
 * 加载顺序：Workspace（cwd/skills）> Local（~/.zhin/skills）> Bundled（data/skills），同名先发现者优先
 * 支持平台/依赖兼容性过滤。内置技能由 create-zhin 在创建项目时写入 skills/summarize 等。
 */
export async function discoverWorkspaceSkills(): Promise<SkillMeta[]> {
  const skills: SkillMeta[] = [];
  const seenNames = new Set<string>();
  const dataDir = getDataDir();
  const skillDirs = [
    path.join(process.cwd(), 'skills'),           // Workspace
    path.join(os.homedir(), '.zhin', 'skills'),  // Local
    path.join(dataDir, 'skills'),                 // Bundled / 默认 data
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

        // 依赖检查：支持 metadata.requires.bins / requires.env 或 compat.deps / metadata.deps
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
          filePath: skillMdPath,
          always: Boolean(metadata.always),
          available,
          requiresMissing: requiresMissing.length > 0 ? requiresMissing : undefined,
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

/**
 * 获取 frontmatter 中 always: true 的技能名列表（用于常驻注入 system prompt）
 */
export function getAlwaysSkillNames(skills: SkillMeta[]): string[] {
  return skills.filter(s => s.always && s.available).map(s => s.name);
}

/**
 * 去除 frontmatter，返回正文
 */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/);
  if (match) {
    return content.slice(match[0].length).trim();
  }
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

/** 转义 XML 特殊字符 */
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
