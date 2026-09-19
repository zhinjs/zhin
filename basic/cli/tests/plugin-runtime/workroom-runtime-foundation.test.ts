import {
  workroomPlanGateAuthorityToken,
  workroomPriorityAuthorityToken,
} from '@zhin.js/agent/runtime';
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { describe, expect, it, vi } from 'vitest';
import { WorkroomRuntimeFoundation } from '../../src/plugin-runtime/workroom-runtime-foundation.js';

describe('WorkroomRuntimeFoundation', () => {
  it('owns the generation journal, catalog, Kernel, and default authorities', async () => {
    const resources = new Scope(rootPluginId());
    const foundation = new WorkroomRuntimeFoundation({
      generation: 7,
      signal: new AbortController().signal,
      resources,
    });

    expect(foundation.journal.active).toBe(false);
    expect(resources.has(workroomPlanGateAuthorityToken)).toBe(true);
    expect(resources.has(workroomPriorityAuthorityToken)).toBe(true);
    expect(await foundation.governance.readProject('project-a')).toBeUndefined();
    expect(foundation.runtime).toBeDefined();
  });

  it('binds one data-governance runtime to every governed projection', async () => {
    const readProject = vi.fn(async (projectId: string) => ({ projectId }));
    const foundation = new WorkroomRuntimeFoundation({
      generation: 8,
      signal: new AbortController().signal,
      resources: new Scope(rootPluginId()),
    });
    const runtime = {
      options: { repository: { readProject } },
      journalPayloads: {},
    } as never;

    foundation.bindDataGovernance(runtime);

    await expect(foundation.governance.readProject('project-b')).resolves.toEqual({
      projectId: 'project-b',
    });
    expect(readProject).toHaveBeenCalledWith('project-b');
    expect(() => foundation.bindDataGovernance(runtime)).toThrow(
      'Workroom data governance runtime is already bound',
    );
  });
});
