/**
 * bash — Shell 执行（安全检查 + 命令读写分类 + 沙箱保护）
 */
import { exec, type ExecOptions } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool, ToolContext, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import {
  checkBashCommandSafety,
  classifyBashCommand,
} from '../security/file-policy.js';
import { getSandbox } from '../security/sandbox.js';
import { errMsg } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';

const defaultExecAsync = promisify(exec);

/** 可注入以便单测（默认 `promisify(exec)`） */
export type BashExecAsync = (
  command: string,
  options?: ExecOptions,
) => Promise<{ stdout: string; stderr: string }>;

export const BASH_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'Shell 命令' },
    cwd: { type: 'string', description: '工作目录' },
    timeout: { type: 'number', description: '超时毫秒数（默认 30000）' },
  },
  required: ['command'],
};

export class BashBuiltinTool extends BuiltinBaseTool {
  readonly name = 'bash';
  readonly description =
    '执行 Shell 命令（带超时保护和命令分类）。返回结果中会标注命令类型（只读/搜索/写入）。';
  readonly parameters = BASH_PARAMETERS;
  readonly kind = 'shell';

  /** 是否使用沙箱（默认 true，测试时可设为 false） */
  private useSandbox: boolean;

  constructor(
    private readonly execAsync: BashExecAsync = defaultExecAsync,
    options?: { useSandbox?: boolean },
  ) {
    super();
    this.tags.push('shell', 'exec');
    this.keywords.push('执行', '运行', '命令', '终端', 'shell', 'bash');
    this.useSandbox = options?.useSandbox ?? true;
  }

  async run(args: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    try {
      const timeout = (args.timeout as number | undefined) ?? 30000;
      const cmd = String(args.command || '');
      const safety = checkBashCommandSafety(cmd);
      if (!safety.safe) return `Error: ${safety.reason}`;
      const classification = classifyBashCommand(cmd);
      const cwd = (args.cwd as string | undefined) || process.cwd();

      let stdout: string;
      let stderr: string;

      if (this.useSandbox) {
        // 使用沙箱执行命令
        const sandbox = getSandbox();
        const sandboxResult = await sandbox.execute(cmd, {
          cwd,
          timeout,
        });

        // 检查是否被沙箱阻止
        if (sandboxResult.blocked) {
          return `Error: 命令被沙箱阻止 - ${sandboxResult.blockReason}`;
        }

        // 检查是否超时
        if (sandboxResult.timedOut) {
          return `Error: 命令执行超时（${timeout}ms）`;
        }

        stdout = sandboxResult.stdout;
        stderr = sandboxResult.stderr;
      } else {
        // 使用传统的 exec 执行（用于测试）
        const result = await this.execAsync(cmd, {
          cwd,
          timeout,
          maxBuffer: 1024 * 1024,
        });
        stdout = result.stdout;
        stderr = result.stderr;
      }

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
  }
}

export function createBashTool(): Tool {
  return new BashBuiltinTool().toTool();
}
