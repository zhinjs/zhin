import { describe, expect, it } from 'vitest';
import { toolInvocationFromTurn } from '../../src/plugin-runtime/capability-tools.js';
import { createHostProtectedPaths } from '../../src/security/host-config-paths.js';

function fakeTurn(extra: Record<string, unknown>): never {
  return {
    input: {},
    signal: new AbortController().signal,
    identity: { traceId: 't', turnId: 'u' },
    session: { key: 's' },
    origin: { kind: 'api' },
    principal: { subjectId: 'p', displayName: 'p', roles: [] },
    policy: {
      permissions: [],
      unattended: false,
      network: { enabled: false },
      shell: { isolation: 'required' },
      filesystem: { workspaceRoot: '/w', access: 'workspace-write' },
    },
    ports: {},
    ...extra,
  } as never;
}

describe('toolInvocationFromTurn protected paths (#1030 P0-c)', () => {
  it('carries host-protected paths as plain data on the filesystem policy', async () => {
    const paths = await createHostProtectedPaths({ projectRoot: '/w' });
    const { policy } = toolInvocationFromTurn(fakeTurn({ hostProtectedPaths: paths }));
    expect(policy.filesystem?.protectedPaths?.selfFiles).toContain('agents.md');
    expect(policy.filesystem?.protectedPaths?.selfDirs).toContain('skills');
    expect(policy.filesystem?.protectedPaths?.projectRoot).toBeTruthy();
  });

  it('omits them when the host injected none (fail-closed fallback downstream)', () => {
    const { policy } = toolInvocationFromTurn(fakeTurn({}));
    expect(policy.filesystem && 'protectedPaths' in policy.filesystem).toBe(false);
  });
});
