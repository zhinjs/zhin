import {
  defineAgentTool,
  toolFeatureId,
  type AgentToolDefinition,
  type ToolExecutionContext,
  type ToolInvocationPolicy,
} from '@zhin.js/tool';
import { classifyBashCommand } from '../security/file-policy.js';
import { getSandbox, Sandbox } from '../security/sandbox.js';

export interface BashExecutionRequest {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly policy: ToolInvocationPolicy;
}

export interface BashExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly blocked?: boolean;
  readonly blockReason?: string;
  readonly timedOut?: boolean;
}

export interface BashExecutionPort {
  execute(request: BashExecutionRequest): Promise<BashExecutionResult>;
}

/** Executes one policy-authorized command using the exact Turn isolation boundary. */
export class SandboxBashExecutionPort implements BashExecutionPort {
  async execute(request: BashExecutionRequest): Promise<BashExecutionResult> {
    request.signal.throwIfAborted();
    const filesystem = request.policy.filesystem;
    const access = filesystem?.access;
    const isolation = request.policy.shell?.isolation;
    const isolated = isolation === 'required'
      && (access === 'read-only' || access === 'workspace-write');
    const unrestricted = isolation === 'none' && access === 'danger-full-access';
    if (!filesystem?.workspaceRoot || (!isolated && !unrestricted)) {
      throw new Error('Bash execution requires an explicit Turn filesystem and isolation policy');
    }

    const sandbox = unrestricted
      ? new Sandbox({ ...getSandbox().getConfig(), enabled: false })
      : new Sandbox({
          ...getSandbox().getConfig(),
          enabled: true,
          workingDirectory: filesystem.workingDirectory ?? filesystem.workspaceRoot,
          enableNetwork: request.policy.network.enabled,
          filesystemAccess: access === 'read-only' ? 'read-only' : 'workspace-write',
          useDocker: 'always',
        });
    const result = await sandbox.execute(request.command, {
      cwd: request.cwd,
      timeout: request.timeoutMs,
    });
    request.signal.throwIfAborted();
    return result;
  }
}

/** Native generation ToolFeature for shell execution. */
export class NativeBashToolFeature {
  readonly feature = toolFeatureId;
  readonly name = 'bash';
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>;
  readonly #execution: BashExecutionPort;

  constructor(execution: BashExecutionPort = new SandboxBashExecutionPort()) {
    this.#execution = execution;
    this.definition = defineAgentTool({
      description: 'Execute a shell command with Turn-scoped filesystem, network, approval, and isolation policy.',
      inputSchema: Object.freeze({
        type: 'object',
        properties: Object.freeze({
          command: Object.freeze({ type: 'string', description: 'Shell command to execute' }),
          cwd: Object.freeze({ type: 'string', description: 'Working directory inside the authorized workspace' }),
          timeout: Object.freeze({ type: 'number', description: 'Timeout in milliseconds' }),
        }),
        required: Object.freeze(['command']),
      }),
      approval: 'on-risk',
      execute: (input, context) => this.execute(input, context),
    });
  }

  private async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<string> {
    const command = requiredString(input.command, 'command');
    const filesystem = context.policy.filesystem;
    const cwd = optionalString(input.cwd)
      ?? filesystem?.workingDirectory
      ?? filesystem?.workspaceRoot;
    if (!cwd) throw new Error('Bash execution requires an authorized working directory');
    const timeoutMs = positiveInteger(input.timeout, 30_000);
    const result = await this.#execution.execute({
      command,
      cwd,
      timeoutMs,
      signal: context.signal,
      policy: context.policy,
    });
    if (result.blocked) {
      throw new Error(`Command blocked by sandbox: ${result.blockReason ?? 'unknown reason'}`);
    }
    if (result.timedOut) throw new Error(`Command timed out after ${timeoutMs}ms`);
    return formatOutput(command, result);
  }
}

function formatOutput(command: string, result: BashExecutionResult): string {
  const classification = classifyBashCommand(command);
  const tag = classification.isReadOnly
    ? (classification.isSearch ? '[搜索]' : classification.isList ? '[列出]' : '[只读]')
    : '[执行]';
  const output = [
    result.stdout.trim() ? `STDOUT:\n${result.stdout.trim()}` : '',
    result.stderr.trim() ? `STDERR:\n${result.stderr.trim()}` : '',
  ].filter(Boolean).join('\n');
  return `${tag} ${output || '(no output)'}`;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
