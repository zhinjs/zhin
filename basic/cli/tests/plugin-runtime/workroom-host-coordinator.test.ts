import { workroomEffectRuntimeToken } from '@zhin.js/agent/runtime';
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { describe, expect, it } from 'vitest';
import { WorkroomHostCoordinator } from '../../src/plugin-runtime/workroom-host-coordinator.js';

describe('WorkroomHostCoordinator', () => {
  it('rejects an aborted generation before composing Workroom resources', async () => {
    const controller = new AbortController();
    controller.abort(new Error('generation replaced'));
    const resources = new Scope(rootPluginId());

    await expect(WorkroomHostCoordinator.create({
      projectRoot: process.cwd(),
      generation: 1,
      signal: controller.signal,
      resources,
      lifecycle: {} as never,
      handoff: {} as never,
      config: {},
      storageMode: 'file',
      im: {} as never,
      foundation: {} as never,
      agent: {} as never,
      publication: {} as never,
    })).rejects.toThrow('generation replaced');
    expect(resources.has(workroomEffectRuntimeToken)).toBe(false);
  });
});
