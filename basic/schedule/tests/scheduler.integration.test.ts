import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarScheduler } from '../src/scheduler.js';

describe('CalendarScheduler integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-27T08:59:00+08:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires handler at scheduled solar time', async () => {
    const handler = vi.fn();
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });

    scheduler.solar('0 0 9 * * *', handler);

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      kind: 'solar',
      solarText: '2025年6月27日',
    });

    scheduler.stop();
  });

  it('fires handler on */15 minute cron', async () => {
    const handler = vi.fn();
    vi.setSystemTime(new Date('2025-06-27T10:14:00+08:00'));
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });

    scheduler.solar('0 */15 * * * *', handler);

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].scheduledAt.getTime()).toBe(
      new Date('2025-06-27T10:15:00+08:00').getTime(),
    );

    scheduler.stop();
  });

  it('fires holiday handler at scheduled time', async () => {
    const handler = vi.fn();
    vi.setSystemTime(new Date('2024-10-01T08:00:00+08:00'));
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });

    scheduler.holiday({ cron: '0 0 9 * * *', festivals: ['国庆节'] }, handler);

    await vi.advanceTimersByTimeAsync(3_600_000);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].kind).toBe('holiday');
    expect(handler.mock.calls[0][0].festival).toBe('国庆节');
    expect(handler.mock.calls[0][0].solarText).toBe('2024年10月1日');

    scheduler.stop();
  });

  it('cancel prevents future runs', async () => {
    const handler = vi.fn();
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });

    const job = scheduler.solar('0 0 9 * * *', handler);
    job.cancel();

    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(handler).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('fires workday handler on makeup Sunday', async () => {
    const handler = vi.fn();
    vi.setSystemTime(new Date('2024-09-29T08:00:00+08:00'));
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });

    scheduler.workday('0 0 9 * * *', handler);

    await vi.advanceTimersByTimeAsync(3_600_000);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].kind).toBe('workday');
    scheduler.stop();
  });

  it('fires freeDay handler on weekend', async () => {
    const handler = vi.fn();
    vi.setSystemTime(new Date('2024-09-21T08:00:00+08:00'));
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });

    scheduler.freeDay('0 0 9 * * *', handler);

    await vi.advanceTimersByTimeAsync(3_600_000);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].kind).toBe('freeDay');
    scheduler.stop();
  });

  it('fires lunar handler on scheduled lunar date', async () => {
    const handler = vi.fn();
    vi.setSystemTime(new Date('2025-01-29T08:00:00+08:00'));
    const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });

    scheduler.lunar('0 0 9 1 1 *', handler);

    await vi.advanceTimersByTimeAsync(3_600_000);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].kind).toBe('lunar');
    expect(handler.mock.calls[0][0].lunarText).toContain('年');
    scheduler.stop();
  });
});
