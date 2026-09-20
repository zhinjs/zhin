import { CalendarScheduler } from '../src/scheduler.js';

describe('CalendarScheduler job identity', () => {
  it('does not replace an explicit job when generating an automatic id', () => {
    const scheduler = new CalendarScheduler();

    const explicit = scheduler.solar(
      '0 0 9 * * *',
      () => undefined,
      'explicit',
      { id: 'job-1' },
    );
    const generated = scheduler.solar('0 0 10 * * *', () => undefined, 'generated');

    expect(explicit.id).toBe('job-1');
    expect(generated.id).toMatch(/^job-[0-9a-f-]{36}$/);
    expect(generated.id).not.toBe(explicit.id);
    expect(scheduler.list()).toHaveLength(2);

    scheduler.stop();
  });
});
