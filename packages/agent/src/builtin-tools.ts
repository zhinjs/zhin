/**
 * AI 内置系统工具
 *
 * 文件工具:  read_file, write_file, edit_file, list_dir, glob, grep
 * Shell:     bash
 * 网络:      web_search, web_fetch
 * 计划:      todo_read, todo_write
 * 记忆:      read_memory, write_memory (AGENTS.md)
 * 技能:      activate_skill, install_skill
 *
 * 发现逻辑已拆分到 discover-skills.ts / discover-agents.ts / discover-tools.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger, type PropertySchema } from '@zhin.js/core';
import { ZhinTool } from '@zhin.js/core';
import { assertFileAccess, checkBashCommandSafety, shellEscape } from './file-policy.js';
import {
  errMsg, expandHome, getDataDir, mergeSkillDirsWithResolver, nodeErrToFileMessage,
} from './discovery-utils.js';
import { checkSkillDeps, extractSkillInstructions } from './discover-skills.js';

const execAsync = promisify(exec);
const logger = new Logger(null, 'builtin-tools');

// ============================================================================
// 工具工厂函数
// ============================================================================

export interface BuiltinToolsOptions {
  /** Max chars for skill instruction extraction (model-size-aware) */
  skillInstructionMaxChars?: number;
  /**
   * 返回额外技能根目录（每个根下为 `<skillName>/SKILL.md`），通常为已加载插件的 `.../skills`
   */
  pluginSkillRootsResolver?: () => string[];
  /**
   * 按名称查找 SkillFeature 中已注册技能的 filePath
   * 返回 SKILL.md 的绝对路径，或 undefined 表示未找到
   */
  skillFileLookup?: (name: string) => string | undefined;
}

/**
 * 创建所有内置系统工具
 */
export function createBuiltinTools(options?: BuiltinToolsOptions): ZhinTool[] {
  const DATA_DIR = getDataDir();
  const skillMaxChars = options?.skillInstructionMaxChars ?? 4000;
  const skillDirList = () => mergeSkillDirsWithResolver(options?.pluginSkillRootsResolver);
  const skillFileLookup = options?.skillFileLookup;

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
          assertFileAccess(fp);
          const stat = await fs.promises.stat(fp);
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
          assertFileAccess(fp);
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
          assertFileAccess(fp);
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
          assertFileAccess(dirPath);
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
          assertFileAccess(cwd);
          // 安全转义 glob pattern 防止命令注入
          const safePattern = shellEscape(args.pattern);
          const { stdout } = await execAsync(
            `find . -path ./${safePattern} -type f 2>/dev/null | head -100`,
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
          assertFileAccess(path.resolve(process.cwd(), searchPath));
          // 安全转义 pattern 和 include 参数防止命令注入
          const safePattern = shellEscape(args.pattern);
          const safePath = shellEscape(searchPath);
          const includeFlag = args.include ? `--include=${shellEscape(args.include)}` : '';
          const { stdout } = await execAsync(
            `grep -rn ${includeFlag} ${safePattern} ${safePath} 2>/dev/null | head -50`,
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
          const cmd = String(args.command || '');
          // 检查命令是否可能泄漏敏感信息
          const safety = checkBashCommandSafety(cmd);
          if (!safety.safe) return `Error: ${safety.reason}`;
          const { stdout, stderr } = await execAsync(cmd, {
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
          // 优先查找 SkillFeature 中已注册技能的 filePath
          const registeredPath = skillFileLookup?.(args.name);
          if (registeredPath && fs.existsSync(registeredPath)) {
            const fullContent = await fs.promises.readFile(registeredPath, 'utf-8');
            const depWarning = await checkSkillDeps(fullContent);
            const instructions = extractSkillInstructions(args.name, fullContent, skillMaxChars);
            return depWarning ? `${depWarning}\n\n${instructions}` : instructions;
          }
          for (const dir of skillDirList()) {
            const skillPath = path.join(dir, args.name, 'SKILL.md');
            if (fs.existsSync(skillPath)) {
              const fullContent = await fs.promises.readFile(skillPath, 'utf-8');
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

          let jsYaml: any;
          try {
            jsYaml = await import('js-yaml');
            if (jsYaml.default) jsYaml = jsYaml.default;
          } catch {
            return 'Error: 无法加载 yaml 解析器';
          }

          const metadata = jsYaml.load(fmMatch[1]);
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

  return tools;
}
