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
    expect(host.list()).toEqual([
      { id: 'test/job', cron: '0 0 9 * * *', description: 'morning' },
    ]);
    dispose();
    expect(host.list()).toEqual([]);
    host.stop();
  });
});
