import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkroomAcceptancePolicyDecisionPort } from '../../src/workroom/acceptance-policy.js';
import {
  createAssignmentExecutionEnvelope,
  type AssignmentExecutionEnvelope,
} from '../../src/workroom/assignment-executor.js';
import { AssignmentObservationIngress } from '../../src/workroom/assignment-observation-ingress.js';
import { MemoryWorkroomJournal } from '../../src/workroom/journal.js';
import {
  MemoryWorkroomProjectionRepository,
  FileWorkroomProjectionRepository,
  WorkroomProjectionTracer,
  WorkroomProjectionDeliveryWorker,
  WorkroomProjectionRevisionConflictError,
  resolveProjectionReplyTarget,
  workroomProjectionMessageKey,
  type WorkroomProjectionDeliveryPort,
  type WorkroomProjectionBinding,
  type WorkroomProjectionOutboxItem,
} from '../../src/workroom/projection-outbox.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';
import type { WorkroomEvent } from '../../src/workroom/kernel-contracts.js';
import { createTestProjectionGovernance } from './projection-governance-fixture.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const DIGEST_C = `sha256:${'c'.repeat(64)}`;
const DIGEST_D = `sha256:${'d'.repeat(64)}`;
const DIGEST_E = `sha256:${'e'.repeat(64)}`;
const DIGEST_F = `sha256:${'f'.repeat(64)}`;
const temporaryRoots: string[] = [];
const governance = createTestProjectionGovernance();

function lifecycleOverdue(stateSequence: number, includeSecond = false) {
  const body = {
    version: 1 as const,
    projectId: 'project-1',
    clockRevision: 7,
    observedAt: 100,
    overdue: [{
      objectId: 'object-1', stateSequence, stateDigest: DIGEST_A,
      holdId: 'hold-1', ownerPrincipalId: 'steward-1', reasonCode: 'legal_hold' as const,
      placedAt: 1, reviewAt: 50, overdueBy: 50,
    }, ...(includeSecond ? [{
      objectId: 'object-1', stateSequence, stateDigest: DIGEST_A,
      holdId: 'hold-2', ownerPrincipalId: 'steward-2', reasonCode: 'investigation' as const,
      placedAt: 2, reviewAt: 75, overdueBy: 25,
    }] : [])],
  };
  return { ...body, digest: digest(body) };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('Workroom Projection Outbox', () => {
  it('accepts an exact HEAD binding with the legacy implicit Workroom audience', async () => {
    const repository = new MemoryWorkroomProjectionRepository();
    const { audience: _audience, ...legacyBinding } = binding();
    const legacy = await repository.bind(0, legacyBinding);

    const rebound = await repository.bind(legacy.revision, binding());

    expect(rebound).toBe(legacy);
    expect(rebound.revision).toBe(1);
  });

  it('captures committed Kernel observations as named Agent work/progress projections exactly once', async () => {
    const fixture = await runningAssignment();
    const state = await fixture.kernel.read('project-1', 'run-1');
    const progressed = await fixture.ingress.apply(fixture.envelope, {
      version: 1,
      type: 'progress',
      observationId: 'observation-progress-1',
      envelopeDigest: fixture.envelope.digest,
      progress: {
        summary: '完成 durable projection schema',
        completedUnits: 1,
        totalUnits: 2,
      },
    }, state.sequence);
    const completed = await fixture.ingress.apply(fixture.envelope, {
      version: 1,
      type: 'execution_completed',
      observationId: 'observation-completion-1',
      envelopeDigest: fixture.envelope.digest,
      completion: {
        report: { ref: 'task-report:assignment-1:1', digest: DIGEST_D },
        candidate: { ref: 'candidate:assignment-1:1', hash: DIGEST_E },
      },
    }, progressed.sequence);
    const repository = new MemoryWorkroomProjectionRepository();
    const tracer = new WorkroomProjectionTracer({
      journal: fixture.journal,
      repository,
      governance,
    });

    const routedBinding = binding('workroom', true);
    const captured = await tracer.capture(routedBinding, 'run-1');
    const replayed = await tracer.capture(routedBinding, 'run-1');

    const agentItems = Object.values(captured.items).filter(item =>
      item.speaker.agentDefinitionId === 'software.developer');
    expect(agentItems.map(item => [item.kind, governance.body(item)])).toEqual([
      ['status', '[Developer · executor] build：已领取当前工作'],
      ['status', '[Developer · executor] build：正在执行'],
      ['progress', '[Developer · executor] build：完成 durable projection schema（1/2）'],
      ['conclusion', '[Developer · executor] build：已提交执行结论，等待验收'],
    ]);
    expect(agentItems.at(-1)).toMatchObject({
      projectId: 'project-1',
      runId: 'run-1',
      sourceSequence: completed.sequence,
      bindingRevision: 3,
      projectionPolicyRevision: 2,
      target: {
        projectId: 'project-1',
        runId: 'run-1',
        taskKey: 'build',
        taskRevision: 1,
        assignmentId: 'assignment-1',
        agentDefinitionId: 'software.developer',
      },
      delivery: { status: 'pending', attempts: 0, fence: 0 },
      conversation: {
        endpoint: { id: 'slack-developer', adapter: '@zhin.js/adapter-slack' },
        kind: 'channel', id: 'project-1-room',
      },
    });
    expect(Object.values(captured.cursors)).toContain(completed.sequence);
    expect(replayed.revision).toBe(captured.revision);
    expect(Object.keys(replayed.items)).toHaveLength(Object.keys(captured.items).length);
    expect(Object.isFrozen(agentItems.at(-1)?.target)).toBe(true);
    expect(JSON.stringify(captured)).not.toContain('完成 durable projection schema');
  });

  it('recovers outbox items and cursors after restart and fences concurrent CAS writers', async () => {
    const fixture = await runningAssignment();
    const root = join(tmpdir(), `workroom-projection-${crypto.randomUUID()}`);
    temporaryRoots.push(root);
    await mkdir(root);
    const directory = join(root, 'projection');
    const first = new FileWorkroomProjectionRepository(directory);
    await first.bind(0, binding());
    const captured = await new WorkroomProjectionTracer({
      journal: fixture.journal,
      repository: first,
      governance,
    }).capture(binding(), 'run-1');

    const restarted = new FileWorkroomProjectionRepository(directory);
    expect(await restarted.read()).toEqual(captured);
    const snapshots = (await readdir(directory)).filter(name => name.startsWith('projection.')).sort();
    const persisted = await readFile(join(directory, snapshots.at(-1)!), 'utf8');
    expect(persisted).not.toContain('Run 已启动');
    expect(persisted).not.toContain('"content"');

    const competing = new FileWorkroomProjectionRepository(directory);
    const outcomes = await Promise.allSettled([
      restarted.capture(captured.revision, {
        runId: 'run-a', expectedCursor: -1, cursor: 0, items: [],
      }),
      competing.capture(captured.revision, {
        runId: 'run-b', expectedCursor: -1, cursor: 0, items: [],
      }),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const loser = outcomes.find(result => result.status === 'rejected');
    expect(loser).toMatchObject({
      status: 'rejected',
      reason: expect.any(WorkroomProjectionRevisionConflictError),
    });
    expect((await new FileWorkroomProjectionRepository(directory).read()).revision)
      .toBe(captured.revision + 1);
  });

  it('migrates an exact legacy Run cursor without replaying historical projections', async () => {
    const fixture = await runningAssignment();
    const source = new MemoryWorkroomProjectionRepository();
    const captured = await new WorkroomProjectionTracer({
      journal: fixture.journal,
      repository: source,
      governance,
    }).capture(binding(), 'run-1');
    const legacyItems = Object.values(captured.items).map(item => {
      const {
        cursorId: _cursorId,
        id: _id,
        idempotencyKey: _idempotencyKey,
        digest: _digest,
        delivery,
        ...projection
      } = item;
      const legacyDigest = digest(projection);
      const id = `projection:${legacyDigest.slice('sha256:'.length)}`;
      return {
        ...projection,
        id,
        idempotencyKey: id,
        digest: legacyDigest,
        delivery,
      } satisfies WorkroomProjectionOutboxItem;
    });
    const repository = new MemoryWorkroomProjectionRepository();
    const bound = await repository.bind(0, binding());
    const legacy = await repository.capture(bound.revision, {
      runId: 'run-1',
      expectedCursor: -1,
      cursor: captured.cursors[Object.keys(captured.cursors)[0]!]!,
      items: legacyItems,
    });

    const migrated = await new WorkroomProjectionTracer({
      journal: fixture.journal,
      repository,
      governance,
    }).capture(binding(), 'run-1');

    expect(Object.keys(migrated.items)).toEqual(Object.keys(legacy.items));
    expect(Object.keys(migrated.cursors)).toHaveLength(2);
    expect(migrated.cursors['run-1']).toBeDefined();
    expect(migrated.revision).toBe(legacy.revision + 1);
  });

  it('captures overdue lifecycle state through the governed durable outbox without duplicate restart sends', async () => {
    const root = join(tmpdir(), `workroom-lifecycle-projection-${crypto.randomUUID()}`);
    temporaryRoots.push(root);
    await mkdir(root);
    const directory = join(root, 'projection');
    const repository = new FileWorkroomProjectionRepository(directory);
    await repository.bind(0, binding('sponsor_room'));
    const tracer = new WorkroomProjectionTracer({
      journal: new MemoryWorkroomJournal(), repository, governance,
    });
    const snapshot = lifecycleOverdue(4);

    const captured = await tracer.captureLifecycleOverdue(binding('sponsor_room'), snapshot);
    const restarted = new WorkroomProjectionTracer({
      journal: new MemoryWorkroomJournal(),
      repository: new FileWorkroomProjectionRepository(directory),
      governance,
    });
    const replayed = await restarted.captureLifecycleOverdue(binding('sponsor_room'), snapshot);
    const secondHold = await restarted.captureLifecycleOverdue(
      binding('sponsor_room'), lifecycleOverdue(4, true),
    );
    const advanced = await restarted.captureLifecycleOverdue(
      binding('sponsor_room'), lifecycleOverdue(5, true),
    );

    expect(Object.values(captured.cursors)).toContain(0);
    expect(replayed.revision).toBe(captured.revision);
    expect(Object.keys(replayed.items)).toHaveLength(1);
    expect(Object.keys(secondHold.items)).toHaveLength(2);
    expect(Object.keys(advanced.items)).toHaveLength(2);
    expect(Object.values(advanced.cursors)).toContain(1);
    const item = Object.values(advanced.items)[0]!;
    expect(item).toMatchObject({
      kind: 'attention', projectId: 'project-1', sourceSequence: 0, audience: 'sponsor_room',
      target: { projectId: 'project-1', agentDefinitionId: 'software.orchestrator' },
      disclosure: { request: { sinkRuleId: 'projection:sponsor-room' } },
    });
    expect(item.target).not.toHaveProperty('taskKey');
    expect(governance.body(item)).toContain('Retention Hold review overdue');
    const persisted = await readFile(join(directory,
      (await readdir(directory)).filter(name => name.startsWith('projection.')).sort().at(-1)!), 'utf8');
    expect(persisted).not.toMatch(/object-1|hold-1|Retention Hold review overdue/u);

    let sends = 0;
    const revokedGovernance = {
      prepareProjection: governance.prepareProjection.bind(governance),
      revalidate: async () => ({ status: 'blocked' as const, reason: 'disclosure_recipient_revoked' as const }),
    };
    const worker = new WorkroomProjectionDeliveryWorker({
      repository: new FileWorkroomProjectionRepository(directory),
      outbound: { send: async () => { sends += 1; return { status: 'sent' }; } },
      workerId: 'lifecycle-worker', leaseMs: 1_000, governance: revokedGovernance,
    });
    await expect(worker.runOnce(1_000, new AbortController().signal)).resolves.toEqual({
      status: 'failed', code: 'disclosure_recipient_revoked', retryable: false,
    });
    expect(sends).toBe(0);
  });

  it('retries failed unified delivery with the same idempotency key and durably indexes the receipt', async () => {
    const fixture = await runningAssignment();
    const root = join(tmpdir(), `workroom-projection-worker-${crypto.randomUUID()}`);
    temporaryRoots.push(root);
    await mkdir(root);
    const directory = join(root, 'projection');
    const repository = new FileWorkroomProjectionRepository(directory);
    await new WorkroomProjectionTracer({ journal: fixture.journal, repository, governance })
      .capture(binding(), 'run-1');
    const calls: Array<{ idempotencyKey: string; content: string }> = [];
    const outbound: WorkroomProjectionDeliveryPort = {
      async send(item, body) {
        calls.push({ idempotencyKey: item.idempotencyKey, content: new TextDecoder().decode(body) });
        if (calls.length === 1) {
          return { status: 'failed', code: 'rate_limited', retryable: true };
        }
        return {
          status: 'sent',
          message: { conversation: item.conversation, id: `platform-message-${calls.length}` },
        };
      },
    };
    let completionNow = 10_000;
    const worker = new WorkroomProjectionDeliveryWorker({
      repository,
      outbound,
      workerId: 'projection-worker-1',
      leaseMs: 1_000,
      governance,
      // Simulate a slow external send: retry delay starts at completion, not claim time.
      now: () => completionNow,
    });
    const kernelSequence = (await fixture.kernel.read('project-1', 'run-1')).sequence;

    expect(await worker.runOnce(1_000, new AbortController().signal))
      .toMatchObject({ status: 'failed', code: 'rate_limited' });
    expect(await worker.runOnce(2_000, new AbortController().signal))
      .toMatchObject({ status: 'sent', message: { id: 'platform-message-2' } });
    completionNow = 12_000;
    expect(await worker.runOnce(11_000, new AbortController().signal))
      .toMatchObject({ status: 'sent', message: { id: 'platform-message-3' } });

    expect(calls).toHaveLength(3);
    expect(calls[1]).not.toEqual(calls[0]);
    expect(calls[2]).toEqual(calls[0]);
    const restarted = await new FileWorkroomProjectionRepository(directory).read();
    const indexed = restarted.messageIndex[workroomProjectionMessageKey({
      conversation: binding().conversation,
      id: 'platform-message-3',
    })];
    expect(indexed).toMatchObject({
      projectionId: calls[0]?.idempotencyKey,
      bindingRevision: 3,
      sourceEventIds: ['event-1'],
      target: { projectId: 'project-1', runId: 'run-1' },
      speaker: { displayName: 'Orchestrator' },
    });
    expect((await fixture.kernel.read('project-1', 'run-1')).sequence).toBe(kernelSequence);
  });

  it('rejects a legacy plaintext snapshot with content-free offline export/purge guidance', async () => {
    const fixture = await runningAssignment();
    const root = join(tmpdir(), `workroom-projection-legacy-${crypto.randomUUID()}`);
    temporaryRoots.push(root);
    await mkdir(root);
    const repository = new FileWorkroomProjectionRepository(root);
    const current = await new WorkroomProjectionTracer({
      journal: fixture.journal, repository, governance,
    }).capture(binding(), 'run-1');
    const entry = Object.values(current.items)[0]!;
    const { disclosure: _disclosure, ...header } = entry;
    const secret = 'legacy-secret-body-314159';
    const legacyItem = { ...header, content: secret };
    const legacyState = {
      ...current,
      revision: current.revision + 1,
      items: { ...current.items, [entry.id]: legacyItem },
    };
    await writeFile(
      join(root, `projection.${String(legacyState.revision).padStart(16, '0')}.json`),
      JSON.stringify({ state: legacyState, digest: digest(legacyState) }),
      'utf8',
    );

    let failure: unknown;
    try {
      await new FileWorkroomProjectionRepository(root).read();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('offline export then purge');
    expect((failure as Error).message).not.toContain(secret);
  });

  it('blocks a stale Manifest before outbound and persists only the common reason code', async () => {
    const fixture = await runningAssignment();
    const repository = new MemoryWorkroomProjectionRepository();
    await new WorkroomProjectionTracer({ journal: fixture.journal, repository, governance })
      .capture(binding(), 'run-1');
    let sends = 0;
    const worker = new WorkroomProjectionDeliveryWorker({
      repository,
      workerId: 'projection-governance-block',
      leaseMs: 1_000,
      governance: {
        prepareProjection: governance.prepareProjection,
        revalidate: async () => ({ status: 'blocked', reason: 'disclosure_recipient_revoked' }),
      },
      outbound: {
        send: async () => { sends += 1; return { status: 'sent' }; },
      },
    });

    await expect(worker.runOnce(1_000, new AbortController().signal)).resolves.toEqual({
      status: 'failed', code: 'disclosure_recipient_revoked', retryable: false,
    });
    expect(sends).toBe(0);
    expect(JSON.stringify(await repository.read())).not.toContain('Run 已启动');
  });

  it('resolves reply provenance into a discussion-only TaskInput target without changing Task state', async () => {
    const fixture = await runningAssignment();
    const beforeProgress = await fixture.kernel.read('project-1', 'run-1');
    await fixture.ingress.apply(fixture.envelope, {
      version: 1,
      type: 'progress',
      observationId: 'observation-targeting-1',
      envelopeDigest: fixture.envelope.digest,
      progress: { summary: '等待人类补充兼容性证据' },
    }, beforeProgress.sequence);
    const repository = new MemoryWorkroomProjectionRepository();
    await new WorkroomProjectionTracer({ journal: fixture.journal, repository, governance })
      .capture(binding(), 'run-1');
    const worker = new WorkroomProjectionDeliveryWorker({
      repository,
      workerId: 'projection-worker-1',
      leaseMs: 1_000,
      governance,
      outbound: {
        async send(item) {
          return {
            status: 'sent',
            message: { conversation: item.conversation, id: `message-${item.sourceSequence}` },
          };
        },
      },
    });
    while ((await worker.runOnce(1_000, new AbortController().signal)).status !== 'idle') {
      // Drain this finite durable outbox through its public worker seam.
    }
    const projection = await repository.read();
    const reply = Object.values(projection.messageIndex)
      .find(entry => entry.target.assignmentId === 'assignment-1')?.message;
    expect(reply).toBeDefined();
    const kernelBeforeReply = await fixture.kernel.read('project-1', 'run-1');

    const decision = resolveProjectionReplyTarget(projection, {
      projectId: 'project-1',
      bindingRevision: 3,
      replyTo: reply!,
      intent: 'discussion',
      activeAssignments: [{
        projectId: 'project-1',
        runId: 'run-1',
        taskKey: 'build',
        taskRevision: 1,
        assignmentId: 'assignment-1',
        assignmentRevision: 1,
      }],
    });

    expect(decision).toMatchObject({
      status: 'task_target',
      via: 'reply',
      disposition: 'discussion_only',
      sourceProjectionId: expect.stringMatching(/^projection:/u),
      target: {
        projectId: 'project-1',
        runId: 'run-1',
        taskKey: 'build',
        taskRevision: 1,
        assignmentId: 'assignment-1',
        assignmentRevision: 1,
        agentDefinitionId: 'software.developer',
        status: 'active',
      },
    });
    expect(await fixture.kernel.read('project-1', 'run-1')).toEqual(kernelBeforeReply);
  });

  it('persists a returned send receipt when cancellation races after the external effect', async () => {
    const fixture = await runningAssignment();
    const repository = new MemoryWorkroomProjectionRepository();
    await new WorkroomProjectionTracer({ journal: fixture.journal, repository, governance })
      .capture(binding(), 'run-1');
    const controller = new AbortController();
    const worker = new WorkroomProjectionDeliveryWorker({
      repository,
      workerId: 'projection-worker-1',
      leaseMs: 1_000,
      governance,
      outbound: {
        async send(item) {
          controller.abort(new DOMException('Run cancelled after send', 'AbortError'));
          return {
            status: 'sent',
            message: { conversation: item.conversation, id: 'message-raced-cancel' },
          };
        },
      },
    });

    await expect(worker.runOnce(1_000, controller.signal)).resolves.toMatchObject({
      status: 'sent', message: { id: 'message-raced-cancel' },
    });
    expect(Object.keys((await repository.read()).messageIndex)).toHaveLength(1);
  });

  it('aggregates a fixed Kernel-order progress window and resumes it exactly once after restart', async () => {
    const fixture = await runningAssignment();
    const repository = new MemoryWorkroomProjectionRepository();
    const progress = async (observationId: string, summary: string) => {
      const state = await fixture.kernel.read('project-1', 'run-1');
      return fixture.ingress.apply(fixture.envelope, {
        version: 1,
        type: 'progress',
        observationId,
        envelopeDigest: fixture.envelope.digest,
        progress: { summary },
      }, state.sequence);
    };

    await progress('progress-window-1', '第一段');
    const first = await new WorkroomProjectionTracer({ journal: fixture.journal, repository, governance })
      .capture(binding(), 'run-1');
    expect(Object.values(first.items).filter(item => item.kind === 'progress')).toHaveLength(0);

    await progress('progress-window-2', '第二段');
    const second = await new WorkroomProjectionTracer({ journal: fixture.journal, repository, governance })
      .capture(binding(), 'run-1');
    expect(Object.values(second.items).filter(item => item.kind === 'progress')).toHaveLength(0);
    expect(second.cursors).toEqual(first.cursors);

    await progress('progress-window-3', '第三段');
    const restartedTracer = new WorkroomProjectionTracer({ journal: fixture.journal, repository, governance });
    const completedWindow = await restartedTracer.capture(binding(), 'run-1');
    const digests = Object.values(completedWindow.items).filter(item => item.kind === 'progress');
    expect(digests).toHaveLength(1);
    expect(digests[0]).toMatchObject({
      sourceEventIds: expect.arrayContaining([
        expect.stringMatching(/^event-/u),
        expect.stringMatching(/^event-/u),
        expect.stringMatching(/^event-/u),
      ]),
    });
    expect(governance.body(digests[0]!))
      .toBe('[Developer · executor] build：第三段；本窗口 3 次更新');
    expect(new Set(digests[0]?.sourceEventIds).size).toBe(3);

    const replayed = await restartedTracer.capture(binding(), 'run-1');
    expect(replayed.revision).toBe(completedWindow.revision);
    expect(Object.values(replayed.items).filter(item => item.kind === 'progress')).toHaveLength(1);
  });

  it('projects bounded Reviewer, Sponsor and cancellation control facts without payload disclosure', async () => {
    const longReason = `  human   reason ${'secret '.repeat(80)} `;
    const events: WorkroomEvent[] = [
      workroomEvent(0, 'run.created', { projectId: 'project-1', title: 'Controls' }),
      workroomEvent(1, 'task.planned', { taskKey: 'build' }),
      workroomEvent(2, 'assignment.claimed', {
        taskKey: 'build', assignmentId: 'assignment-1', owner: 'agent:developer-1', role: 'executor',
        taskRevision: 1, assignmentRevision: 1,
      }),
      workroomEvent(3, 'reviewer.assigned', { taskKey: 'build', reason: longReason }),
      workroomEvent(4, 'sponsor_gate.opened', { taskKey: 'build', reason: longReason }),
      workroomEvent(5, 'sponsor_gate.expired', { taskKey: 'build' }),
      workroomEvent(6, 'sponsor_gate.decided', { taskKey: 'build', decision: 'request_changes', reason: longReason }),
      workroomEvent(7, 'task.rework_requested', { taskKey: 'build', reason: longReason }),
      workroomEvent(8, 'assignment.lease_expired', { assignmentId: 'assignment-1' }),
      workroomEvent(9, 'assignment.cancel_requested', { assignmentId: 'assignment-1' }),
      workroomEvent(10, 'assignment.cancelled', { assignmentId: 'assignment-1' }),
      workroomEvent(11, 'task.cancel_requested', { taskKey: 'build', reason: longReason }),
      workroomEvent(12, 'run.cancel_requested', { reason: longReason }),
    ];
    const repository = new MemoryWorkroomProjectionRepository();
    const tracer = new WorkroomProjectionTracer({
      repository,
      governance,
      journal: {
        listRunIds: async () => ['run-1'],
        read: async () => events,
        append: async () => { throw new Error('read-only test Journal'); },
      },
    });

    const state = await tracer.capture(binding(), 'run-1');
    const controls = Object.values(state.items).filter(item => item.sourceSequence >= 3);
    expect(controls.map(item => [item.kind, item.sourceSequence])).toEqual([
      ['attention', 3], ['attention', 4], ['attention', 5], ['attention', 6],
      ['attention', 7], ['attention', 8], ['attention', 9], ['attention', 10],
      ['attention', 11], ['attention', 12],
    ]);
    expect(governance.body(controls.find(item => item.sourceSequence === 6)!))
      .toContain('Sponsor 已要求修改');
    expect(controls.every(item => governance.body(item).length <= 320)).toBe(true);
    expect(controls.some(item => governance.body(item).includes('  '))).toBe(false);
  });

  it('fences an expired delivery owner so only the takeover receipt settles', async () => {
    const fixture = await runningAssignment();
    const repository = new MemoryWorkroomProjectionRepository();
    await new WorkroomProjectionTracer({ journal: fixture.journal, repository, governance })
      .capture(binding(), 'run-1');
    const beforeClaim = await repository.read();
    const first = await repository.claimNext(beforeClaim.revision, 'worker-1', 100, 10);
    const beforeTakeover = await repository.read();
    const takeover = await repository.claimNext(beforeTakeover.revision, 'worker-2', 111, 10);

    await expect(repository.settle(
      (await repository.read()).revision,
      first!.id,
      'worker-1',
      first!.delivery.fence,
      { status: 'sent' },
      112,
    )).rejects.toThrow('stale or not owned');
    await expect(repository.settle(
      (await repository.read()).revision,
      takeover!.id,
      'worker-2',
      takeover!.delivery.fence,
      { status: 'sent' },
      112,
    )).resolves.toMatchObject({
      items: { [takeover!.id]: { delivery: { status: 'sent' } } },
    });
  });
});

function workroomEvent(
  sequence: number,
  type: WorkroomEvent['type'],
  payload: Readonly<Record<string, unknown>>,
): WorkroomEvent {
  return {
    version: 1,
    eventId: `control-event-${sequence}`,
    runId: 'run-1',
    sequence,
    occurredAt: sequence,
    type,
    payload,
  };
}

function binding(
  audience: 'workroom' | 'sponsor_room' = 'workroom',
  routedMember = false,
): WorkroomProjectionBinding {
  return {
    version: 1,
    audience,
    projectId: 'project-1',
    catalogBindingDigest: `sha256:${'a'.repeat(64)}`,
    bindingRevision: 3,
    projectionPolicyRevision: 2,
    conversation: {
      endpoint: { id: 'slack-main', adapter: '@zhin.js/adapter-slack' },
      kind: 'channel',
      id: audience === 'workroom' ? 'project-1-room' : 'project-1-sponsors',
      parent: { kind: 'channel', id: 'workspace-1' },
    },
    orchestrator: {
      principalId: 'agent:orchestrator-1',
      agentDefinitionId: 'software.orchestrator',
      displayName: 'Orchestrator',
      role: 'orchestrator',
    },
    agents: [{
      principalId: 'agent:developer-1',
      agentDefinitionId: 'software.developer',
      displayName: 'Developer',
      role: 'executor',
      ...(routedMember
        ? { messageEndpoint: { id: 'slack-developer', adapter: '@zhin.js/adapter-slack' } }
        : {}),
    }],
  };
}

async function runningAssignment(): Promise<Readonly<{
  journal: MemoryWorkroomJournal;
  kernel: WorkroomKernel;
  ingress: AssignmentObservationIngress;
  envelope: AssignmentExecutionEnvelope;
}>> {
  let eventId = 0;
  const journal = new MemoryWorkroomJournal();
  const kernel = new WorkroomKernel({
    journal,
    now: () => 100,
    createId: () => `event-${eventId += 1}`,
    acceptancePolicy: acceptancePolicy(),
  });
  await kernel.createRun({ projectId: 'project-1', runId: 'run-1', title: 'Projection' });
  await kernel.execute('project-1', 'run-1', {
    type: 'plan_task', taskKey: 'build', title: 'Build', required: true, maxAttempts: 2,
  });
  await kernel.pinTaskAcceptance('project-1', 'run-1', 'build');
  const envelope = createAssignmentExecutionEnvelope({
    projectId: 'project-1',
    runId: 'run-1',
    taskKey: 'build',
    taskRevision: 1,
    assignmentId: 'assignment-1',
    assignmentRevision: 1,
    attempt: 1,
    fence: 7,
    principalId: 'agent:developer-1',
    role: 'executor',
    agentDefinition: { ref: 'agent-definition:developer:1', revision: 1, digest: DIGEST_A },
    plan: { ref: 'workflow-plan:run-1:1', revision: 1, digest: DIGEST_B },
    contextPolicy: { ref: 'context-policy:project-1:1', revision: 1, digest: DIGEST_C },
    factAnchor: { ref: 'workroom-facts:run-1:2', sequence: 2, digest: DIGEST_D },
    capabilitySnapshot: { ref: 'capability:assignment-1:1', revision: 1, digest: DIGEST_E },
    policySnapshot: { ref: 'policy:assignment-1:1', revision: 1, digest: DIGEST_F },
    workspace: {
      leaseRef: 'workspace-lease:assignment-1:1',
      mountRef: 'workspace-mount:assignment-1:1',
      baseRevision: 'base-sha-1',
      fence: 7,
    },
  });
  await kernel.execute('project-1', 'run-1', {
    type: 'claim_task',
    taskKey: 'build',
    assignmentId: 'assignment-1',
    assignmentRevision: 1,
    fence: 7,
    envelopeDigest: envelope.digest,
    owner: 'agent:developer-1',
    role: 'executor',
    leaseExpiresAt: 200,
  });
  await kernel.execute('project-1', 'run-1', {
    type: 'start_assignment', assignmentId: 'assignment-1',
  });
  return { journal, kernel, ingress: new AssignmentObservationIngress({ kernel }), envelope };
}

function acceptancePolicy(): WorkroomAcceptancePolicyDecisionPort {
  return {
    pinContract(input) {
      return {
        version: 1,
        id: `contract:${input.task.key}:${input.task.revision}`,
        revision: 1,
        digest: DIGEST_A,
        taskKey: input.task.key,
        taskRevision: input.task.revision,
        kind: 'task_result',
        criteria: [{ id: 'build', kind: 'deterministic', description: 'Build passes' }],
        requiredEvidence: [],
        policy: { id: 'policy-1', revision: 1, digest: DIGEST_B },
      };
    },
    decide() {
      throw new Error('Acceptance is not exercised by projection tests');
    },
  };
}
