import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { describe, expect, it, vi } from 'vitest';
import { WorkroomHumanIngressCoordinator } from '../../../src/plugin-runtime/workroom/human-ingress-coordinator.js';

describe('WorkroomHumanIngressCoordinator', () => {
  it('rejects an aborted generation before creating ingress repositories or timers', async () => {
    const controller = new AbortController();
    controller.abort(new Error('generation replaced'));
    const lifecycle = { add: vi.fn() };

    await expect(WorkroomHumanIngressCoordinator.create({
      signal: controller.signal,
      resources: new Scope(rootPluginId()),
      lifecycle: lifecycle as never,
      im: {} as never,
      runtime: {} as never,
      profiles: {} as never,
      persistence: {} as never,
      execution: {} as never,
      resolveDataLifecycleControl: () => undefined,
    })).rejects.toThrow('generation replaced');
    expect(lifecycle.add).not.toHaveBeenCalled();
  });
});
