/**
 * glob — 按 glob 模式查找文件
 */
import { exec, type ExecOptions } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool, Message, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { shellEscape } from '../security/file-policy.js';
import { checkFileToolAccess, checkSensitiveFilePathAccess, toDenyError, toOwnerSignal } from '../security/dangerous-tool-policy.js';
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
    pattern: { type: 'string', description: 'Glob 模式（如 **/*.ts）' },
    cwd: { type: 'string', description: '工作目录（默认项目根目录）' },
  },
  required: ['pattern'],
};

export class GlobBuiltinTool extends BuiltinBaseTool {
  readonly name = 'glob';
  readonly description =
    '按 glob 模式查找匹配的文件路径（如 **/*.ts）。用于按模式找文件，而非列出目录。';
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
      const roleDecision = checkFileToolAccess('glob', commMessage);
      if (!roleDecision.allowed) {
        if (roleDecision.needsOwnerApproval) return toOwnerSignal(roleDecision);
        return toDenyError(roleDecision);
      }
      const sensitiveDecision = checkSensitiveFilePathAccess('glob', cwd, commMessage);
      if (!sensitiveDecision.allowed) {
        if (sensitiveDecision.needsOwnerApproval) return toOwnerSignal(sensitiveDecision);
        return toDenyError(sensitiveDecision);
      }
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
