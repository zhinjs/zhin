import { describe, expect, it } from 'vitest';
import { resolveSandboxTurnPolicy } from '../../../../src/plugin-runtime/agent/turn/sandbox-policy.js';

describe('sandbox per-session Turn policy', () => {
  it('maps workspace-write into a bounded workspace and interactive shell policy', () => {
    expect(resolveSandboxTurnPolicy({
      platform: 'sandbox',
      isMaster: true,
      projectRoot: '/projects/zhin',
      metadata: { sandboxAgentRun: {
        workingDirectory: '../console',
        safetyMode: 'workspace-write',
        approvalMode: 'ask',
        networkAccess: true,
      } },
    })).toEqual({
      filesystem: {
        workspaceRoot: '/projects/console',
        workingDirectory: '/projects/console',
        access: 'workspace-write',
      },
      shell: { security: 'allowlist', execPreset: 'development', approvalMode: 'ask', isolation: 'required' },
      network: { enabled: true, httpsOnly: true, allowedDomains: [] },
    });
  });

  it('uses the filesystem root only for explicit danger-full-access', () => {
    expect(resolveSandboxTurnPolicy({
      platform: 'sandbox', isMaster: true, projectRoot: '/projects/zhin',
      metadata: { sandboxAgentRun: {
        workingDirectory: '/tmp/work', safetyMode: 'danger-full-access',
        approvalMode: 'bypass', networkAccess: false,
      } },
    })).toMatchObject({
      filesystem: { workspaceRoot: '/', workingDirectory: '/tmp/work', access: 'danger-full-access' },
      shell: { security: 'full', approvalMode: 'bypass', isolation: 'none' },
      network: { enabled: true, httpsOnly: true, allowedDomains: [] },
    });
  });

  it('ignores execution metadata from non-sandbox or non-owner ingress', () => {
    const metadata = { sandboxAgentRun: {
      workingDirectory: '/', safetyMode: 'danger-full-access', approvalMode: 'bypass', networkAccess: true,
    } };
    expect(resolveSandboxTurnPolicy({ platform: 'sandbox', isMaster: false, projectRoot: '/safe', metadata }))
      .toEqual({ filesystem: { workspaceRoot: '/safe', workingDirectory: '/safe', access: 'workspace-write' } });
    expect(resolveSandboxTurnPolicy({ platform: 'icqq', isMaster: true, projectRoot: '/safe', metadata }))
      .toEqual({ filesystem: { workspaceRoot: '/safe', workingDirectory: '/safe', access: 'workspace-write' } });
  });

  describe('IM master shell opt-in (ai.agent.masterShell)', () => {
    const base = { platform: 'icqq', projectRoot: '/projects/bot', metadata: {} } as const;

    it('keeps bash disabled by default', () => {
      expect(resolveSandboxTurnPolicy({ ...base, isMaster: true, scope: 'private' }).shell).toBeUndefined();
    });

    it('grants an isolated shell to the master in a private chat when opted in', () => {
      expect(resolveSandboxTurnPolicy({ ...base, isMaster: true, scope: 'private', masterShell: 'isolated' }))
        .toEqual({
          filesystem: { workspaceRoot: '/projects/bot', workingDirectory: '/projects/bot', access: 'workspace-write' },
          shell: { security: 'allowlist', execPreset: 'development', approvalMode: 'ask', isolation: 'required' },
        });
    });

    it('asks the master by default instead of forcing auto over execApprovalMode', () => {
      const shell = (extra: Record<string, unknown>) => resolveSandboxTurnPolicy({
        ...base, isMaster: true, scope: 'private', masterShell: 'isolated', ...extra,
      }).shell?.approvalMode;
      expect(shell({ execApprovalMode: 'auto' })).toBe('ask');
      expect(shell({ masterShellApprovalMode: 'ask', execApprovalMode: 'bypass' })).toBe('ask');
      expect(shell({ masterShellApprovalMode: 'auto', execApprovalMode: 'ask' })).toBe('auto');
      expect(shell({ masterShellApprovalMode: 'inherit', execApprovalMode: 'ask' })).toBe('ask');
      expect(shell({ masterShellApprovalMode: 'inherit', execApprovalMode: 'bypass' })).toBe('bypass');
      expect(shell({ masterShellApprovalMode: 'inherit' })).toBe('auto');
    });

    it('never grants it in groups or to non-masters', () => {
      expect(resolveSandboxTurnPolicy({ ...base, isMaster: true, scope: 'group', masterShell: 'isolated' }).shell)
        .toBeUndefined();
      expect(resolveSandboxTurnPolicy({ ...base, isMaster: false, scope: 'private', masterShell: 'isolated' }).shell)
        .toBeUndefined();
    });
  });
});

