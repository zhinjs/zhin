/**
 * glob — 按 glob 模式查找文件
 */
import { exec, type ExecOptions } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool, Message, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { shellEscape } from '../security/file-policy.js';
import { runToolPolicies, toolPolicyResultToMessage } from '../security/policy-facade.js';
import { errMsg } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';

const defaultExecAsync = promisify(exec);

/** 可注入以便单测（默认 `promisify(exec)`） */
export type GlobExecAsync = (
  command: string,
  options?: ExecOptions,
) => Promise<{ stdout: string; stderr: string }>;

export const GLOB_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    pattern: { type: 'string', description: 'Glob pattern (e.g. **/*.ts)' },
    cwd: { type: 'string', description: 'Working directory (default project root)' },
  },
  required: ['pattern'],
};

export class GlobBuiltinTool extends BuiltinBaseTool {
  readonly name = 'glob';
  readonly description =
    'Find file paths matching a glob pattern (e.g. **/*.ts). Use for pattern-based file lookup, not directory listing.';
  readonly parameters = GLOB_PARAMETERS;
  readonly kind = 'file';

  constructor(private readonly execAsync: GlobExecAsync = defaultExecAsync) {
    super();
    this.tags.push('file', 'search');
    this.keywords.push('glob', '查找文件', '按模式找文件', 'find', '匹配文件');
  }

  async run(args: Record<string, unknown>, commMessage?: Message): Promise<ToolResult> {
    const patternArg = args.pattern;
    if (typeof patternArg !== 'string' || !patternArg.trim()) {
      return 'Error: pattern is required';
    }
    try {
      const cwdRaw = args.cwd;
      const cwd = typeof cwdRaw === 'string' && cwdRaw.trim() ? cwdRaw : process.cwd();
      // 统一安全策略门面（与原两层手写链等价）：role-gate → sensitive-path
      const policyGate = toolPolicyResultToMessage(
        runToolPolicies({ toolName: 'glob', filePath: cwd, commMessage }),
        'glob',
      );
      if (policyGate) return policyGate;
      const safePattern = shellEscape(patternArg);
      const { stdout } = await this.execAsync(
        `find . -path ./${safePattern} -type f 2>/dev/null | head -100`,
        { cwd },
      );
      const files = stdout.trim().split('\n').filter(Boolean);
      return files.length === 0
        ? `No files matching '${patternArg}'`
        : `Found ${files.length} files:\n${files.join('\n')}`;
    } catch (e: unknown) {
      return `Error: ${errMsg(e)}`;
    }
  }
}

export function createGlobTool(): Tool {
  return new GlobBuiltinTool().toTool();
}
