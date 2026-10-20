// 保留内部 import 的原因：该 coordinator 只在 Host 内部构造，aborted 路径无法通过公开接口单独触达（host 先在更靠前的 coordinator 处抛错）。
import { workroomAssignmentAuthorityGrantRepositoryToken } from '@zhin.js/workroom';
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
