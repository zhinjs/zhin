/**
 * AI 内置系统工具
 *
 * 文件工具:  read_file, write_file, edit_file, list_dir, glob, grep
 * Shell:     bash
 * 网络:      web_search, web_fetch
 * 计划:      todo_read, todo_write
 * 记忆:      read_memory, write_memory (AGENTS.md)
 * 技能:      activate_skill, install_skill
 * 交互:      ask_user（基于 Prompt 类的用户确认/提问工具）
 *
 * 发现逻辑已拆分到 discover-skills.ts / discover-agents.ts / discover-tools.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger, Prompt, type Plugin, type PropertySchema } from '@zhin.js/core';
import { ZhinTool } from '@zhin.js/core';
import {
  assertFileAccess, checkBashCommandSafety, shellEscape,
  isBlockedDevicePath, MAX_READ_FILE_SIZE, MAX_EDIT_FILE_SIZE,
  classifyBashCommand, getFileMtime, isFileStale,
} from './file-policy.js';
import {
  errMsg, expandHome, getDataDir, mergeSkillDirsWithResolver, nodeErrToFileMessage,
} from './discovery-utils.js';
import { checkSkillDeps, extractSkillInstructions } from './discover-skills.js';

const execAsync = promisify(exec);
const logger = new Logger(null, 'builtin-tools');

// ── 引号归一化 + 模糊匹配（参考 Claude Code FileEditTool/utils.ts） ──

/** 将弯引号归一化为直引号 */
function normalizeQuotes(str: string): string {
  return str
    .replace(/\u2018/g, "'")  // '
    .replace(/\u2019/g, "'")  // '
    .replace(/\u201C/g, '"')  // "
    .replace(/\u201D/g, '"'); // "
}

interface FuzzyMatchResult {
  /** 文件中实际匹配到的字符串 */
  actual: string;
  /** 匹配次数 */
  count: number;
  /** 是否通过引号归一化匹配 */
  wasNormalized: boolean;
}

/**
 * 在文件内容中查找字符串，支持精确匹配和引号归一化模糊匹配。
 * 参考 Claude Code `findActualString`。
 */
function findActualStringInFile(fileContent: string, searchString: string): FuzzyMatchResult | null {
  // 精确匹配
  const exactCount = fileContent.split(searchString).length - 1;
  if (exactCount > 0) {
    return { actual: searchString, count: exactCount, wasNormalized: false };
  }

  // 引号归一化匹配
  const normalizedSearch = normalizeQuotes(searchString);
  const normalizedFile = normalizeQuotes(fileContent);
  const idx = normalizedFile.indexOf(normalizedSearch);
  if (idx !== -1) {
    // 提取文件中实际的字符串（保留原始弯引号）
    const actual = fileContent.substring(idx, idx + searchString.length);
    const normalizedCount = normalizedFile.split(normalizedSearch).length - 1;
    return { actual, count: normalizedCount, wasNormalized: true };
  }

  return null;
}

/**
 * 将 new_string 中的直引号替换为文件中原始的弯引号风格。
 * 参考 Claude Code `preserveQuoteStyle`。
 */
function preserveQuoteStyleInEdit(oldString: string, actualOldString: string, newString: string): string {
  if (oldString === actualOldString) return newString;

  const hasDouble = actualOldString.includes('\u201C') || actualOldString.includes('\u201D');
  const hasSingle = actualOldString.includes('\u2018') || actualOldString.includes('\u2019');
  if (!hasDouble && !hasSingle) return newString;

  let result = newString;
  if (hasDouble) {
    // 简单启发式：前面是空白/行首时用左引号，否则右引号
    const chars = [...result];
    const out: string[] = [];
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === '"') {
        const prev = i > 0 ? chars[i - 1] : ' ';
        const isOpening = /[\s(\[{]/.test(prev) || i === 0;
        out.push(isOpening ? '\u201C' : '\u201D');
      } else {
        out.push(chars[i]);
      }
    }
    result = out.join('');
  }
  if (hasSingle) {
    const chars = [...result];
    const out: string[] = [];
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === "'") {
        const prev = i > 0 ? chars[i - 1] : ' ';
        const next = i < chars.length - 1 ? chars[i + 1] : ' ';
        // 两个字母之间是缩写，用右引号
        if (/\p{L}/u.test(prev) && /\p{L}/u.test(next)) {
          out.push('\u2019');
        } else {
          const isOpening = /[\s(\[{]/.test(prev) || i === 0;
          out.push(isOpening ? '\u2018' : '\u2019');
        }
      } else {
        out.push(chars[i]);
      }
    }
    result = out.join('');
  }
  return result;
}

// ── 图片格式检测（参考 Claude Code FileReadTool imageResizer） ──

/** 支持的图片扩展名 */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico',
]);

function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

// ============================================================================
// 工具工厂函数
// ============================================================================

export interface BuiltinToolsOptions {
  /** 插件实例，用于 ask_user 工具创建 Prompt 交互 */
  plugin?: Plugin;
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
  const pluginRef = options?.plugin;

  const tools: ZhinTool[] = [];

  // ── read_file（清晰描述 + 强关键词 + 图片检测 + 安全防护） ──
  tools.push(
    new ZhinTool('read_file')
      .desc('读取指定路径的文件内容。用于查看、打开或读取任意文本文件。图片文件返回 Base64 数据。')
      .keyword('读文件', '读取文件', '查看文件', '打开文件', '文件内容', 'read file', 'read', 'cat', '查看', '打开')
      .tag('file', 'read')
      .kind('file')
      .param('file_path', { type: 'string', description: '要读取的文件路径（绝对路径或相对项目根目录）' }, true)
      .param('offset', { type: 'number', description: '起始行号（0-based，可选，默认从第 1 行开始）' })
      .param('limit', { type: 'number', description: '最多读取行数（可选，默认全部）' })
      .execute(async (args) => {
        try {
          const fp = expandHome(args.file_path);
          // 设备路径拦截（参考 Claude Code BLOCKED_DEVICE_PATHS）
          if (isBlockedDevicePath(fp)) {
            return `Error: 禁止读取设备文件 ${fp}（会导致进程挂起或注入攻击）`;
          }
          assertFileAccess(fp);
          const stat = await fs.promises.stat(fp);
          // 文件大小限制（参考 Claude Code MAX_EDIT_FILE_SIZE）
          if (stat.size > MAX_READ_FILE_SIZE) {
            return `Error: 文件过大 (${(stat.size / 1024 / 1024).toFixed(1)} MiB)，超过 ${MAX_READ_FILE_SIZE / 1024 / 1024} MiB 限制。请使用 offset/limit 分段读取。`;
          }

          // 图片文件检测（参考 Claude Code FileReadTool 的图片处理）
          if (isImageFile(fp)) {
            const buffer = await fs.promises.readFile(fp);
            const ext = path.extname(fp).toLowerCase().replace('.', '');
            const mimeType = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext;
            const b64 = buffer.toString('base64');
            const sizeKb = (buffer.length / 1024).toFixed(1);
            return `[Image: ${path.basename(fp)}, ${sizeKb} KB, type: image/${mimeType}]\ndata:image/${mimeType};base64,${b64.slice(0, 200)}...(total ${b64.length} chars)`;
          }

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

  // ── edit_file（支持精确匹配 + 引号归一化模糊匹配）──
  tools.push(
    new ZhinTool('edit_file')
      .desc('在文件中查找并替换一段文本。old_string 必须在文件中精确存在且唯一；建议包含完整行或足够上下文以避免重复匹配。支持弯引号/直引号自动归一化。')
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
          // 文件大小限制
          const stat = await fs.promises.stat(fp);
          if (stat.size > MAX_EDIT_FILE_SIZE) {
            return `Error: 文件过大 (${(stat.size / 1024 / 1024).toFixed(1)} MiB)，超过 ${MAX_EDIT_FILE_SIZE / 1024 / 1024} MiB 限制。`;
          }
          // 记录 mtime 用于防并发覆写
          const mtimeBefore = stat.mtimeMs;
          const content = await fs.promises.readFile(fp, 'utf-8');

          // 精确匹配 → 引号归一化模糊匹配
          const matchResult = findActualStringInFile(content, args.old_string);
          if (!matchResult) return `Error: old_string not found in file. Make sure it matches exactly (also tried quote normalization).`;
          if (matchResult.count > 1) return `Warning: old_string appears ${matchResult.count} times. Please provide more context to make it unique.`;

          // 如果通过引号归一化匹配，保持文件的引号风格
          const effectiveNew = matchResult.wasNormalized
            ? preserveQuoteStyleInEdit(args.old_string, matchResult.actual, args.new_string)
            : args.new_string;

          const newContent = content.replace(matchResult.actual, effectiveNew);

          // 写入前再检查 mtime 防止并发修改
          const currentStat = await fs.promises.stat(fp);
          if (isFileStale(mtimeBefore, currentStat.mtimeMs)) {
            return `Error: 文件 ${fp} 在读取后被外部修改。请重新读取文件后再编辑，避免覆盖他人的修改。`;
          }
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

  // ── grep（支持上下文行、大小写、多行、ripgrep 自动检测） ──
  tools.push(
    new ZhinTool('grep')
      .desc('按正则搜索文件内容，返回匹配行和行号。优先使用 ripgrep (rg)，回退到 grep。')
      .keyword('搜索', '查找内容', 'grep', '正则', 'rg', 'ripgrep')
      .tag('search', 'regex')
      .kind('file')
      .param('pattern', { type: 'string', description: '正则表达式' }, true)
      .param('path', { type: 'string', description: '搜索路径（默认 .）' })
      .param('include', { type: 'string', description: '文件类型过滤（如 *.ts）' })
      .param('context', { type: 'number', description: '匹配行上下文行数（-C 参数）' })
      .param('before', { type: 'number', description: '匹配行之前显示行数（-B 参数）' })
      .param('after', { type: 'number', description: '匹配行之后显示行数（-A 参数）' })
      .param('ignore_case', { type: 'boolean', description: '大小写不敏感搜索（-i 参数）' } as any)
      .param('multiline', { type: 'boolean', description: '多行模式，. 匹配换行（仅 ripgrep 支持）' } as any)
      .param('limit', { type: 'number', description: '最多返回结果行数（默认 50）' })
      .execute(async (args) => {
        try {
          const searchPath = args.path || '.';
          assertFileAccess(path.resolve(process.cwd(), searchPath));
          const safePattern = shellEscape(args.pattern);
          const safePath = shellEscape(searchPath);
          const limit = args.limit ?? 50;

          // 检测 ripgrep 是否可用
          let useRipgrep = false;
          try {
            await execAsync('rg --version', { timeout: 3000 });
            useRipgrep = true;
          } catch { /* ripgrep 不可用，回退到 grep */ }

          let cmd: string;
          if (useRipgrep) {
            // ripgrep 命令构建
            const rgFlags: string[] = ['-n']; // 行号
            if (args.ignore_case) rgFlags.push('-i');
            if (args.multiline) rgFlags.push('-U', '--multiline-dotall');
            if (args.context) rgFlags.push(`-C${args.context}`);
            else {
              if (args.before) rgFlags.push(`-B${args.before}`);
              if (args.after) rgFlags.push(`-A${args.after}`);
            }
            if (args.include) rgFlags.push(`--glob=${shellEscape(args.include)}`);
            cmd = `rg ${rgFlags.join(' ')} ${safePattern} ${safePath} 2>/dev/null | head -${limit}`;
          } else {
            // 传统 grep 回退
            const grepFlags: string[] = ['-rn'];
            if (args.ignore_case) grepFlags.push('-i');
            if (args.context) grepFlags.push(`-C${args.context}`);
            else {
              if (args.before) grepFlags.push(`-B${args.before}`);
              if (args.after) grepFlags.push(`-A${args.after}`);
            }
            const includeFlag = args.include ? `--include=${shellEscape(args.include)}` : '';
            cmd = `grep ${grepFlags.join(' ')} ${includeFlag} ${safePattern} ${safePath} 2>/dev/null | head -${limit}`;
          }

          const { stdout } = await execAsync(cmd, { cwd: process.cwd() });
          const engine = useRipgrep ? '(ripgrep)' : '(grep)';
          return stdout.trim()
            ? `${engine}\n${stdout.trim()}`
            : `No matches for '${args.pattern}' ${engine}`;
        } catch (e: unknown) {
          const err = e as { code?: number; message?: string };
          if (err.code === 1) return `No matches for '${args.pattern}'`;
          return `Error: ${errMsg(e)}`;
        }
      }),
  );

  // ── bash（安全检查 + 命令读写分类） ──
  tools.push(
    new ZhinTool('bash')
      .desc('执行 Shell 命令（带超时保护和命令分类）。返回结果中会标注命令类型（只读/搜索/写入）。')
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
          // 命令读写分类
          const classification = classifyBashCommand(cmd);
          const { stdout, stderr } = await execAsync(cmd, {
            cwd: args.cwd || process.cwd(),
            timeout,
            maxBuffer: 1024 * 1024,
          });
          let result = '';
          const tag = classification.isReadOnly
            ? (classification.isSearch ? '[搜索]' : classification.isList ? '[列出]' : '[只读]')
            : '[执行]';
          if (stdout.trim()) result += `STDOUT:\n${stdout.trim()}`;
          if (stderr.trim()) result += `${result ? '\n' : ''}STDERR:\n${stderr.trim()}`;
          return `${tag} ${result || '(no output)'}`;
        } catch (e: unknown) {
          const err = e as { code?: number; message?: string; stdout?: string; stderr?: string };
          return `Error (exit ${err.code || '?'}): ${errMsg(e)}\nSTDOUT:\n${err.stdout || ''}\nSTDERR:\n${err.stderr || ''}`;
        }
      }),
  );

  // ── web_search（搜索网页，返回标题、URL、摘要 + 域名过滤 + 次数限制） ──
  let searchCount = 0;
  const MAX_SEARCH_COUNT = 20; // 单次会话搜索次数上限
  tools.push(
    new ZhinTool('web_search')
      .desc('在互联网上搜索，返回匹配的标题、URL 和摘要片段。用于查资料、找网页。支持域名过滤。')
      .keyword('搜索', '网上搜', '网页搜索', '搜索引擎', 'search', 'google', '百度', '查询', '搜一下')
      .tag('web', 'search')
      .kind('web')
      .param('query', { type: 'string', description: '搜索关键词或完整查询语句' }, true)
      .param('limit', { type: 'number', description: '返回结果数量（默认 5，建议 1–10）' })
      .param('allowed_domains', { type: 'array', description: '仅保留这些域名的结果（可选，如 ["github.com", "stackoverflow.com"]）' } as any)
      .param('blocked_domains', { type: 'array', description: '排除这些域名的结果（可选）' } as any)
      .execute(async (args) => {
        try {
          // 搜索次数限制
          searchCount++;
          if (searchCount > MAX_SEARCH_COUNT) {
            return `Error: 搜索次数已达上限 (${MAX_SEARCH_COUNT})。请使用已获取的信息回答。`;
          }

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

          // 域名过滤
          let filtered = results;
          if (args.allowed_domains?.length) {
            const allowed = new Set((args.allowed_domains as string[]).map(d => d.toLowerCase()));
            filtered = filtered.filter(r => {
              try { return allowed.has(new URL(r.url).hostname.toLowerCase()); } catch { return false; }
            });
          }
          if (args.blocked_domains?.length) {
            const blocked = new Set((args.blocked_domains as string[]).map(d => d.toLowerCase()));
            filtered = filtered.filter(r => {
              try { return !blocked.has(new URL(r.url).hostname.toLowerCase()); } catch { return true; }
            });
          }

          if (filtered.length === 0) return 'No results found.';
          return `(${searchCount}/${MAX_SEARCH_COUNT} searches)\n` + filtered.map((r, i) =>
            `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`,
          ).join('\n\n');
        } catch (e: unknown) {
          return `Error: ${errMsg(e)}`;
        }
      }),
  );

  // ── web_fetch（抓取 URL 并提取正文 + SSRF 防护 + 改进的内容提取） ──
  tools.push(
    new ZhinTool('web_fetch')
      .desc('抓取指定 URL 的网页内容并提取正文（去除广告、脚本等），返回可读文本。仅支持 http/https 协议。')
      .keyword('抓取网页', '打开链接', '获取网页', '读网页', 'fetch', 'url', '链接内容', '网页内容')
      .tag('web', 'fetch')
      .kind('web')
      .param('url', { type: 'string', description: '要抓取的完整 URL（需 http 或 https）' }, true)
      .param('max_length', { type: 'number', description: '最大返回字符数（默认 20480）' })
      .execute(async (args) => {
        try {
          // SSRF 防护：仅允许 http/https 协议
          let parsedUrl: URL;
          try {
            parsedUrl = new URL(args.url);
          } catch {
            return `Error: 无效的 URL 格式`;
          }
          if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            return `Error: 仅支持 http/https 协议，拒绝 ${parsedUrl.protocol}`;
          }
          // 阻止内网地址（SSRF 关键防护）
          const hostname = parsedUrl.hostname.toLowerCase();
          if (
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '::1' ||
            hostname === '0.0.0.0' ||
            hostname.endsWith('.local') ||
            hostname.startsWith('10.') ||
            hostname.startsWith('192.168.') ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
          ) {
            return `Error: 禁止访问内网地址 ${hostname}（SSRF 防护）`;
          }

          const response = await fetch(args.url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZhinBot/1.0)' },
            signal: AbortSignal.timeout(15000),
            redirect: 'follow',
          });
          if (!response.ok) return `HTTP ${response.status}: ${response.statusText}`;
          const html = await response.text();
          // 改进的内容提取：去除脚本、样式、导航、页脚、表单等
          const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
            .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
          const maxLen = args.max_length ?? 20 * 1024;
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

  // ── ask_user（基于 Prompt 类的用户确认/提问工具） ──
  tools.push(
    new ZhinTool('ask_user')
      .desc('向用户发送问题，等待用户在聊天中回复。用于需要用户确认、补充信息或做出选择时。支持文本输入、数字输入、是/否确认、选项选择。')
      .keyword('询问', '确认', '提问', '用户输入', 'ask', 'confirm', 'prompt', '选择', '请问')
      .tag('interaction', 'prompt')
      .kind('interaction')
      .param('question', { type: 'string', description: '要向用户提出的问题文本' }, true)
      .param('type', { type: 'string', description: '问题类型: text(文本输入)、number(数字输入)、confirm(是/否确认)、pick(选项选择)。默认 text' })
      .param('options', { type: 'array', description: '选项列表（type=pick 时必填），每项为字符串，如 ["选项A","选项B","选项C"]' })
      .param('default_value', { type: 'string', description: '用户超时未回复时使用的默认值' })
      .param('timeout', { type: 'number', description: '等待用户回复的超时时间（秒），默认 120' })
      .execute(async (args, context) => {
        // 无消息上下文时无法使用（如子任务场景）
        if (!context?.message) {
          return 'Error: 当前上下文没有消息来源，无法向用户提问。请改为在回复中直接询问。';
        }
        if (!pluginRef) {
          return 'Error: 插件实例不可用，无法创建交互式提问。请改为在回复中直接询问。';
        }

        const prompt = new Prompt(pluginRef, context.message);
        const timeoutMs = (args.timeout ?? 120) * 1000;
        const questionType = args.type || 'text';

        try {
          switch (questionType) {
            case 'number': {
              const defaultNum = args.default_value != null ? Number(args.default_value) : undefined;
              const result = await prompt.number(args.question, timeoutMs, defaultNum, '输入超时，已取消');
              return String(result);
            }
            case 'confirm': {
              const result = await prompt.confirm(args.question, 'yes', timeoutMs, false, '确认超时，已取消');
              return result ? 'yes' : 'no';
            }
            case 'pick': {
              if (!args.options?.length) {
                return 'Error: type=pick 时必须提供 options 选项列表';
              }
              const pickOptions = (args.options as string[]).map((o: string) => ({ label: o, value: o }));
              const result = await prompt.pick(args.question, {
                type: 'text' as const,
                options: pickOptions,
                timeout: timeoutMs,
              }, '选择超时，已取消');
              return String(result);
            }
            case 'text':
            default: {
              const result = await prompt.text(args.question, timeoutMs, args.default_value || '', '输入超时，已取消');
              return result;
            }
          }
        } catch (e: unknown) {
          return `用户未响应或输入错误: ${errMsg(e)}`;
        }
      }),
  );

  return tools;
}
