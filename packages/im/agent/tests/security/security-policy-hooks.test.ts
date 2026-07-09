import { describe, it, expect } from 'vitest';
import { HookRegistry } from '../../src/orchestrator/index.js';
import { createExecPolicyHook } from '../../src/security/exec-policy-hook.js';
import { createFilePolicyHook } from '../../src/security/file-policy-hook.js';
import { createDangerousToolPolicyHook } from '../../src/security/dangerous-tool-policy-hook.js';
import { DEFAULT_CONFIG } from '../../src/config/index.js';
import type { PreToolUseEvent } from '../../src/orchestrator/types.js';

function makeEvent(overrides: Partial<PreToolUseEvent> = {}): PreToolUseEvent {
  return {
    type: 'preToolUse',
    toolName: 'bash',
    toolInput: { command: 'ls' },
    sessionId: 'test-session',
    ...overrides,
  };
}

const testConfig = {
  ...DEFAULT_CONFIG,
  execSecurity: 'allowlist',
  execPreset: 'development',
  execApprovalMode: 'deny',
} as Required<typeof DEFAULT_CONFIG>;

describe('exec-policy-hook', () => {
  it('allows allowlisted commands', () => {
    const hook = createExecPolicyHook(testConfig);
    const result = hook.handler(makeEvent({ toolInput: { command: 'ls -la' } }));
    expect(result).toEqual({ decision: 'allow' });
  });

  it('denies dangerous commands', () => {
    const hook = createExecPolicyHook(testConfig);
    const result = hook.handler(makeEvent({ toolInput: { command: 'sudo rm -rf /' } }));
    expect(result).toMatchObject({ decision: 'deny' });
  });

  it('denies non-allowlisted commands', () => {
    const hook = createExecPolicyHook(testConfig);
    const result = hook.handler(makeEvent({ toolInput: { command: 'docker run malicious' } }));
    expect(result).toMatchObject({ decision: 'deny' });
  });

  it('skips non-bash tools', () => {
    const hook = createExecPolicyHook(testConfig);
    const result = hook.handler(makeEvent({ toolName: 'read_file', toolInput: { path: 'README.md' } }));
    expect(result).toEqual({ decision: 'skip' });
  });

  it('denies when execSecurity=deny', () => {
    const denyConfig = { ...testConfig, execSecurity: 'deny' } as Required<typeof DEFAULT_CONFIG>;
    const hook = createExecPolicyHook(denyConfig);
    const result = hook.handler(makeEvent({ toolInput: { command: 'ls' } }));
    expect(result).toMatchObject({ decision: 'deny' });
  });

  it('has priority 1000 (highest security level)', () => {
    const hook = createExecPolicyHook(testConfig);
    expect(hook.priority).toBe(1000);
  });
});

describe('file-policy-hook', () => {
  it('denies access to .env files', () => {
    const hook = createFilePolicyHook();
    const result = hook.handler(makeEvent({
      toolName: 'read_file',
      toolInput: { path: '/project/.env' },
    }));
    expect(result).toMatchObject({ decision: 'deny' });
  });

  it('allows access to normal files', () => {
    const hook = createFilePolicyHook();
    const result = hook.handler(makeEvent({
      toolName: 'read_file',
      toolInput: { path: '/project/README.md' },
    }));
    expect(result).toEqual({ decision: 'allow' });
  });

  it('skips non-file tools', () => {
    const hook = createFilePolicyHook();
    const result = hook.handler(makeEvent({
      toolName: 'bash',
      toolInput: { command: 'ls' },
    }));
    expect(result).toEqual({ decision: 'skip' });
  });

  it('skips when no file path in input', () => {
    const hook = createFilePolicyHook();
    const result = hook.handler(makeEvent({
      toolName: 'read_file',
      toolInput: {},
    }));
    expect(result).toEqual({ decision: 'skip' });
  });

  it('denies access to .ssh directory', () => {
    const hook = createFilePolicyHook();
    const result = hook.handler(makeEvent({
      toolName: 'read_file',
      toolInput: { path: '/home/user/.ssh/id_rsa' },
    }));
    expect(result).toMatchObject({ decision: 'deny' });
  });

  it('has priority 900', () => {
    const hook = createFilePolicyHook();
    expect(hook.priority).toBe(900);
  });
});

describe('security hooks integration with HookRegistry', () => {
  it('exec-policy runs before file-policy due to higher priority', async () => {
    const registry = new HookRegistry();
    registry.addPreToolUseHook(createFilePolicyHook());
    registry.addPreToolUseHook(createExecPolicyHook(testConfig));

    const result = await registry.triggerPreToolUse(makeEvent({
      toolName: 'bash',
      toolInput: { command: 'sudo rm -rf /' },
    }));

    expect(result.decision).toBe('deny');
  });

  it('all security hooks skip irrelevant tools, fallback to allow', async () => {
    const registry = new HookRegistry();
    registry.addPreToolUseHook(createExecPolicyHook(testConfig));
    registry.addPreToolUseHook(createFilePolicyHook());
    registry.addPreToolUseHook(createDangerousToolPolicyHook());

    const result = await registry.triggerPreToolUse(makeEvent({
      toolName: 'unknown_custom_tool',
      toolInput: { foo: 'bar' },
    }));

    expect(result).toEqual({ decision: 'allow' });
  });
});
