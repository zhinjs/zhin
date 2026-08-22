import { describe, expect, it } from 'vitest';
import { normalizeSandboxAgentRunConfig } from '../src/run-config.js';

describe('sandbox agent run config', () => {
  it('normalizes a codex-style run policy from the wire', () => {
    expect(normalizeSandboxAgentRunConfig({
      workingDirectory: ' /workspace/app ',
      safetyMode: 'read-only',
      approvalMode: 'deny',
      networkAccess: true,
    })).toEqual({
      workingDirectory: '/workspace/app',
      safetyMode: 'read-only',
      approvalMode: 'deny',
      networkAccess: true,
    });
  });

  it('uses safe defaults for unknown policy values', () => {
    expect(normalizeSandboxAgentRunConfig({ safetyMode: 'root', approvalMode: 'yolo' }))
      .toMatchObject({ safetyMode: 'workspace-write', approvalMode: 'ask', networkAccess: false });
  });

  it('makes danger-full-access explicitly include network authority', () => {
    expect(normalizeSandboxAgentRunConfig({
      safetyMode: 'danger-full-access', approvalMode: 'allow', networkAccess: false,
    })).toMatchObject({ safetyMode: 'danger-full-access', networkAccess: true });
  });
});
