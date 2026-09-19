import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { describe, expect, it, vi } from 'vitest';
import { WorkroomAcceptanceCoordinator } from '../../src/plugin-runtime/workroom-acceptance-coordinator.js';

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
