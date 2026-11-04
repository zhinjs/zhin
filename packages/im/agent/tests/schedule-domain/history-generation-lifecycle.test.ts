import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RootController, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { FileScheduleHistoryRepository } from '../../src/schedule-domain/execution-history-file.js';
import { ScheduleExecutionHistory } from '../../src/schedule-domain/execution-history-store.js';
import type { ScheduleRunContext } from '../../src/schedule-domain/execution-history.js';

const snapshot = (): SnapshotState => ({ root: rootPluginId(), tree: new Map(), config: new Map(),
  resources: new Map(), capabilities: new Map(), projections: new Map() });

describe('schedule history across generation retirement', () => {
  it('keeps an expired old-generation run while its real snapshot lease still owns execution', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhin-schedule-generation-'));
    const repository = new FileScheduleHistoryRepository(directory);
    const now = Date.UTC(2026, 2, 31);
    const queuedAt = Date.UTC(2026, 0, 15);
    const old = new ScheduleExecutionHistory({ repository, now: () => now, ownerStartedAt: 100, secrets: [] });
    // A replacement owner has no knowledge of the old owner's pending map.
    const next = new ScheduleExecutionHistory({ repository: new FileScheduleHistoryRepository(directory),
      now: () => now, ownerStartedAt: 100, secrets: [] });
    const root = new RootController(snapshot());
    let oldDisposed = false;
    let retained: ReturnType<typeof root.snapshots.acquire> | undefined;
    const run: ScheduleRunContext = { runId: 'old-active', jobId: 'job', queuedAt, source: 'manual', job: {
      id: 'job', enabled: true, schedule: { kind: 'at', atMs: queuedAt },
      action: { kind: 'agent', prompt: 'Synthetic work that still owns its generation.' }, notify: { channel: 'silent' },
      createdAt: queuedAt, updatedAt: queuedAt, state: {},
    } };
    try {
      await root.start(async () => ({ snapshot: snapshot(), dispose: () => { oldDisposed = true; old.close(); } }));
      retained = root.snapshots.acquire();
      old.observe({ type: 'run_queued', run });
      old.observe({ type: 'attempt_started', attempt: { runId: run.runId, jobId: run.jobId,
        attemptId: 'old-attempt', number: 1, startedAt: queuedAt } });
      await old.drain();
      expect((await repository.read({ runId: run.runId }))?.status).toBe('running');

      await root.reload(rootPluginId(), async () => ({ snapshot: snapshot(), dispose: () => next.close(), handoff: {
        activateNext: async () => {
          // This is the real transaction order: candidate activation precedes old disposal.
          expect(oldDisposed).toBe(false);
          expect(await next.cleanup()).toMatchObject({ deleted: 0 });
        },
        deactivateNext: () => {},
      } }));

      expect(root.generation).toBe(2);
      expect(retained.value.generation).toBe(1);
      expect(oldDisposed).toBe(false);
      expect((await old.read({ runId: run.runId }))?.status).toBe('running');
      expect((await repository.read({ runId: run.runId }))?.status).toBe('running');
      // The new owner cannot claim this older in-process execution is running or interrupted.
      expect((await next.read({ runId: run.runId }))?.status).toBe('unsettled');
    } finally {
      retained?.release();
      await root.stop();
      old.close(); next.close();
      await rm(directory, { recursive: true, force: true });
    }
    expect(oldDisposed).toBe(true);
  });
});
