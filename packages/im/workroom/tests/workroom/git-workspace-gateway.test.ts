import { vi } from 'vitest';
import {
  GitWorkspaceGateway,
  createGitWorkspaceLease,
  type GitWorkspaceTransportPort,
} from '../../src/workroom/git-workspace-gateway.js';

describe('Git Workspace Gateway', () => {
  it('uses generation credentials internally and returns an exact fenced push receipt', async () => {
    const lease = createGitWorkspaceLease(leaseInput());
    const credentials = { resolve: vi.fn(async () => ({
      credentialId: 'github-app-installation:1', secret: 'never-persist-me', expiresAt: 1_000,
    })) };
    const transport = { push: vi.fn(async (input, credential) => {
      expect(credential.secret).toBe('never-persist-me');
      expect(input).not.toHaveProperty('credential');
      return {
        provider: { id: 'github', digest: sha('9') }, repositoryId: input.repositoryId,
        ref: input.ref, headSha: input.headSha, externalReceiptRef: 'github-push:1',
        externalReceiptDigest: sha('8'),
      };
    }), openPullRequest: vi.fn(), cancel: vi.fn() };
    const gateway = new GitWorkspaceGateway({ generation: 4, credentials, transport, now: () => 500 });

    await expect(gateway.push({
      operationId: 'push-1', lease, fence: 7, ref: lease.attemptBranch,
      headSha: 'b'.repeat(40), changedPaths: ['src/index.ts'], force: false,
    }, new AbortController().signal)).resolves.toMatchObject({
      repositoryId: 'github:owner/repo', ref: 'refs/heads/zhin/run-1/assignment-1/attempt-1',
      headSha: 'b'.repeat(40), externalReceiptRef: 'github-push:1',
    });
    expect(JSON.stringify(lease)).not.toContain('never-persist-me');
    expect(credentials.resolve).toHaveBeenCalledWith(expect.objectContaining({
      generation: 4, leaseDigest: lease.digest, operation: 'git_push',
    }), expect.any(AbortSignal));
  });

  it('rejects canonical/force/out-of-scope writes and stale PR head receipts', async () => {
    const lease = createGitWorkspaceLease(leaseInput());
    const gateway = new GitWorkspaceGateway({
      generation: 4,
      credentials: { resolve: async () => ({ credentialId: 'credential:1', secret: 'x', expiresAt: 1_000 }) },
      transport: {
        push: vi.fn(), cancel: vi.fn(),
        openPullRequest: async input => ({
          provider: { id: 'github', digest: sha('9') }, repositoryId: input.repositoryId,
          prRef: 'github-pr:1', headRef: input.headRef, baseRef: input.baseRef,
          prHeadSha: 'c'.repeat(40), externalReceiptDigest: sha('8'),
        }),
      },
      now: () => 500,
    });
    const signal = new AbortController().signal;

    await expect(gateway.push({
      operationId: 'push-canonical', lease, fence: 7, ref: lease.targetRef,
      headSha: 'b'.repeat(40), changedPaths: ['src/index.ts'], force: false,
    }, signal)).rejects.toThrow('canonical');
    await expect(gateway.push({
      operationId: 'push-force', lease, fence: 7, ref: lease.attemptBranch,
      headSha: 'b'.repeat(40), changedPaths: ['src/index.ts'], force: true,
    }, signal)).rejects.toThrow('Force');
    await expect(gateway.push({
      operationId: 'push-path', lease, fence: 7, ref: lease.attemptBranch,
      headSha: 'b'.repeat(40), changedPaths: ['secrets/key.txt'], force: false,
    }, signal)).rejects.toThrow('path scope');
    await expect(gateway.openPullRequest({
      operationId: 'pr-1', lease, fence: 7, headRef: lease.attemptBranch,
      baseRef: lease.targetRef, headSha: 'b'.repeat(40),
    }, signal)).rejects.toThrow('head SHA');
  });

  it('cancels through the same fenced lease and internal credential gateway', async () => {
    const lease = createGitWorkspaceLease(leaseInput());
    const cancel: GitWorkspaceTransportPort['cancel'] = vi.fn(async input => ({
      repositoryId: input.repositoryId, remoteOperationId: input.remoteOperationId,
      acknowledged: true, provider: { id: 'github', digest: sha('9') },
      receiptRef: `github-cancel:${input.remoteOperationId}`, receiptDigest: sha('8'),
    }));
    const gateway = new GitWorkspaceGateway({
      generation: 4,
      credentials: { resolve: async () => ({ credentialId: 'credential:1', secret: 'x', expiresAt: 1_000 }) },
      transport: { push: vi.fn(), openPullRequest: vi.fn(), cancel },
      now: () => 500,
    });
    await expect(gateway.cancel({
      operationId: 'cancel-1', lease, fence: 7, remoteOperationId: 'github-operation:1',
    }, new AbortController().signal)).resolves.toMatchObject({
      repositoryId: 'github:owner/repo', remoteOperationId: 'github-operation:1', acknowledged: true,
    });
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: `git-cancel:${lease.digest}:cancel-1`,
    }), expect.objectContaining({ credentialId: 'credential:1' }), expect.any(AbortSignal));
    await expect(gateway.cancel({
      operationId: 'cancel-2', lease, fence: 8, remoteOperationId: 'github-operation:1',
    }, new AbortController().signal)).rejects.toThrow('fence');
  });
});

function leaseInput() {
  return {
    leaseRef: 'workspace-lease:1', projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
    assignmentId: 'assignment-1', attempt: 1, fence: 7,
    repository: { id: 'github:owner/repo', bindingRef: 'github-binding:1', bindingDigest: sha('1') },
    baseSha: 'a'.repeat(40), targetRef: 'refs/heads/main',
    attemptBranch: 'refs/heads/zhin/run-1/assignment-1/attempt-1', pathScopes: ['src/', 'tests/'],
    mode: 'pull_request' as const, expiresAt: 1_000,
  };
}

function sha(char: string): string { return `sha256:${char.repeat(64)}`; }
