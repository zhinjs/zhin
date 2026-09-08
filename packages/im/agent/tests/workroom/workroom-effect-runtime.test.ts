import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileWorkroomEffectJournal } from '../../src/workroom/file-effect-ledger.js';
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

  it.each(['memory', 'file'] as const)('allows only one dispatcher when workers race (%s journal)', async kind => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-effect-race-'));
    try {
      const journal = kind === 'file' ? new FileWorkroomEffectJournal(directory) : new MemoryWorkroomEffectJournal();
      const intent = createWorkroomEffectIntent(intentInput());
      await new WorkroomEffectLedger(journal).recordIntent('project-1', intent);
      const execute = vi.fn(async (state: WorkroomEffectState) => receipt(state, 'committed', 'receipt:commit'));
      const options = {
        journal, authorization: { authorize: async () => auth(intent) },
        gateway: { execute, reconcile: vi.fn() }, workerId: 'worker', fence: 1, now: () => 100,
      };
      await Promise.all([
        new WorkroomEffectRuntime(options).runOnce('project-1', signal()),
        new WorkroomEffectRuntime(options).runOnce('project-1', signal()),
      ]);
      expect(execute).toHaveBeenCalledTimes(1);
      expect((await journal.read('project-1')).filter(event => event.type === 'effect.attempt_started')).toHaveLength(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('does not persist an attempt after cancellation while authorization is pending', async () => {
    const journal = new MemoryWorkroomEffectJournal();
    const intent = createWorkroomEffectIntent(intentInput());
    await new WorkroomEffectLedger(journal).recordIntent('project-1', intent);
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const execute = vi.fn();
    const controller = new AbortController();
    const runtime = new WorkroomEffectRuntime({
      journal, authorization: { authorize: async () => { entered(); await pending; return auth(intent); } },
      gateway: { execute, reconcile: vi.fn() }, workerId: 'worker', fence: 1, now: () => 100,
    });
    const running = runtime.runOnce('project-1', controller.signal);
    const rejected = expect(running).rejects.toThrow('cancelled during authorization');
    await ready;
    controller.abort(new Error('cancelled during authorization'));
    release();
    await rejected;
    expect(execute).not.toHaveBeenCalled();
    expect((await journal.read('project-1')).map(event => event.type)).toEqual(['effect.intent_recorded']);
  });

  it('blocks transport timeouts and unknown observations until reconciliation proves the outcome', async () => {
    const journal = new MemoryWorkroomEffectJournal();
    const intent = createWorkroomEffectIntent(intentInput());
    const ledger = new WorkroomEffectLedger(journal);
    await ledger.recordIntent('project-1', intent);
    const blockers = { block: vi.fn(), recover: vi.fn() };
    const resolve = vi.fn(async () => ({
      owner: 'operator', policy: { kind: 'pinned_profile' as const, ref: 'policy', digest: sha('1') },
      deadline: 1000, allowedSuccessors: ['retry', 'reconcile', 'cancel'] as const,
    }));
    const execute = vi.fn(async () => { throw new Error('transport timeout'); });
    const reconcile = vi.fn(async (state: WorkroomEffectState) => receipt(state, 'outcome_unknown', 'receipt:unknown'));
    const options = {
      journal, authorization: { authorize: async () => auth(intent) }, gateway: { execute, reconcile },
      workerId: 'worker', fence: 1, now: () => 100, blockers, blockerPolicy: { resolve },
    };
    await new WorkroomEffectRuntime(options).runOnce('project-1', signal());
    expect(resolve).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: 'reconcile', state: expect.objectContaining({ status: 'executing' }),
    }));
    expect(blockers.block).toHaveBeenLastCalledWith(expect.objectContaining({ allowedSuccessors: ['reconcile'] }));
    await new WorkroomEffectRuntime(options).runOnce('project-1', signal());
    expect((await ledger.read('project-1', intent.id)).status).toBe('outcome_unknown');
    expect(blockers.recover).not.toHaveBeenCalled();
    reconcile.mockImplementation(async state => receipt(state, 'committed', 'receipt:commit'));
    await new WorkroomEffectRuntime(options).runOnce('project-1', signal());
    expect(blockers.recover).toHaveBeenCalledWith('project-1', intent.id);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects a changed unknown receipt that reuses an existing receipt identity', async () => {
    const journal = new MemoryWorkroomEffectJournal();
    const intent = createWorkroomEffectIntent(intentInput());
    await new WorkroomEffectLedger(journal).recordIntent('project-1', intent);
    const options = {
      journal, authorization: { authorize: async () => auth(intent) },
      gateway: {
        execute: async (state: WorkroomEffectState) => receipt(state, 'outcome_unknown', 'receipt:same'),
        reconcile: async (state: WorkroomEffectState) => {
          throw new WorkroomEffectOutcomeUnknownError({
            ...receipt(state, 'outcome_unknown', 'receipt:same'), remoteDigest: sha('0'),
          });
        },
      },
      workerId: 'worker', fence: 1, now: () => 100,
    };
    await new WorkroomEffectRuntime(options).runOnce('project-1', signal());
    await expect(new WorkroomEffectRuntime(options).runOnce('project-1', signal()))
      .rejects.toThrow('receipt identity drift');
  });


  it('disposes a direct runOnce without hanging on an uncooperative dispatch, then reconciles after restart', async () => {
    const journal = new MemoryWorkroomEffectJournal();
    const intent = createWorkroomEffectIntent(intentInput());
    const ledger = new WorkroomEffectLedger(journal);
    await ledger.recordIntent('project-1', intent);
    let notifyDispatch!: () => void;
    const dispatched = new Promise<void>(resolve => { notifyDispatch = resolve; });
    let dispatchSignal: AbortSignal | undefined;
    const execute = vi.fn((_state: WorkroomEffectState, signal: AbortSignal) => {
      dispatchSignal = signal;
      notifyDispatch();
      return new Promise<WorkroomEffectGatewayReceipt>(() => {});
    });
    const reconcile = vi.fn(async (state: WorkroomEffectState) => receipt(state, 'committed', 'receipt:commit'));
    const options = { journal, authorization: { authorize: async () => auth(intent) },
      gateway: { execute, reconcile }, workerId: 'worker', fence: 1, now: () => 100 };
    const runtime = new WorkroomEffectRuntime(options);
    const running = runtime.runOnce('project-1', signal());
    const rejected = expect(running).rejects.toThrow('stopped');
    await dispatched;
    await runtime.dispose();
    await rejected;
    expect(dispatchSignal?.aborted).toBe(true);
    expect((await ledger.read('project-1', intent.id)).status).toBe('executing');
    await expect(runtime.runOnce('project-1', signal())).rejects.toThrow('stopped');
    await new WorkroomEffectRuntime(options).runOnce('project-1', signal());
    expect(execute).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('cannot start when the generation signal was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const runtime = new WorkroomEffectRuntime({
      journal: new MemoryWorkroomEffectJournal(), authorization: { authorize: vi.fn() },
      gateway: { execute: vi.fn(), reconcile: vi.fn() }, workerId: 'worker', fence: 1,
      signal: controller.signal,
    });
    expect(() => runtime.start()).toThrow('stopped');
    await expect(runtime.runOnce('project-1', signal())).rejects.toThrow('stopped');
    await runtime.dispose();
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
