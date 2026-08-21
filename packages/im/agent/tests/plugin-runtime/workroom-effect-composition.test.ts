import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { rootPluginId, Scope } from '@zhin.js/plugin-runtime';
import { createWorkroomEffectIntent } from '../../src/workroom/effect-ledger.js';
import { createGitWorkspaceLease } from '../../src/workroom/git-workspace-gateway.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import {
  installWorkroomEffectResources,
  workroomEffectIntentWriterToken,
  workroomEffectRuntimeToken,
} from '../../src/plugin-runtime/workroom-effect-composition.js';
import {
  workroomGitBranchProtectionAuthorityToken,
  workroomGitWorkspaceLeaseAuthorityToken,
} from '../../src/plugin-runtime/workroom-effect-production.js';

describe('standard Workroom Effect composition', () => {
  it('starts without a Git provider and durably blocks the exact Effect without churn', async () => {
    const projectRoot = join(tmpdir(), `zhin-effect-composition-${randomUUID()}`);
    await mkdir(join(projectRoot, '.zhin'), { recursive: true });
    const resources = new Scope(rootPluginId());
    const lease = createGitWorkspaceLease(leaseInput(8));
    resources.provide(workroomGitWorkspaceLeaseAuthorityToken, {
      resolve: async () => lease,
    });
    resources.provide(workroomGitBranchProtectionAuthorityToken, {
      attest: async () => protection(lease),
    });
    const composition = installWorkroomEffectResources({
      projectRoot, generation: 8, signal: new AbortController().signal, resources,
      projects: { listProjectIds: async () => ['project-1'] },
      clock: { read: async () => 100 },
      blockerPolicy: { resolve: async () => ({
        owner: 'github-capability' as const, deadline: 1_000,
        policy: { kind: 'root_emergency_fallback' as const, ref: 'root-emergency:1', digest: sha('0') },
        allowedSuccessors: ['retry', 'cancel'] as const,
      }) },
      now: () => 100,
    });
    expect(resources.has(workroomEffectIntentWriterToken)).toBe(true);
    expect(resources.has(workroomEffectRuntimeToken)).toBe(true);
    const intent = createWorkroomEffectIntent(intentInput(lease));
    await resources.use(workroomEffectIntentWriterToken).record(intent);
    await expect(composition.runtime.drain()).resolves.toEqual([]);
    await expect(composition.runtime.drain()).resolves.toEqual([]);
    expect(await composition.blockers.read('project-1', intent.id)).toMatchObject({
      revision: 1, status: 'blocked', owner: 'github-capability', deadline: 1_000,
    });
    await composition.runtime.dispose();
  });
});

function intentInput(lease: ReturnType<typeof createGitWorkspaceLease>) {
  return {
    projectId: 'project-1', runId: 'run-1', taskKey: 'integrate', taskRevision: 1,
    candidateHash: sha('1'), capability: { ref: 'capability:github', digest: sha('2') },
    operation: { kind: 'git_push' as const, parameters: {
      repositoryId: lease.repository.id, ref: lease.attemptBranch, headSha: 'b'.repeat(40),
      changedPaths: ['src/index.ts'],
    } },
    target: { ref: lease.leaseRef, digest: lease.digest },
    preconditions: [{ ref: 'git-checkpoint:1', digest: sha('3') }],
    risk: { assessmentRef: 'risk:1', assessmentDigest: sha('4'), tier: 'high' as const },
    reversibility: { kind: 'discard_only' as const }, idempotencyKey: 'publish:1', createdAt: 10,
  };
}

function leaseInput(fence: number) {
  return {
    leaseRef: 'workspace-lease:1', projectId: 'project-1', runId: 'run-1', taskKey: 'integrate',
    taskRevision: 1, assignmentId: 'assignment-1', attempt: 1, fence,
    repository: { id: 'github:owner/repo', bindingRef: 'github-binding:1', bindingDigest: sha('5') },
    baseSha: 'a'.repeat(40), checkpointSha: 'a'.repeat(40), targetRef: 'refs/heads/main',
    attemptBranch: 'refs/heads/zhin/run-1/assignment-1/attempt-1', pathScopes: ['src/'],
    mode: 'pull_request' as const, expiresAt: 1_000,
  };
}

function protection(lease: ReturnType<typeof createGitWorkspaceLease>) {
  const body = {
    version: 1 as const, repositoryId: lease.repository.id, targetRef: lease.targetRef,
    directPushForbidden: true as const, forcePushForbidden: true as const,
    pullRequestRequired: true as const, provider: { id: 'github-app:1', digest: sha('9') }, observedAt: 99,
  };
  return { ...body, digest: digest(body) };
}
function sha(char: string): string { return `sha256:${char.repeat(64)}`; }
