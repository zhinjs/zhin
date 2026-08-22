import { describe, expect, it } from 'vitest';
import { resolveSandboxTurnPolicy } from '../../src/plugin-runtime/sandbox-turn-policy.js';

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
        approvalMode: 'allow', networkAccess: false,
      } },
    })).toMatchObject({
      filesystem: { workspaceRoot: '/', workingDirectory: '/tmp/work', access: 'danger-full-access' },
      shell: { security: 'full', approvalMode: 'allow', isolation: 'none' },
      network: { enabled: true, httpsOnly: true, allowedDomains: [] },
    });
  });

  it('ignores execution metadata from non-sandbox or non-owner ingress', () => {
    const metadata = { sandboxAgentRun: {
      workingDirectory: '/', safetyMode: 'danger-full-access', approvalMode: 'allow', networkAccess: true,
    } };
    expect(resolveSandboxTurnPolicy({ platform: 'sandbox', isMaster: false, projectRoot: '/safe', metadata }))
      .toEqual({ filesystem: { workspaceRoot: '/safe', workingDirectory: '/safe', access: 'workspace-write' } });
    expect(resolveSandboxTurnPolicy({ platform: 'icqq', isMaster: true, projectRoot: '/safe', metadata }))
      .toEqual({ filesystem: { workspaceRoot: '/safe', workingDirectory: '/safe', access: 'workspace-write' } });
  });
});
