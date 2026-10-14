// 保留内部 import 的原因：该 coordinator 只在 Host 内部构造，aborted 路径无法通过公开接口单独触达。
import {
  workroomAssignmentKnowledgeContextToken,
  workroomEphemeralAssignmentContextToken,
} from '@zhin.js/workroom';
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { describe, expect, it, vi } from 'vitest';
import { WorkroomKnowledgeCoordinator } from '../../../src/plugin-runtime/workroom/knowledge-coordinator.js';

describe('WorkroomKnowledgeCoordinator', () => {
  it('rejects an aborted generation before publishing knowledge resources', () => {
    const controller = new AbortController();
    controller.abort(new Error('generation replaced'));
    const resources = new Scope(rootPluginId());
    const lifecycle = { add: vi.fn() };

    expect(() => new WorkroomKnowledgeCoordinator({
      stateRoot: process.cwd(),
      generation: 1,
      signal: controller.signal,
      resources,
      lifecycle: lifecycle as never,
      runtime: {} as never,
      profiles: {} as never,
      governance: {} as never,
      persistence: {} as never,
    })).toThrow('generation replaced');
    expect(resources.has(workroomEphemeralAssignmentContextToken)).toBe(false);
    expect(resources.has(workroomAssignmentKnowledgeContextToken)).toBe(false);
    expect(lifecycle.add).not.toHaveBeenCalled();
  });
});
