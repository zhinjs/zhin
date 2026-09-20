import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GenerationHandoffStack, Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkroomDataGovernanceCoordinator } from '../../../src/plugin-runtime/workroom/data-governance-coordinator.js';
import { WorkroomRuntimeFoundation } from '../../../src/plugin-runtime/workroom/runtime-foundation.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, {
    recursive: true,
    force: true,
  })));
});

describe('WorkroomDataGovernanceCoordinator', () => {
  it('constructs one governance runtime and binds report verification once', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-workroom-governance-'));
    temporaryDirectories.push(projectRoot);
    const resources = new Scope(rootPluginId());
    const foundation = new WorkroomRuntimeFoundation({
      generation: 9,
      signal: new AbortController().signal,
      resources,
    });
    const handoff = new GenerationHandoffStack();
    const coordinator = await WorkroomDataGovernanceCoordinator.create({
      projectRoot,
      generation: 9,
      signal: new AbortController().signal,
      resources,
      usesDatabase: false,
      foundation,
    });
    const verifier = {
      verifyGovernedPayloadPublication: async () => ({ status: 'unknown' as const }),
    };

    expect(coordinator.runtime).toBeDefined();
    expect(coordinator.storage).toBeUndefined();
    expect(coordinator.lifecycle).toBeUndefined();
    coordinator.registerHandoff(handoff);
    expect(() => coordinator.registerHandoff(handoff)).toThrow(
      'Workroom data governance handoff is already registered',
    );
    coordinator.bindReportPayloadVerifier(verifier);
    expect(() => coordinator.bindReportPayloadVerifier(verifier)).toThrow(
      'Workroom report payload verifier is already bound',
    );
  });
});
