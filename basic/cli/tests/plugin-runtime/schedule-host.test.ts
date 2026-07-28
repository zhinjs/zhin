import { describe, expect, it, vi } from 'vitest';
import {
  DisposeStack,
  GenerationHandoffStack,
  Scope,
  rootPluginId,
  scheduleHostToken,
} from '@zhin.js/plugin-runtime';
import type { RootResourceContext } from '@zhin.js/runtime';
import {
  createScheduleHost,
  installScheduleHost,
} from '../../src/plugin-runtime/schedule-host-installer.js';

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

  it('does not let a retired generation cancel its replacement', () => {
    const host = createScheduleHost();
    const disposePrevious = host.register({
      id: 'test/job',
      cron: '0 0 9 * * *',
      execute: vi.fn(),
    });
    const disposeCurrent = host.register({
      id: 'test/job',
      cron: '0 30 9 * * *',
      execute: vi.fn(),
    });

    disposePrevious();
    expect(host.list()).toMatchObject([{
      id: 'test/job',
      cron: '0 30 9 * * *',
    }]);

    disposeCurrent();
    expect(host.list()).toEqual([]);
    host.stop();
  });

  it('does not stop a borrowed process host with a generation lifecycle', async () => {
    const host = createScheduleHost();
    const context = createInstallContext();

    installScheduleHost(host)(context);
    expect(context.resources.use(scheduleHostToken)).toBe(host);
    await context.lifecycle.dispose();

    const dispose = host.register({
      id: 'test/after-generation-retire',
      cron: '0 0 9 * * *',
      execute: vi.fn(),
    });
    dispose();
    host.stop();
  });

  it('stops a host owned by the generation lifecycle', async () => {
    const context = createInstallContext();

    installScheduleHost()(context);
    const host = context.resources.use(scheduleHostToken);
    await context.lifecycle.dispose();

    expect(() => host.register({
      id: 'test/after-stop',
      cron: '0 0 9 * * *',
      execute: vi.fn(),
    })).toThrow('Scheduler has been stopped');
  });
});

function createInstallContext(): RootResourceContext {
  return {
    resources: new Scope(rootPluginId()),
    lifecycle: new DisposeStack(),
    handoff: new GenerationHandoffStack(),
    // The installer does not consume config; keep this fixture focused on
    // concrete resource and lifecycle implementations.
    config: {} as RootResourceContext['config'],
  };
}
