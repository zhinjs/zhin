import { describe, expect, it } from 'vitest';
import { deriveSubagentPolicy } from '../../src/security/policy-narrowing.js';
import { turnPolicyAllowsShell } from '../../src/plugin-runtime/native-bash-tool.js';
import type { TurnPolicyContext } from '../../src/turn/turn-ingress.js';

const ISOLATED: TurnPolicyContext = Object.freeze({
  permissions: ['owner'],
  unattended: false,
  shell: { security: 'allowlist', execPreset: 'development', approvalMode: 'auto', isolation: 'required' },
  filesystem: { workspaceRoot: '/ws', workingDirectory: '/ws', access: 'workspace-write' },
});
const NO_SHELL: TurnPolicyContext = Object.freeze({ permissions: ['user'], unattended: false });

describe('deriveSubagentPolicy', () => {
  it('never widens the parent policy', () => {
    expect(deriveSubagentPolicy(NO_SHELL)).toEqual({ permissions: ['user'], unattended: false });
    expect(turnPolicyAllowsShell(deriveSubagentPolicy(NO_SHELL))).toBe(false);
    const inherited = deriveSubagentPolicy(ISOLATED);
    expect(inherited).toEqual(ISOLATED);
    expect(inherited.shell?.isolation).toBe('required');
    const readOnly = deriveSubagentPolicy(ISOLATED, { readOnly: true });
    expect(readOnly.shell).toBeUndefined();
    expect(readOnly.filesystem?.access).toBe('read-only');
    // A shell the parent cannot actually run is dropped rather than carried along.
    const unusable = deriveSubagentPolicy({ ...ISOLATED, filesystem: { ...ISOLATED.filesystem!, access: 'danger-full-access' } });
    expect(unusable.shell).toBeUndefined();
    expect(Object.isFrozen(inherited)).toBe(true);
  });
});
