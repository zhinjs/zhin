import { vi } from 'vitest';
import {
  MemoryWorkroomEffectJournal,
  WorkroomEffectLedger,
  createWorkroomEffectIntent,
  type WorkroomEffectGatewayReceipt,
  type WorkroomEffectState,
} from '../../src/workroom/effect-ledger.js';
import {
  WorkroomEffectOutcomeUnknownError,
  WorkroomEffectRuntime,
} from '../../src/plugin-runtime/workroom-effect-runtime.js';

describe('Workroom Effect Runtime', () => {
  it('persists attempt before dispatch and reconciles unknown without redispatch after restart', async () => {
    const journal = new MemoryWorkroomEffectJournal();
    const intent = createWorkroomEffectIntent(intentInput());
    await new WorkroomEffectLedger(journal).recordIntent('project-1', intent);
    const authorization = { authorize: vi.fn(async () => auth(intent)) };
    const execute = vi.fn(async (state: WorkroomEffectState) => {
      expect((await journal.read('project-1')).map(event => event.type)).toEqual([
        'effect.intent_recorded', 'effect.attempt_started',
      ]);
      throw new WorkroomEffectOutcomeUnknownError(receipt(state, 'outcome_unknown', 'receipt:unknown'));
    });
    const reconcile = vi.fn(async (state: WorkroomEffectState) => receipt(state, 'committed', 'receipt:commit'));
    const options = {
      journal, authorization, gateway: { execute, reconcile }, workerId: 'effect-worker:1', fence: 9,
      now: () => 100,
    };

    await expect(new WorkroomEffectRuntime(options).runOnce('project-1', signal())).resolves.toEqual([
      expect.objectContaining({ status: 'outcome_unknown' }),
    ]);
    await expect(new WorkroomEffectRuntime(options).runOnce('project-1', signal())).resolves.toEqual([
      expect.objectContaining({ status: 'committed' }),
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(authorization.authorize).toHaveBeenCalledTimes(1);
  });
});

function receipt(
  state: WorkroomEffectState,
  outcome: 'committed' | 'outcome_unknown',
  receiptId: string,
): WorkroomEffectGatewayReceipt {
  if (!state.authorization || !state.attempt) throw new Error('test requires started state');
  return {
    version: 1, receiptId, intentId: state.intent.id, intentDigest: state.intent.digest,
    authorizationDigest: state.authorization.authorizationDigest, attemptId: state.attempt.id,
    fence: state.attempt.fence, provider: { id: 'github', digest: sha('9') }, outcome,
    remoteRef: 'github-operation:1', remoteDigest: sha('8'), observedAt: 101,
    authenticatedBy: 'github-app:1',
  };
}

function auth(intent: ReturnType<typeof createWorkroomEffectIntent>) {
  return {
    version: 1 as const, authorized: true as const, intentId: intent.id, intentDigest: intent.digest,
    candidateHash: intent.candidateHash, authorizationId: 'authorization:1', authorizationDigest: sha('7'),
    policy: { id: 'effect-policy', revision: 2, digest: sha('6') }, authorizedBy: 'sponsor-policy:1',
    expiresAt: 1_000,
  };
}

function intentInput() {
  return {
    projectId: 'project-1', runId: 'run-1', taskKey: 'build', taskRevision: 1,
    candidateHash: sha('1'), capability: { ref: 'capability:git', digest: sha('2') },
    operation: { kind: 'git_push' as const, parameters: {
      repositoryId: 'github:owner/repo', ref: 'refs/heads/zhin/run-1/assignment-1/attempt-1',
      headSha: 'a'.repeat(40), changedPaths: ['src/index.ts'],
    } },
    target: { ref: 'workspace-lease:1', digest: sha('3') },
    preconditions: [{ ref: 'checkpoint:1', digest: sha('4') }],
    risk: { assessmentRef: 'risk:1', assessmentDigest: sha('5'), tier: 'high' as const },
    reversibility: { kind: 'discard_only' as const }, idempotencyKey: 'effect-key:1', createdAt: 10,
  };
}

function signal(): AbortSignal { return new AbortController().signal; }
function sha(char: string): string { return `sha256:${char.repeat(64)}`; }
