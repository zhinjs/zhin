import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '@zhin.js/tool';
import {
  NativeBashToolFeature,
  SandboxBashExecutionPort,
  turnPolicyAllowsShell,
  withoutForbiddenShell,
  type BashExecutionPort,
} from '../../src/plugin-runtime/native-bash-tool.js';

describe('native bash ToolFeature', () => {
  it('publishes one canonical ToolFeature and delegates the authorized Turn policy', async () => {
    const execute = vi.fn<BashExecutionPort['execute']>(async () => ({
      stdout: 'hello\n',
      stderr: '',
    }));
    const feature = new NativeBashToolFeature({ execute });
    const context = executionContext();

    await expect(feature.definition.execute(
      { command: 'echo hello', cwd: '/workspace/project', timeout: 5_000 },
      context,
    )).resolves.toContain('STDOUT:\nhello');
    expect(feature.name).toBe('bash');
    expect(feature.definition.requiresApproval).toBe('on-risk');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      command: 'echo hello',
      cwd: '/workspace/project',
      timeoutMs: 5_000,
      policy: context.policy,
      signal: context.signal,
    }));
  });

  it('propagates command failures to the canonical Turn audit path', async () => {
    const execute = vi.fn<BashExecutionPort['execute']>(async () => {
      throw Object.assign(new Error('failed'), {
        code: 2,
        stdout: 'partial-out',
        stderr: 'partial-err',
      });
    });
    const feature = new NativeBashToolFeature({ execute });

    await expect(feature.definition.execute({ command: 'echo hello' }, executionContext()))
      .rejects.toThrow('failed');
  });

  it('fails closed when the Turn has no explicit filesystem and isolation authority', async () => {
    const execution = new SandboxBashExecutionPort();
    await expect(execution.execute({
      command: 'pwd',
      cwd: '/tmp',
      timeoutMs: 100,
      signal: new AbortController().signal,
      policy: {
        permissions: [],
        unattended: false,
        network: { enabled: false },
      },
    })).rejects.toThrow('Do not retry bash');
  });

  it('uses the policy working directory when cwd is omitted', async () => {
    const execute = vi.fn<BashExecutionPort['execute']>(async () => ({ stdout: '', stderr: '' }));
    const feature = new NativeBashToolFeature({ execute });
    await feature.definition.execute({ command: 'pwd' }, executionContext());
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/workspace/project' }));
  });
});

function executionContext(): ToolExecutionContext {
  return {
    signal: new AbortController().signal,
    traceId: 'trace',
    turnId: 'turn',
    sessionKey: 'session',
    origin: { kind: 'internal', source: 'test' },
    principal: { subjectId: 'owner', roles: ['master'] },
    policy: {
      permissions: ['master'],
      unattended: false,
      network: { enabled: false },
      shell: { security: 'full', approvalMode: 'bypass', isolation: 'required' },
      filesystem: {
        workspaceRoot: '/workspace',
        workingDirectory: '/workspace/project',
        access: 'workspace-write',
      },
    },
  } as ToolExecutionContext;
}

describe('Turn shell policy gate', () => {
  const workspace = { workspaceRoot: '/workspace/project' };

  it('allows only isolated shells over bounded files or explicit full access', () => {
    expect(turnPolicyAllowsShell({
      filesystem: { ...workspace, access: 'workspace-write' },
      shell: { isolation: 'required', security: 'allowlist' },
    })).toBe(true);
    expect(turnPolicyAllowsShell({
      filesystem: { ...workspace, access: 'danger-full-access' },
      shell: { isolation: 'none', security: 'full' },
    })).toBe(true);
  });

  it('rejects missing, denied or mismatched shell policy', () => {
    expect(turnPolicyAllowsShell(undefined)).toBe(false);
    // The IM default before this fix: workspace-write files but no shell policy.
    expect(turnPolicyAllowsShell({ filesystem: { ...workspace, access: 'workspace-write' } })).toBe(false);
    expect(turnPolicyAllowsShell({
      filesystem: { ...workspace, access: 'workspace-write' },
      shell: { isolation: 'none' },
    })).toBe(false);
    expect(turnPolicyAllowsShell({
      filesystem: { ...workspace, access: 'workspace-write' },
      shell: { isolation: 'required', security: 'deny' },
    })).toBe(false);
  });

  it('hides bash from tools and catalog when the policy cannot run it', () => {
    const tools = [{ name: 'read_file' }, { name: 'bash' }];

    expect(withoutForbiddenShell({ filesystem: { ...workspace, access: 'workspace-write' } }, tools))
      .toEqual([{ name: 'read_file' }]);
    expect(withoutForbiddenShell({
      filesystem: { ...workspace, access: 'workspace-write' },
      shell: { isolation: 'required' },
    }, tools)).toEqual(tools);
  });

  it('runs through the execution port when the policy allows it', async () => {
    const execute = vi.fn<BashExecutionPort['execute']>(async () => ({ stdout: 'ok', stderr: '' }));
    const feature = new NativeBashToolFeature({ execute });
    const context = {
      ...executionContext(),
      policy: {
        permissions: [],
        unattended: false,
        network: { enabled: false },
        filesystem: { ...workspace, access: 'workspace-write' as const },
        shell: { isolation: 'required' as const, security: 'allowlist' as const },
      },
    };

    await expect(feature.definition.execute({ command: 'pnpm build' }, context)).resolves.toContain('ok');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
