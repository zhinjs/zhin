/**
 * grep — 按正则搜索文件内容（ripgrep 优先，grep 回退）
 */
import { exec, type ExecOptions } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import type { Tool, Message, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { shellEscape, buildSensitiveSearchExcludeGlobs } from '../security/file-policy.js';
import { runToolPolicies, toolPolicyResultToMessage } from '../security/policy-facade.js';
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
    pattern: { type: 'string', description: 'Regular expression pattern' },
    path: { type: 'string', description: 'Search path (default .)' },
    include: { type: 'string', description: 'File glob filter (e.g. *.ts)' },
    context: { type: 'number', description: 'Context lines around each match (-C)' },
    before: { type: 'number', description: 'Lines before each match (-B)' },
    after: { type: 'number', description: 'Lines after each match (-A)' },
    ignore_case: { type: 'boolean', description: 'Case-insensitive search (-i)' },
    multiline: { type: 'boolean', description: 'Multiline mode: . matches newlines (ripgrep only)' },
    limit: { type: 'number', description: 'Max result lines to return (default 50)' },
  },
  required: ['pattern'],
};

export class GrepBuiltinTool extends BuiltinBaseTool {
  readonly name = 'grep';
  readonly description =
    'Search file contents by regex; returns matching lines with line numbers. Prefers ripgrep (rg), falls back to grep.';
  readonly parameters = GREP_PARAMETERS;
  readonly kind = 'file';

  constructor(private readonly execAsync: GrepExecAsync = defaultExecAsync) {
    super();
    this.tags.push('search', 'regex');
    this.keywords.push('搜索', '查找内容', 'grep', '正则', 'rg', 'ripgrep');
  }

  async run(args: Record<string, unknown>, commMessage?: Message): Promise<ToolResult> {
    const patternArg = args.pattern;
    if (typeof patternArg !== 'string' || !patternArg.trim()) {
      return 'Error: pattern is required';
    }
    try {
      const searchPath = typeof args.path === 'string' && args.path.trim() ? args.path : '.';
      const absSearchPath = path.resolve(process.cwd(), searchPath);
      // 统一安全策略门面（与原两层手写链等价）：role-gate → sensitive-path
      const policyGate = toolPolicyResultToMessage(
        runToolPolicies({ toolName: 'grep', filePath: absSearchPath, commMessage }),
        'grep',
      );
      if (policyGate) return policyGate;
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
        for (const exclude of buildSensitiveSearchExcludeGlobs()) {
          rgFlags.push(`--glob=${shellEscape(exclude)}`);
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
