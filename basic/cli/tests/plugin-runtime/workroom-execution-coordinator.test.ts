import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { portfolioJournalRepositoryToken } from '@zhin.js/agent/runtime';
import { describe, expect, it, vi } from 'vitest';
import { WorkroomExecutionCoordinator } from '../../src/plugin-runtime/workroom-execution-coordinator.js';

describe('WorkroomExecutionCoordinator', () => {
  it('fails before publishing execution resources when the outbound message port is unavailable', () => {
    const resources = new Scope(rootPluginId());

    expect(() => new WorkroomExecutionCoordinator({
      projectRoot: process.cwd(),
      generation: 1,
      signal: new AbortController().signal,
      resources,
      lifecycle: { add: vi.fn() } as never,
      handoff: { add: vi.fn() } as never,
      snapshots: {} as never,
      im: {} as never,
      ingress: {} as never,
      agent: {} as never,
      runtime: {} as never,
      profiles: {} as never,
      governance: {} as never,
      persistence: {} as never,
      acceptance: {} as never,
    })).toThrow('Workroom Execution requires the generation-owned Outbound Message Port');
    expect(resources.has(portfolioJournalRepositoryToken)).toBe(false);
  });
});
