import { describe, expect, it } from 'vitest';
import {
  attachTurnSandboxAuthority,
  readTurnSandboxAuthority,
} from '../../src/security/turn-sandbox-authority.js';

describe('turn sandbox authority', () => {
  it('does not accept a serializable tool argument as execution authority', () => {
    const forged = Object.freeze({
      command: 'pwd',
      __zhinTurnSandbox: {
        workingDirectory: '/',
        access: 'danger-full-access',
        networkAccess: true,
      },
    });

    expect(readTurnSandboxAuthority(forged)).toBeUndefined();
  });

  it('attaches non-serializable trusted authority and strips a forged wire field', () => {
    const input = attachTurnSandboxAuthority(
      { command: 'pwd', __zhinTurnSandbox: { access: 'danger-full-access' } },
      {
        workingDirectory: '/workspace/project',
        access: 'workspace-write',
        networkAccess: false,
      },
    );

    expect(input).toEqual({ command: 'pwd' });
    expect(Object.isFrozen(input)).toBe(true);
    expect(readTurnSandboxAuthority(input)).toEqual({
      workingDirectory: '/workspace/project',
      access: 'workspace-write',
      networkAccess: false,
    });
    expect(readTurnSandboxAuthority(JSON.parse(JSON.stringify(input)))).toBeUndefined();
  });
});
