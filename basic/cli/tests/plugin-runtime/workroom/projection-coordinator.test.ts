// 保留内部 import 的原因：该 coordinator 只在 Host 内部构造，缺少 outbound message port 的路径无法通过公开接口单独触达。
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { describe, expect, it, vi } from 'vitest';
import { WorkroomProjectionCoordinator } from '../../../src/plugin-runtime/workroom/projection-coordinator.js';

describe('WorkroomProjectionCoordinator', () => {
  it('fails before creating projection state when the outbound message port is unavailable', () => {
    expect(() => new WorkroomProjectionCoordinator({
      stateRoot: process.cwd(),
      resources: new Scope(rootPluginId()),
      lifecycle: { add: vi.fn() } as never,
      handoff: { add: vi.fn() } as never,
      im: {} as never,
      runtime: {} as never,
      governance: {} as never,
    })).toThrow('Workroom Projection requires the generation-owned Outbound Message Port');
  });
});
