import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScheduleExecutionFixture as fixture, scheduleFixtureJob as job, createFixtureFileWriter } from '../helpers/schedule-execution-fixture.js';

describe('schedule whole-task replay safety through actual tool admission', () => {
  it('does not repeat an unclassified actual operation when the model later fails', async () => {
    const f = fixture({ failAfterTool: true });
    try {
      const result = await f.worker.run(job);
      expect(f.effects()).toBe(1); expect(f.turns()).toBe(1);
      expect(result).toMatchObject({ success: false, error: 'Model continuation failed',
        toolsUsed: ['fixture_tool'], tokenUsage: { input: 12, output: 3 }, replay: { disposition: 'unknown' } });
    } finally { await f.worker.stop(); await f.executor.dispose(); }
  });

  it('retries a formally read-only attempt within the unchanged budget, with separate attempt identities', async () => {
    const f = fixture({ readOnly: true, failAfterTool: true });
    try {
      expect(await f.worker.run(job)).toMatchObject({ success: true, replay: { disposition: 'safe' } });
      expect(f.turns()).toBe(2);
      const started = f.events.filter(event => event.type === 'attempt_started');
      expect(started).toHaveLength(2);
      expect(started[0]!.attempt.runId).toBe(started[1]!.attempt.runId);
      expect(started[0]!.attempt.attemptId).not.toBe(started[1]!.attempt.attemptId);
      expect(started.map(event => event.attempt.number)).toEqual([1, 2]);
    } finally { await f.worker.stop(); await f.executor.dispose(); }
  });

  it('keeps a confirmed actual file mutation when a later model step fails', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'zhin-replay-file-'));
    const tool = createFixtureFileWriter();
    const f = fixture({ tool, workspace, failAfterTool: true });
    try {
      const result = await f.worker.run(job);
      expect(result.replay?.disposition).toBe('committed');
      expect(f.turns()).toBe(1);
      expect(await readFile(join(workspace, 'result.txt'), 'utf8')).toBe('Confirmed filesystem mutation');
    } finally { await f.worker.stop(); await f.executor.dispose(); await rm(workspace, { recursive: true, force: true }); }
  });

  it('preserves a confirmed file write and late result when the owner stops an in-flight continuation', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'zhin-replay-stop-'));
    const tool = createFixtureFileWriter();
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const f = fixture({ tool, workspace, afterTool: async () => { entered(); await blocked; } });
    const pending = f.worker.run(job);
    try {
      await waiting;
      const stopping = f.worker.stop();
      release();
      const result = await pending;
      expect(result).toMatchObject({ success: false, status: 'cancelled', output: 'Final output',
        tokenUsage: { input: 12, output: 3 }, replay: { disposition: 'committed' } });
      expect(f.turns()).toBe(1);
      expect(await readFile(join(workspace, 'result.txt'), 'utf8')).toBe('Confirmed filesystem mutation');
      await stopping;
    } finally { release(); await f.worker.stop(); await f.executor.dispose(); await rm(workspace, { recursive: true, force: true }); }
  });

  it.each(['auditFailure', 'activityFailure', 'historyFailure'] as const)('does not rerun completed business work when %s fails', async failure => {
    const f = fixture({ [failure]: true });
    try {
      expect(await f.worker.run(job)).toMatchObject({ success: true, output: 'Final output' });
      expect(f.effects()).toBe(1); expect(f.turns()).toBe(1);
    } finally { await f.worker.stop(); await f.executor.dispose(); }
  });

  it('keeps actual-call evidence when the required result journal fails after an operation', async () => {
    const f = fixture({ journalFailure: true });
    try {
      expect(await f.worker.run(job)).toMatchObject({ success: false, replay: { disposition: 'unknown' },
        error: 'required journal unavailable' });
      expect(f.effects()).toBe(1); expect(f.turns()).toBe(1);
    } finally { await f.worker.stop(); await f.executor.dispose(); }
  });
});
