import { workroomEffectRuntimeToken } from '@zhin.js/agent/runtime';
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { describe, expect, it, vi } from 'vitest';
import { WorkroomEffectCoordinator } from '../../../src/plugin-runtime/workroom/effect-coordinator.js';

describe('WorkroomEffectCoordinator', () => {
  it('rejects an aborted generation before publishing Effect resources', () => {
    const controller = new AbortController();
    controller.abort(new Error('generation replaced'));
    const resources = new Scope(rootPluginId());
    const lifecycle = { add: vi.fn() };
    const handoff = { add: vi.fn() };

    expect(() => new WorkroomEffectCoordinator({
      projectRoot: process.cwd(),
      generation: 1,
      signal: controller.signal,
      resources,
      lifecycle: lifecycle as never,
      handoff: handoff as never,
      runtime: {} as never,
    })).toThrow('generation replaced');
    expect(resources.has(workroomEffectRuntimeToken)).toBe(false);
    expect(lifecycle.add).not.toHaveBeenCalled();
    expect(handoff.add).not.toHaveBeenCalled();
  });
});
