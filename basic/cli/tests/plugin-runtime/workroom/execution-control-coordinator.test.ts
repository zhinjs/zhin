// 保留内部 import 的原因：该 coordinator 只在 Host 内部构造，缺少 durable Portfolio 仓库的路径无法通过公开接口单独触达。
import { workroomSchedulerRuntimeToken } from '@zhin.js/workroom/scheduler';
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { describe, expect, it, vi } from 'vitest';
import { WorkroomExecutionControlCoordinator } from '../../../src/plugin-runtime/workroom/execution-control-coordinator.js';

describe('WorkroomExecutionControlCoordinator', () => {
  it('requires durable Portfolio repositories before starting execution control', () => {
    const resources = new Scope(rootPluginId());

    expect(() => new WorkroomExecutionControlCoordinator({
      generation: 1,
      signal: new AbortController().signal,
      resources,
      lifecycle: { add: vi.fn() } as never,
      handoff: { add: vi.fn() } as never,
      stateRoot: process.cwd(),
      runtime: {} as never,
      governance: {} as never,
      portfolioCapacity: {} as never,
      dispatch: {} as never,
    })).toThrow('Workroom Execution Control requires durable Portfolio repositories');
    expect(resources.has(workroomSchedulerRuntimeToken)).toBe(false);
  });
});
