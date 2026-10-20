import { CalendarScheduler } from '../src/scheduler.js';
import type { JobStore, StoredJob } from '../src/store/types.js';

it('reserves a job before claiming across timer and reconciliation, retaining its lease until execution completes', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
  let record: StoredJob | undefined;
  let acceptClaim!: (claimed: boolean) => void;
  let finishHandler!: () => void;
  const claim = vi.fn(() => new Promise<boolean>(resolve => { acceptClaim = resolve; }));
  const release = vi.fn(async () => {});
  const handler = vi.fn(() => new Promise<void>(resolve => { finishHandler = resolve; }));
  const store: JobStore = {
    load: async () => [], upsert: async value => { record = value; }, remove: async () => {},
    listDue: async () => record ? [record] : [], claim, release,
  };
  const scheduler = new CalendarScheduler({ store, timezone: 'UTC', reconcileIntervalMs: 1000 });
  try {
    await scheduler.ready; scheduler.registerHandler('fixture', handler);
    const job = scheduler.solar('* * * * * *', handler, 'fixture');
    await vi.advanceTimersByTimeAsync(6000);
    expect(claim).toHaveBeenCalledTimes(1); expect(release).not.toHaveBeenCalled();
    acceptClaim(true); await vi.advanceTimersByTimeAsync(3000);
    expect(handler).toHaveBeenCalledTimes(1); expect(claim).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    job.cancel(); finishHandler(); await vi.advanceTimersByTimeAsync(0);
    expect(release).toHaveBeenCalledTimes(1);
  } finally { scheduler.stop(); vi.useRealTimers(); }
});

it.each(['stop', 'cancel', 'pause'])('does not execute a job when %s occurs while a store claim is pending', async action => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
  let release!: (claimed: boolean) => void;
  const claim = vi.fn(() => new Promise<boolean>(done => { release = done; }));
  const released = vi.fn(async () => {});
  const store: JobStore = { load: async () => [], upsert: async () => {}, remove: async () => {}, listDue: async () => [], claim, release: released };
  const scheduler = new CalendarScheduler({ store, timezone: 'UTC' });
  const handler = vi.fn();
  try {
    await scheduler.ready;
    scheduler.registerHandler('fixture', handler);
    const job = scheduler.solar('* * * * * *', handler, 'fixture');
    await vi.advanceTimersByTimeAsync(3000);
    expect(claim).toHaveBeenCalledTimes(1);
    if (action === 'stop') scheduler.stop(); else if (action === 'cancel') job.cancel(); else scheduler.pause(job.id);
    release(true); await vi.advanceTimersByTimeAsync(0);
    expect(handler).not.toHaveBeenCalled(); expect(released).toHaveBeenCalledTimes(1);
  } finally { scheduler.stop(); vi.useRealTimers(); }
});
it('owns rejected store claims and reports the failure without dispatching', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
  const error = new Error('fixture store unavailable'); const onError = vi.fn(); const handler = vi.fn();
  const store: JobStore = { load: async () => [], upsert: async () => {}, remove: async () => {}, listDue: async () => [], claim: async () => { throw error; } };
  const scheduler = new CalendarScheduler({ store, timezone: 'UTC', onError });
  try {
    await scheduler.ready; scheduler.registerHandler('fixture', handler); scheduler.solar('* * * * * *', handler, 'fixture');
    await vi.advanceTimersByTimeAsync(3000);
    expect(handler).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledWith(error, expect.objectContaining({ id: expect.any(String) }));
  } finally { scheduler.stop(); vi.useRealTimers(); }
});
