// 保留内部 import 的原因：该 coordinator 只在 WorkroomHostCoordinator.create 内部构造，缺少 governed payload port 的 fail-closed 路径无法通过公开接口单独触达（host 会先在 persistence/governance 阶段抛错）。
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { describe, expect, it, vi } from 'vitest';
import { WorkroomAcceptanceCoordinator } from '../../../src/plugin-runtime/workroom/acceptance-coordinator.js';

describe('WorkroomAcceptanceCoordinator', () => {
  it('fails closed when the governed acceptance payload port is unavailable', () => {
    expect(() => new WorkroomAcceptanceCoordinator({
      projectRoot: process.cwd(),
      stateRoot: process.cwd(),
      generation: 1,
      signal: new AbortController().signal,
      resources: new Scope(rootPluginId()),
      lifecycle: { add: vi.fn() } as never,
      handoff: { add: vi.fn() } as never,
      runtime: {
        journal: {},
        catalog: {},
        kernel: {},
      } as never,
      profiles: {
        profiles: {},
        acceptanceSource: {},
      } as never,
      governance: {
        bindReportPayloadVerifier: vi.fn(),
      } as never,
      effect: {} as never,
      ephemeralAssignmentContext: {} as never,
    })).toThrow('Governed Workroom Acceptance Projection Payload Port is unavailable');
  });
});
