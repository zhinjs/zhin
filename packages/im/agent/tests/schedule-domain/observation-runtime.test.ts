import { ScheduleExecutionHistory, type ScheduleHistoryRepository } from '../../src/schedule-domain/execution-history-store.js';
import { createScheduleExecutionFixture, scheduleFixtureJob } from '../helpers/schedule-execution-fixture.js';
import { createTaskExecutor } from '../../src/task-executor.js';
import { createNotificationRouter } from '../../src/assistant/notification-router.js';
import { ScheduleExecutionDomainImpl } from '../../src/schedule-domain/execution-domain.js';
import { DEFAULT_CONFIG } from '../../src/config/index.js';

describe('schedule observation IO stays outside business execution', () => {
  it('keeps direct Domain audit IO nonblocking and closes only its owned observation channel', async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const write = vi.fn(async () => { enter(); await blocked; });
    const domain = new ScheduleExecutionDomainImpl({ config: DEFAULT_CONFIG, auditLogger: { write },
      turn: { execute: async () => ({ status: 'completed', output: [{ type: 'text', content: 'Direct result' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) } });
    try {
      expect(await domain.execute(scheduleFixtureJob)).toMatchObject({ success: true, output: 'Direct result' });
      await entered;
      expect(domain.dispose()).toBeUndefined();
      expect(write).toHaveBeenCalledTimes(1);
    } finally { domain.dispose(); release(); }

    const borrowed = new ScheduleExecutionHistory();
    const close = vi.spyOn(borrowed, 'close');
    const other = new ScheduleExecutionDomainImpl({ config: DEFAULT_CONFIG, observations: borrowed,
      turn: { execute: async () => ({ status: 'completed', output: [{ type: 'text', content: 'Borrowed result' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) } });
    await other.execute(scheduleFixtureJob);
    other.dispose();
    expect(close).not.toHaveBeenCalled();
    borrowed.close();
  });
  it.each(['history', 'audit', 'activity'] as const)('keeps business and borrowed-owner disposal independent of hung %s IO', async sink => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const hang = vi.fn(async () => { enter(); await blocked; });
    const repository: ScheduleHistoryRepository = { save: sink === 'history' ? hang : async () => {},
      read: async () => undefined, page: async () => [], prune: async () => 0 };
    const owner = new ScheduleExecutionHistory({ repository,
      auditLogger: { write: sink === 'audit' ? hang : async () => {} },
      activity: { publish: sink === 'activity' ? hang : async () => {} } });
    const close = vi.spyOn(owner, 'close');
    const f = createScheduleExecutionFixture({ observations: owner });
    let result: Awaited<ReturnType<typeof f.worker.run>> | undefined;
    const pending = f.worker.run(scheduleFixtureJob).then(value => { result = value; return value; });
    try {
      await entered;
      await vi.waitFor(() => expect(result?.success).toBe(true));
      expect(result?.output).toBe('Final output');
      expect(f.turns()).toBe(1); expect(f.effects()).toBe(1);
      await f.dispose();
      expect(close).not.toHaveBeenCalled();
      owner.close();
      expect(close).toHaveBeenCalledTimes(1);
      expect(hang).toHaveBeenCalledTimes(1);
      await pending;
    } finally { owner.close(); release(); await f.dispose(); }
  });

  it('closes an owned standalone observation owner without waiting for a hung activity handler', async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const executor = createTaskExecutor({ domain: { execute: async () => ({ success: true, output: 'Completed',
      durationMs: 1, toolsUsed: [], tokenUsage: { input: 1, output: 1 }, audit: {} as never }) },
      activity: { publish: async () => { enter(); await blocked; } },
      router: createNotificationRouter({ resolveAdapter: () => undefined }) });
    const close = vi.spyOn(executor.observations, 'close');
    let completed = false;
    const pending = executor.execute(scheduleFixtureJob).then(result => { completed = true; return result; });
    try {
      await entered;
      await vi.waitFor(() => expect(completed).toBe(true));
      expect(await pending).toMatchObject({ success: true, output: 'Completed' });
      await executor.dispose();
      expect(close).toHaveBeenCalledTimes(1);
    } finally { release(); await executor.dispose(); }
  });
});
