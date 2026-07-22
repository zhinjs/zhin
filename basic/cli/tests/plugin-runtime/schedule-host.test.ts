import { describe, expect, it, vi } from 'vitest';
import { createScheduleHost } from '../../src/plugin-runtime/schedule-host-installer.js';

describe('ScheduleHost', () => {
  it('registers and lists solar cron jobs', () => {
    const host = createScheduleHost();
    const execute = vi.fn();
    const dispose = host.register({
      id: 'test/job',
      cron: '0 0 9 * * *',
      description: 'morning',
      execute,
    });
    const listed = host.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: 'test/job',
      cron: '0 0 9 * * *',
      description: 'morning',
      expression: '0 0 9 * * *',
      running: true,
      plugin: 'test',
    });
    expect(typeof listed[0]!.nextExecution).toBe('number');
    dispose();
    expect(host.list()).toEqual([]);
    host.stop();
  });
});
