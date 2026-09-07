import { vi } from 'vitest';
import {
  MemoryWorkroomEffectJournal,
  WorkroomEffectLedger,
  createWorkroomEffectIntent,
} from '../../src/workroom/effect-ledger.js';
import { createGitWorkspaceLease } from '../../src/workroom/git-workspace-gateway.js';
import {
  GenerationOwnedP7EffectAuthorization,
  ProductionGitWorkroomEffectGateway,
} from '../../src/plugin-runtime/workroom-effect-production.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

describe('production Workroom Effect authorities', () => {
  it('authorizes only from persisted P7 candidate/risk/policy/Sponsor facts', async () => {
    const intent = createWorkroomEffectIntent(intentInput());
    const facts = authorizationFacts(intent);
    const authority = new GenerationOwnedP7EffectAuthorization(() => ({
      resolve: async () => facts,
    }));
    await expect(authority.authorize({
      projectId: 'project-1', expectedSequence: 4, now: 100, intent,
    })).resolves.toMatchObject({
      authorized: true, intentDigest: intent.digest, candidateHash: intent.candidateHash,
      authorizedBy: `p7-sponsor:sponsor-1:${sha('8')}`,
    });
    const stale = new GenerationOwnedP7EffectAuthorization(() => ({
      resolve: async () => ({ ...facts, candidateHash: sha('0') }),
    }));
    await expect(stale.authorize({
      projectId: 'project-1', expectedSequence: 4, now: 100, intent,
    })).rejects.toThrow('binding drift');
    await expect(new GenerationOwnedP7EffectAuthorization(() => undefined).authorize({
      projectId: 'project-1', expectedSequence: 4, now: 100, intent,
    })).rejects.toThrow('unavailable');
  });

  it('joins exact lease/protection/capability and never targets canonical branch', async () => {
    const intent = createWorkroomEffectIntent(intentInput());
    const lease = createGitWorkspaceLease(leaseInput());
    expect(intent.target.digest).toBe(lease.digest);
    const authority = new GenerationOwnedP7EffectAuthorization(() => ({
      resolve: async () => authorizationFacts(intent),
    }));
    const journal = new MemoryWorkroomEffectJournal();
    const ledger = new WorkroomEffectLedger(journal, authority);
    await ledger.recordIntent('project-1', intent);
    const pending = await ledger.read('project-1', intent.id);
    const push = vi.fn(async input => ({
      provider: provider(), repositoryId: input.repositoryId, ref: input.ref,
      headSha: input.headSha, externalReceiptRef: 'github-push:1', externalReceiptDigest: sha('a'),
    }));
    const capability = {
      provider: provider(), binding: intent.capability,
      credentials: { resolve: async () => ({ credentialId: 'github-app:1', secret: 'hidden', expiresAt: 1_000 }) },
      transport: { push, openPullRequest: vi.fn(), cancel: vi.fn() },
      reconcile: vi.fn(),
    };
    const gateway = new ProductionGitWorkroomEffectGateway({
      generation: 3, now: () => 100,
      resolveLease: () => ({ resolve: async () => lease }),
      resolveCapability: () => capability,
      resolveProtection: () => ({ attest: async () => protection(lease) }),
    });
    await expect(gateway.prepare(pending, signal())).resolves.toBeUndefined();
    const started = await ledger.startAuthorizedAttempt('project-1', intent.id, {
      operationId: 'publish-1', workerId: 'worker-1', fence: 7, startedAt: 100,
    });
    await expect(gateway.execute(started, signal())).resolves.toMatchObject({
      outcome: 'committed', provider: provider(), authorizationDigest: started.authorization?.authorizationDigest,
    });
    expect(push).toHaveBeenCalledWith(expect.objectContaining({
      ref: lease.attemptBranch, force: false,
    }), expect.objectContaining({ secret: 'hidden' }), expect.any(AbortSignal));

    const unavailable = new ProductionGitWorkroomEffectGateway({
      generation: 3, now: () => 100,
      resolveLease: () => ({ resolve: async () => lease }),
      resolveCapability: () => undefined,
      resolveProtection: () => ({ attest: async () => protection(lease) }),
    });
    await expect(unavailable.prepare(pending, signal())).rejects.toThrow('capability');
  });

  it.each([undefined, { ref: 'another-capability', digest: sha('2') }, { ref: 'capability:github', digest: sha('0') }])(
    'refuses missing or changed capability binding before credentials or transport access', async binding => {
      const intent = createWorkroomEffectIntent(intentInput());
      const lease = createGitWorkspaceLease(leaseInput());
      const ledger = new WorkroomEffectLedger(new MemoryWorkroomEffectJournal(),
        new GenerationOwnedP7EffectAuthorization(() => ({ resolve: async () => authorizationFacts(intent) })));
      await ledger.recordIntent('project-1', intent);
      const state = await ledger.startAuthorizedAttempt('project-1', intent.id, {
        operationId: 'publish-1', workerId: 'worker-1', fence: 7, startedAt: 100,
      });
      const resolve = vi.fn();
      const push = vi.fn();
      const reconcile = vi.fn();
      const gateway = new ProductionGitWorkroomEffectGateway({
        generation: 3, now: () => 100, resolveLease: () => ({ resolve: async () => lease }),
        resolveProtection: () => ({ attest: async () => protection(lease) }),
        resolveCapability: () => ({ binding, provider: provider(), credentials: { resolve },
          transport: { push, openPullRequest: vi.fn(), cancel: vi.fn() }, reconcile }),
      });
      await expect(gateway.prepare(state, signal())).rejects.toThrow('capability binding');
      await expect(gateway.execute(state, signal())).rejects.toThrow('capability binding');
      await expect(gateway.reconcile(state, signal())).rejects.toThrow('capability binding');
      expect(resolve).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
      expect(reconcile).not.toHaveBeenCalled();
    });

  it('rechecks authorization after asynchronous provider resolution before dispatching a write', async () => {
    const intent = createWorkroomEffectIntent(intentInput());
    const lease = createGitWorkspaceLease(leaseInput());
    const ledger = new WorkroomEffectLedger(new MemoryWorkroomEffectJournal(),
      new GenerationOwnedP7EffectAuthorization(() => ({ resolve: async () => authorizationFacts(intent) })));
    await ledger.recordIntent('project-1', intent);
    const state = await ledger.startAuthorizedAttempt('project-1', intent.id, {
      operationId: 'publish-1', workerId: 'worker-1', fence: 7, startedAt: 100,
    });
    let now = 100;
    const resolve = vi.fn();
    const push = vi.fn();
    const gateway = new ProductionGitWorkroomEffectGateway({
      generation: 3, now: () => now,
      resolveLease: () => ({ resolve: async () => { now = 1_000; return lease; } }),
      resolveProtection: () => ({ attest: async () => protection(lease) }),
      resolveCapability: () => ({ binding: intent.capability, provider: provider(), credentials: { resolve },
        transport: { push, openPullRequest: vi.fn(), cancel: vi.fn() }, reconcile: vi.fn() }),
    });
    await expect(gateway.execute(state, signal())).rejects.toThrow('authorization is expired');
    expect(resolve).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('can persist changing reconciliation observations of the same remote operation', async () => {
    const intent = createWorkroomEffectIntent(intentInput());
    const lease = createGitWorkspaceLease(leaseInput());
    const ledger = new WorkroomEffectLedger(new MemoryWorkroomEffectJournal(),
      new GenerationOwnedP7EffectAuthorization(() => ({ resolve: async () => authorizationFacts(intent) })));
    await ledger.recordIntent('project-1', intent);
    let state = await ledger.startAuthorizedAttempt('project-1', intent.id, {
      operationId: 'publish-1', workerId: 'worker-1', fence: 7, startedAt: 100,
    });
    const reconcile = vi.fn(async () => ({
      outcome: 'outcome_unknown' as 'outcome_unknown' | 'committed', provider: provider(),
      remoteRef: 'github-operation:1', remoteDigest: sha('a'), observedAt: 101,
      authenticatedBy: 'github-app:1',
    }));
    const gateway = new ProductionGitWorkroomEffectGateway({
      generation: 3, now: () => 100,
      resolveLease: () => ({ resolve: async () => lease }), resolveProtection: () => undefined,
      resolveCapability: () => ({
        provider: provider(), binding: intent.capability, credentials: { resolve: vi.fn() },
        transport: { push: vi.fn(), openPullRequest: vi.fn(), cancel: vi.fn() }, reconcile,
      }),
    });
    const unknown = await gateway.reconcile(state, signal());
    state = await ledger.recordReceipt('project-1', intent.id, unknown);
    reconcile.mockImplementation(async () => ({
      outcome: 'committed', provider: provider(), remoteRef: 'github-operation:1',
      remoteDigest: sha('a'), observedAt: 102, authenticatedBy: 'github-app:1',
    }));
    const committed = await gateway.reconcile(state, signal());
    expect(committed.receiptId).not.toBe(unknown.receiptId);
    await expect(ledger.recordReceipt('project-1', intent.id, committed))
      .resolves.toMatchObject({ status: 'committed' });
  });

});

function intentInput() {
  const lease = createGitWorkspaceLease(leaseInput());
  return {
    projectId: 'project-1', runId: 'run-1', taskKey: 'integrate', taskRevision: 1,
    candidateHash: sha('1'), capability: { ref: 'capability:github', digest: sha('2') },
    operation: { kind: 'git_push' as const, parameters: {
      repositoryId: 'github:owner/repo', ref: lease.attemptBranch, headSha: 'b'.repeat(40),
      changedPaths: ['src/index.ts'],
    } },
    target: { ref: lease.leaseRef, digest: lease.digest },
    preconditions: [{ ref: 'git-checkpoint:1', digest: sha('3') }],
    risk: { assessmentRef: 'risk:1', assessmentDigest: sha('4'), tier: 'high' as const },
    reversibility: { kind: 'discard_only' as const }, idempotencyKey: 'publish:1', createdAt: 10,
  };
}

function leaseInput() {
  return {
    leaseRef: 'workspace-lease:1', projectId: 'project-1', runId: 'run-1', taskKey: 'integrate',
    taskRevision: 1, assignmentId: 'assignment-1', attempt: 1, fence: 7,
    repository: { id: 'github:owner/repo', bindingRef: 'github-binding:1', bindingDigest: sha('5') },
    baseSha: 'a'.repeat(40), checkpointSha: 'a'.repeat(40), targetRef: 'refs/heads/main',
    attemptBranch: 'refs/heads/zhin/run-1/assignment-1/attempt-1', pathScopes: ['src/'],
    mode: 'pull_request' as const, expiresAt: 1_000,
  };
}

function authorizationFacts(intent: ReturnType<typeof createWorkroomEffectIntent>) {
  return {
    version: 1 as const, projectId: intent.projectId, runId: intent.runId, intentId: intent.id,
    intentDigest: intent.digest, candidateHash: intent.candidateHash,
    risk: { assessmentRef: intent.risk.assessmentRef, assessmentDigest: intent.risk.assessmentDigest },
    policy: { id: 'effect-policy:1', revision: 3, digest: sha('6') },
    policyDecision: { ref: 'effect-policy-decision:1', digest: sha('7') },
    scope: {
      assignmentAttempt: 1, workspaceFence: 7,
      workspaceRef: intent.target.ref, workspaceDigest: intent.target.digest,
      preconditionsDigest: digest(intent.preconditions), deadline: 1_000,
    },
    sponsor: { decision: 'approved' as const, decisionRef: 'sponsor-decision:1',
      decisionDigest: sha('8'), principalId: 'sponsor-1' },
    authorizationId: 'effect-authorization:1', issuedAt: 90, expiresAt: 1_000,
  };
}

function protection(lease: ReturnType<typeof createGitWorkspaceLease>) {
  const body = {
    version: 1 as const, repositoryId: lease.repository.id, targetRef: lease.targetRef,
    directPushForbidden: true as const, forcePushForbidden: true as const,
    pullRequestRequired: true as const, provider: provider(), observedAt: 99,
  };
  return { ...body, digest: digest(body) };
}

function provider() { return { id: 'github-app:1', digest: sha('9') }; }
function signal(): AbortSignal { return new AbortController().signal; }
function sha(char: string): string { return `sha256:${char.repeat(64)}`; }
