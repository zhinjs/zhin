import { workroomAssignmentAuthorityGrantRepositoryToken } from '@zhin.js/agent/runtime';
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { describe, expect, it, vi } from 'vitest';
import { WorkroomAssignmentCoordinator } from '../../../src/plugin-runtime/workroom/assignment-coordinator.js';

describe('WorkroomAssignmentCoordinator', () => {
  it('rejects an aborted generation before publishing Assignment resources', () => {
    const controller = new AbortController();
    controller.abort(new Error('generation replaced'));
    const resources = new Scope(rootPluginId());

    expect(() => new WorkroomAssignmentCoordinator({
      projectRoot: process.cwd(),
      generation: 1,
      signal: controller.signal,
      resources,
      lifecycle: { add: vi.fn() } as never,
      handoff: { add: vi.fn() } as never,
      snapshots: {} as never,
      ingress: {} as never,
      agent: {} as never,
      runtime: {} as never,
      profiles: {} as never,
      persistence: {} as never,
      acceptance: {} as never,
    })).toThrow('generation replaced');
    expect(resources.has(workroomAssignmentAuthorityGrantRepositoryToken)).toBe(false);
  });
});
