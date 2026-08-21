import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ActivatableWorkroomJournal,
  DatabaseWorkroomJournal,
  FileWorkroomJournal,
  MemoryWorkroomJournal,
  WorkroomSequenceConflictError,
} from '../../src/workroom/journal.js';
import { WorkroomKernel } from '../../src/workroom/workroom-kernel.js';

function fixture() {
  let now = 100;
  let id = 0;
  const journal = new MemoryWorkroomJournal();
  const kernel = new WorkroomKernel({
    journal,
    now: () => now,
    createId: () => `id-${++id}`,
  });
  return { journal, kernel, setNow: (value: number) => { now = value; } };
}

describe('WorkroomKernel', () => {
  it('keeps execution completion separate from acceptance', async () => {
    const { kernel } = fixture();
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Ship release' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'build', title: 'Build', required: true, maxAttempts: 2,
    });
    await kernel.execute('project-1', 'run-1', {
      type: 'claim_task', taskKey: 'build', assignmentId: 'assignment-1',
      owner: 'builder', role: 'executor', leaseExpiresAt: 200,
    });
    await kernel.execute('project-1', 'run-1', { type: 'start_assignment', assignmentId: 'assignment-1' });
    const awaiting = await kernel.execute('project-1', 'run-1', {
      type: 'complete_execution', assignmentId: 'assignment-1', reportRef: 'report://1',
    });

    expect(awaiting.status).toBe('active');
    expect(awaiting.tasks.build?.status).toBe('awaiting_acceptance');

    const accepted = await kernel.execute('project-1', 'run-1', {
      type: 'accept_task', taskKey: 'build', reportRef: 'report://1',
    });
    expect(accepted.tasks.build?.status).toBe('accepted');
    expect(accepted.status).toBe('completed');
  });

  it('creates a new task revision after rejected execution', async () => {
    const { kernel } = fixture();
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Review' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'draft', title: 'Draft', required: true, maxAttempts: 1,
    });
    await kernel.execute('project-1', 'run-1', {
      type: 'claim_task', taskKey: 'draft', assignmentId: 'assignment-1',
      owner: 'writer', role: 'executor', leaseExpiresAt: 200,
    });
    await kernel.execute('project-1', 'run-1', { type: 'start_assignment', assignmentId: 'assignment-1' });
    await kernel.execute('project-1', 'run-1', {
      type: 'complete_execution', assignmentId: 'assignment-1', reportRef: 'report://1',
    });

    const rework = await kernel.execute('project-1', 'run-1', {
      type: 'request_rework', taskKey: 'draft', reason: 'missing evidence',
    });
    expect(rework.tasks.draft).toMatchObject({ status: 'ready', revision: 2, attempt: 0 });
  });

  it('recovers an expired lease without accepting its result', async () => {
    const { kernel, setNow } = fixture();
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Research' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'research', title: 'Research', required: true, maxAttempts: 2,
    });
    await kernel.execute('project-1', 'run-1', {
      type: 'claim_task', taskKey: 'research', assignmentId: 'assignment-1',
      owner: 'researcher', role: 'executor', leaseExpiresAt: 120,
    });
    await kernel.execute('project-1', 'run-1', { type: 'start_assignment', assignmentId: 'assignment-1' });
    setNow(121);

    const recovered = await kernel.execute('project-1', 'run-1', { type: 'advance_clock', now: 121 });
    expect(recovered.assignments['assignment-1']?.status).toBe('lost');
    expect(recovered.tasks.research).toMatchObject({ status: 'ready', attempt: 1 });
  });

  it('revises a failed required task out of needs_replan', async () => {
    const { kernel, setNow } = fixture();
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Recover' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'build', title: 'Build', required: true, maxAttempts: 1,
    });
    await kernel.execute('project-1', 'run-1', {
      type: 'claim_task', taskKey: 'build', assignmentId: 'assignment-1',
      owner: 'builder', role: 'executor', leaseExpiresAt: 120,
    });
    setNow(121);
    const exhausted = await kernel.execute('project-1', 'run-1', { type: 'advance_clock', now: 121 });
    expect(exhausted.status).toBe('needs_replan');

    const revised = await kernel.execute('project-1', 'run-1', {
      type: 'revise_task', taskKey: 'build', title: 'Build safely', reason: 'new plan', maxAttempts: 2,
    });
    expect(revised.status).toBe('active');
    expect(revised.tasks.build).toMatchObject({ status: 'ready', revision: 2, maxAttempts: 2 });
  });

  it('rejects cross-Project reads and commands even with a valid run id', async () => {
    const { kernel } = fixture();
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Scoped' });
    await expect(kernel.read('project-2', 'run-1')).rejects.toThrow('does not belong');
    await expect(kernel.execute('project-2', 'run-1', {
      type: 'plan_task', taskKey: 'escape', title: 'Escape', required: true, maxAttempts: 1,
    })).rejects.toThrow('does not belong');
  });

  it('settles cancellation after an executor misses its control deadline', async () => {
    const { kernel } = fixture();
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'Cancel' });
    await kernel.execute('project-1', 'run-1', {
      type: 'plan_task', taskKey: 'write', title: 'Write', required: true, maxAttempts: 2,
    });
    await kernel.execute('project-1', 'run-1', {
      type: 'claim_task', taskKey: 'write', assignmentId: 'assignment-1',
      owner: 'writer', role: 'executor', leaseExpiresAt: 200,
    });
    await kernel.execute('project-1', 'run-1', { type: 'start_assignment', assignmentId: 'assignment-1' });
    await kernel.execute('project-1', 'run-1', { type: 'cancel_run', reason: 'stop', controlDeadline: 130 });

    const cancelled = await kernel.execute('project-1', 'run-1', { type: 'advance_clock', now: 131 });
    expect(cancelled.assignments['assignment-1']).toMatchObject({
      status: 'cancelled', outcome: 'outcome_unknown',
    });
    expect(cancelled.tasks.write?.status).toBe('cancelled');
    expect(cancelled.status).toBe('cancelled');
  });

  it('rejects concurrent append against a stale sequence', async () => {
    const { journal, kernel } = fixture();
    await kernel.createRun({ runId: 'run-1', projectId: 'project-1', title: 'CAS' });

    await expect(journal.append('run-1', -1, [])).rejects.toEqual(
      new WorkroomSequenceConflictError('run-1', -1, 0),
    );
  });

  it('rejects unknown or malformed persisted event facts', async () => {
    const rows = [{
      run_id: 'run-bad', sequence: 0, version: 1, type: 'run.teleported',
      payload_json: JSON.stringify({ eventId: 'bad', payload: {} }), occurred_at: 100,
    }];
    const journal = new DatabaseWorkroomJournal({
      transaction: async (operation: (transaction: any) => Promise<unknown>) => operation({
        select: () => ({ where: async () => rows }),
        insertMany: async () => undefined,
      }),
    }, { select: () => ({ where: async () => rows }) });
    await expect(journal.read('run-bad')).rejects.toThrow('Invalid Workroom event payload envelope');
  });

  it('persists a contiguous journal in one serializable transaction', async () => {
    const rows: Record<string, unknown>[] = [];
    const where = async ({ run_id }: Record<string, unknown>) =>
      run_id === undefined ? rows : rows.filter(row => row.run_id === run_id);
    const database = {
      transaction: async <T>(operation: (transaction: any) => Promise<T>, options: unknown) => {
        expect(options).toEqual({ isolationLevel: 'SERIALIZABLE' });
        return operation({
          select: () => ({ where }),
          insertMany: async (_table: string, inserted: Record<string, unknown>[]) => {
            rows.push(...inserted);
          },
        });
      },
    };
    const journal = new DatabaseWorkroomJournal(database, { select: () => ({ where }) });
    const kernel = new WorkroomKernel({
      journal,
      now: () => 100,
      createId: (() => {
        let id = 0;
        return () => `db-${++id}`;
      })(),
    });

    await kernel.createRun({ runId: 'run-db', projectId: 'project-db', title: 'Persisted' });
    await expect(journal.append('run-db', -1, [])).rejects.toEqual(
      new WorkroomSequenceConflictError('run-db', -1, 0),
    );
    const state = await kernel.execute('project-db', 'run-db', {
      type: 'plan_task', taskKey: 'task', title: 'Task', required: true, maxAttempts: 1,
    });

    expect(state.sequence).toBe(1);
    expect(rows.map(row => row.id)).toEqual(['run-db:0', 'run-db:1']);
    expect(await kernel.read('project-db', 'run-db')).toEqual(state);
    expect(await kernel.list('project-db')).toEqual([state]);
  });

  it('fails closed until the candidate activates exactly one journal', async () => {
    const journal = new ActivatableWorkroomJournal();
    const kernel = new WorkroomKernel({ journal });
    await expect(kernel.createRun({ projectId: 'project', title: 'inactive' }))
      .rejects.toThrow('Workroom journal is not active');

    journal.activate(new MemoryWorkroomJournal());
    await expect(kernel.createRun({ runId: 'active', projectId: 'project', title: 'active' }))
      .resolves.toMatchObject({ runId: 'active' });
    expect(() => journal.activate(new MemoryWorkroomJournal())).toThrow('already active');
  });

  it('atomically persists and replays file-backed runs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-workroom-'));
    try {
      const first = new WorkroomKernel({
        journal: new FileWorkroomJournal(directory),
        now: () => 100,
        createId: (() => { let id = 0; return () => `file-${++id}`; })(),
      });
      await first.createRun({ runId: 'file-run', projectId: 'file-project', title: 'File' });
      await first.execute('file-project', 'file-run', {
        type: 'plan_task', taskKey: 'task', title: 'Task', required: true, maxAttempts: 1,
      });

      const restarted = new WorkroomKernel({ journal: new FileWorkroomJournal(directory) });
      expect(await restarted.read('file-project', 'file-run')).toMatchObject({ sequence: 1, projectId: 'file-project' });
      expect((await restarted.list('file-project')).map(run => run.runId)).toEqual(['file-run']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('enforces file CAS across generation journal instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-workroom-cas-'));
    try {
      const first = new FileWorkroomJournal(directory);
      const second = new FileWorkroomJournal(directory);
      const create = {
        eventId: 'create',
        occurredAt: 100,
        type: 'run.created' as const,
        payload: { projectId: 'project', title: 'Run' },
      };
      await first.append('shared-run', -1, [create]);
      const draft = (eventId: string) => ({
        eventId,
        occurredAt: 101,
        type: 'task.planned' as const,
        payload: { taskKey: eventId, title: eventId, required: true, maxAttempts: 1 },
      });

      const settled = await Promise.allSettled([
        first.append('shared-run', 0, [draft('left')]),
        second.append('shared-run', 0, [draft('right')]),
      ]);

      expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = settled.find(result => result.status === 'rejected');
      expect(rejected).toMatchObject({ reason: expect.any(WorkroomSequenceConflictError) });
      const events = await first.read('shared-run');
      expect(events.map(event => event.sequence)).toEqual([0, 1]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

});
