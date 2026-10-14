// 保留内部 import 的原因：该 coordinator 只在 Host 内部构造，Root 权限与 Console Pack 发布路径无法通过公开接口单独触达。
import { WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL } from '@zhin.js/workroom';
import { describe, expect, it } from 'vitest';
import { WorkroomPlanningCoordinator } from '../../../src/plugin-runtime/workroom/planning-coordinator.js';

describe('WorkroomPlanningCoordinator', () => {
  it('keeps control-plane Root authority outside the Console Pack publication path', async () => {
    const coordinator = new WorkroomPlanningCoordinator({
      config: {} as never,
      generation: 1,
      signal: new AbortController().signal,
      snapshots: {} as never,
      service: {} as never,
      runtime: {} as never,
      profiles: {} as never,
      governance: {} as never,
      listBindings: () => [],
    });

    await expect(coordinator.consoleControl.publishPack(
      {} as never,
      { principalId: WORKROOM_CONTROL_PLANE_ROOT_PRINCIPAL },
    )).rejects.toThrow('Control-plane Root Pack bootstrap is not exposed through Console HTTP');
  });
});
