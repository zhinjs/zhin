import {
  MemoryWorkroomEffectJournal,
  WorkroomEffectLedger,
  createWorkroomEffectIntent,
} from '../../src/workroom/effect-ledger.js';

describe('Workroom Effect Ledger', () => {
  it('separates intent, trusted authorization, attempt, and authenticated receipt', async () => {
    const ledger = new WorkroomEffectLedger(new MemoryWorkroomEffectJournal(), {
      authorize: async input => ({
        version: 1, authorized: true, intentId: input.intent.id,
        intentDigest: input.intent.digest, candidateHash: input.intent.candidateHash,
        authorizationId: 'effect-authorization-1', authorizationDigest: sha('b'),
        policy: { id: 'risk-policy-1', revision: 1, digest: sha('c') },
        authorizedBy: 'sponsor:sponsor-1', expiresAt: 100,
      }),
    });
    const intent = createWorkroomEffectIntent(intentInput());

    await ledger.recordIntent('project-1', intent);
    expect((await ledger.read('project-1', intent.id)).status).toBe('pending_authorization');

    await expect(ledger.startAuthorizedAttempt('project-1', intent.id, {
      operationId: 'start-1', workerId: 'worker-1', fence: 7, startedAt: 20,
    })).resolves.toMatchObject({ status: 'executing', attempt: { fence: 7 } });

    await ledger.recordReceipt('project-1', intent.id, {
      version: 1, receiptId: 'provider-receipt-1', intentId: intent.id,
      intentDigest: intent.digest, authorizationDigest: sha('b'), attemptId: 'effect-attempt:start-1',
      fence: 7, provider: { id: 'github-app:1', digest: sha('d') },
      outcome: 'committed', remoteRef: 'github-push:owner/repo:refs/heads/attempt-1',
      remoteDigest: sha('e'), observedAt: 30, authenticatedBy: 'github-app-webhook:1',
    });
    expect(await ledger.read('project-1', intent.id)).toMatchObject({
      status: 'committed', receipt: { outcome: 'committed' },
    });
  });

  it('keeps unknown outcomes reconciling and rejects cancellation after execution starts', async () => {
    const ledger = new WorkroomEffectLedger(new MemoryWorkroomEffectJournal(), {
      authorize: async input => authorization(input.intent.id, input.intent.digest),
    });
    const intent = createWorkroomEffectIntent(intentInput());
    await ledger.recordIntent('project-1', intent);
    await ledger.startAuthorizedAttempt('project-1', intent.id, {
      operationId: 'start-1', workerId: 'worker-1', fence: 7, startedAt: 20,
    });

    await expect(ledger.cancelPending('project-1', intent.id, 'cancel-1', 21))
      .rejects.toThrow('already started');
    await ledger.recordReceipt('project-1', intent.id, {
      version: 1, receiptId: 'unknown-1', intentId: intent.id, intentDigest: intent.digest,
      authorizationDigest: sha('b'), attemptId: 'effect-attempt:start-1', fence: 7,
      provider: { id: 'github-app:1', digest: sha('d') }, outcome: 'outcome_unknown',
      remoteRef: 'github-operation:unknown', remoteDigest: sha('e'), observedAt: 30,
      authenticatedBy: 'github-app-transport:1',
    });
    expect((await ledger.read('project-1', intent.id)).status).toBe('outcome_unknown');

    await expect(ledger.startAuthorizedAttempt('project-1', intent.id, {
      operationId: 'start-2', workerId: 'worker-2', fence: 8, startedAt: 31,
    }))
      .rejects.toThrow('reconciliation');
  });

  it('rejects stale authorization/receipt bindings and credential-like payload fields', async () => {
    expect(() => createWorkroomEffectIntent({
      ...intentInput(),
      operation: { kind: 'git_push', parameters: { credential: 'secret' } } as never,
    })).toThrow(/field|credential/u);

    const ledger = new WorkroomEffectLedger(new MemoryWorkroomEffectJournal(), {
      authorize: async input => ({
        ...authorization(input.intent.id, input.intent.digest), intentDigest: sha('f'),
      }),
    });
    const intent = createWorkroomEffectIntent(intentInput());
    await ledger.recordIntent('project-1', intent);
    await expect(ledger.startAuthorizedAttempt('project-1', intent.id, {
      operationId: 'start-1', workerId: 'worker-1', fence: 7, startedAt: 20,
    })).rejects.toThrow('authorization binding');
  });
});

function intentInput() {
  return {
    projectId: 'project-1', runId: 'run-1', taskKey: 'integrate', taskRevision: 1,
    candidateHash: sha('a'), capability: { ref: 'capability:git-publish', digest: sha('1') },
    operation: { kind: 'git_push' as const, parameters: {
      repositoryId: 'github:owner/repo', ref: 'refs/heads/zhin/run-1/attempt-1', headSha: 'a'.repeat(40),
      changedPaths: ['src/index.ts'],
    } },
    target: { ref: 'github:owner/repo:refs/heads/zhin/run-1/attempt-1', digest: sha('2') },
    preconditions: [{ ref: 'git-base:abc', digest: sha('3') }],
    risk: { assessmentRef: 'risk:1', assessmentDigest: sha('4'), tier: 'high' as const },
    reversibility: {
      kind: 'compensatable' as const,
      compensation: { operation: 'delete_attempt_branch', requiresReceipt: true },
    },
    idempotencyKey: 'effect:project-1:run-1:integrate:push:1', createdAt: 10,
  };
}

function authorization(intentId: string, intentDigest: string) {
  return {
    version: 1 as const, authorized: true as const, intentId, intentDigest,
    candidateHash: sha('a'), authorizationId: 'effect-authorization-1', authorizationDigest: sha('b'),
    policy: { id: 'risk-policy-1', revision: 1, digest: sha('c') },
    authorizedBy: 'sponsor:sponsor-1', expiresAt: 100,
  };
}

function sha(char: string): string { return `sha256:${char.repeat(64)}`; }
