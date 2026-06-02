/**
 * grep — 按正则搜索文件内容（ripgrep 优先，grep 回退）
 */
import { exec, type ExecOptions } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { shellEscape } from '../security/file-policy.js';
import { checkFileToolAccess, checkSensitiveFilePathAccess, toDenyError, toOwnerSignal } from '../security/dangerous-tool-policy.js';
import { errMsg } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';

const defaultExecAsync = promisify(exec);

/** 可注入以便单测（默认 `promisify(exec)`） */
export type GrepExecAsync = (
  command: string,
  options?: ExecOptions,
) => Promise<{ stdout: string; stderr: string }>;

export const GREP_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    pattern: { type: 'string', description: '正则表达式' },
    path: { type: 'string', description: '搜索路径（默认 .）' },
    include: { type: 'string', description: '文件类型过滤（如 *.ts）' },
    context: { type: 'number', description: '匹配行上下文行数（-C 参数）' },
    before: { type: 'number', description: '匹配行之前显示行数（-B 参数）' },
    after: { type: 'number', description: '匹配行之后显示行数（-A 参数）' },
    ignore_case: { type: 'boolean', description: '大小写不敏感搜索（-i 参数）' },
    multiline: { type: 'boolean', description: '多行模式，. 匹配换行（仅 ripgrep 支持）' },
    limit: { type: 'number', description: '最多返回结果行数（默认 50）' },
  },
  required: ['pattern'],
};

export class GrepBuiltinTool extends BuiltinBaseTool {
  readonly name = 'grep';
  readonly description =
    '按正则搜索文件内容，返回匹配行和行号。优先使用 ripgrep (rg)，回退到 grep。';
  readonly parameters = GREP_PARAMETERS;
  readonly kind = 'file';

  constructor(private readonly execAsync: GrepExecAsync = defaultExecAsync) {
    super();
    this.tags.push('search', 'regex');
    this.keywords.push('搜索', '查找内容', 'grep', '正则', 'rg', 'ripgrep');
  }

  async run(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const patternArg = args.pattern;
    if (typeof patternArg !== 'string' || !patternArg.trim()) {
      return 'Error: pattern is required';
    }
    try {
      const searchPath = typeof args.path === 'string' && args.path.trim() ? args.path : '.';
      const roleDecision = checkFileToolAccess('grep', context);
      if (!roleDecision.allowed) {
        if (roleDecision.needsOwnerApproval) return toOwnerSignal(roleDecision);
        return toDenyError(roleDecision);
      }
      const absSearchPath = path.resolve(process.cwd(), searchPath);
      const sensitiveDecision = checkSensitiveFilePathAccess('grep', absSearchPath, context);
      if (!sensitiveDecision.allowed) {
        if (sensitiveDecision.needsOwnerApproval) return toOwnerSignal(sensitiveDecision);
        return toDenyError(sensitiveDecision);
      }
      const safePattern = shellEscape(patternArg);
      const safePath = shellEscape(searchPath);
      const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : 50;

      let useRipgrep = false;
      try {
        await this.execAsync('rg --version', { timeout: 3000 });
        useRipgrep = true;
      } catch {
        /* ripgrep 不可用，回退到 grep */
      }

      let cmd: string;
      if (useRipgrep) {
        const rgFlags: string[] = ['-n'];
        if (args.ignore_case === true) rgFlags.push('-i');
        if (args.multiline === true) rgFlags.push('-U', '--multiline-dotall');
        if (typeof args.context === 'number' && Number.isFinite(args.context)) {
          rgFlags.push(`-C${args.context}`);
        } else {
          if (typeof args.before === 'number' && Number.isFinite(args.before)) {
            rgFlags.push(`-B${args.before}`);
          }
          if (typeof args.after === 'number' && Number.isFinite(args.after)) {
            rgFlags.push(`-A${args.after}`);
          }
        }
        if (typeof args.include === 'string' && args.include.trim()) {
          rgFlags.push(`--glob=${shellEscape(args.include)}`);
        }
        cmd = `rg ${rgFlags.join(' ')} ${safePattern} ${safePath} 2>/dev/null | head -${limit}`;
      } else {
        const grepFlags: string[] = ['-rn'];
        if (args.ignore_case === true) grepFlags.push('-i');
        if (typeof args.context === 'number' && Number.isFinite(args.context)) {
          grepFlags.push(`-C${args.context}`);
        } else {
          if (typeof args.before === 'number' && Number.isFinite(args.before)) {
            grepFlags.push(`-B${args.before}`);
          }
          if (typeof args.after === 'number' && Number.isFinite(args.after)) {
            grepFlags.push(`-A${args.after}`);
          }
        }
        const includeFlag =
          typeof args.include === 'string' && args.include.trim()
            ? `--include=${shellEscape(args.include)}`
            : '';
        cmd = `grep ${grepFlags.join(' ')} ${includeFlag} ${safePattern} ${safePath} 2>/dev/null | head -${limit}`;
      }

      const { stdout } = await this.execAsync(cmd, { cwd: process.cwd() });
      const engine = useRipgrep ? '(ripgrep)' : '(grep)';
      return stdout.trim()
        ? `${engine}\n${stdout.trim()}`
        : `No matches for '${patternArg}' ${engine}`;
    } catch (e: unknown) {
      const err = e as { code?: number | string; message?: string };
      // rg/grep：无匹配时常为 exit code 1；Node 也可能以 number 或 string 形式携带
      if (Number(err.code) === 1) return `No matches for '${patternArg}'`;
      return `Error: ${errMsg(e)}`;
    }
  }
}

export function createGrepTool(): Tool {
  return new GrepBuiltinTool().toTool();
}
