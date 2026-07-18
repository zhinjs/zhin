/**
 * bash — Shell 执行（安全检查 + 命令读写分类 + 沙箱保护 + 文件角色权限）
 */
import { exec, type ExecOptions } from 'node:child_process';
import { promisify } from 'node:util';
import { type Plugin, type Tool, type Message, type ToolParametersSchema, type ToolResult } from '@zhin.js/core';
import {
  classifyBashCommand,
} from '../security/file-policy.js';
import { runToolPolicies, toolPolicyResultToMessage } from '../security/policy-facade.js';
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
    command: { type: 'string', description: 'Shell command to execute' },
    cwd: { type: 'string', description: 'Working directory' },
    timeout: { type: 'number', description: 'Timeout in milliseconds (default 30000)' },
  },
  required: ['command'],
};

export class BashBuiltinTool extends BuiltinBaseTool {
  readonly name = 'bash';
  readonly description =
    'Execute a shell command with timeout protection and command classification. Output notes whether the command is read-only, search, or write.';
  readonly parameters = BASH_PARAMETERS;
  readonly kind = 'shell';

  /** 是否使用沙箱（默认 true，测试时可设为 false） */
  private useSandbox: boolean;
  private readonly hostPlugin?: Plugin;

  constructor(
    private readonly execAsync: BashExecAsync = defaultExecAsync,
    options?: { useSandbox?: boolean; plugin?: Plugin },
  ) {
    super();
    this.tags.push('shell', 'exec');
    this.keywords.push('执行', '运行', '命令', '终端', 'shell', 'bash');
    this.useSandbox = options?.useSandbox ?? true;
    this.hostPlugin = options?.plugin?.root ?? options?.plugin;
  }

  async run(args: Record<string, unknown>, commMessage?: Message): Promise<ToolResult> {
    try {
      const cmd = String(args.command || '');
      if (!cmd.trim()) return 'Error: command is required';

      // 统一安全策略门面（与原三层手写链等价；不传 config，exec-policy 层不激活）：
      // bash-command-safety → bash-sensitive-read → bash-file-permission
      const policyGate = toolPolicyResultToMessage(
        runToolPolicies({ toolName: 'bash', command: cmd, commMessage, hostPlugin: this.hostPlugin }),
        'bash',
      );
      if (policyGate) return policyGate;

      const timeout = (args.timeout as number | undefined) ?? 30000;
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

export function createBashTool(plugin?: Plugin): Tool {
  return new BashBuiltinTool(undefined, { plugin }).toTool();
}
