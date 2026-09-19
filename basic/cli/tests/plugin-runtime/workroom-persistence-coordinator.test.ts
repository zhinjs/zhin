import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ActivatableWorkroomCatalog,
  ActivatableWorkroomJournal,
  type AIService,
} from '@zhin.js/agent';
import { type ZhinAgent } from '@zhin.js/agent/runtime';
import { GenerationHandoffStack, Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkroomPersistenceCoordinator } from '../../src/plugin-runtime/workroom-persistence-coordinator.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, {
    recursive: true,
    force: true,
  })));
});

describe('WorkroomPersistenceCoordinator', () => {
  it('activates the complete file persistence set before reporting readiness', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-workroom-persistence-'));
    temporaryDirectories.push(projectRoot);
    const markMemoryPersistenceReady = vi.fn();
    const journal = new ActivatableWorkroomJournal();
    const catalog = new ActivatableWorkroomCatalog();
    const persistence = new WorkroomPersistenceCoordinator({
      projectRoot,
      config: { sessions: { useDatabase: false } },
      fixedStorageMode: 'file',
      resources: new Scope(rootPluginId()),
      handoff: new GenerationHandoffStack(),
      service: {} as AIService,
      agent: { markMemoryPersistenceReady } as unknown as ZhinAgent,
      semanticMemory: null,
      journal,
      journalPayloads: {} as never,
      catalog,
      listAgentNames: () => [],
      recoverHumanIngress: async () => undefined,
    });

    await persistence.prepare();

    expect(persistence.usesDatabase).toBe(false);
    expect(persistence.pendingActivation).toBe(false);
    expect(journal.active).toBe(true);
    expect((await catalog.read()).definitions).toEqual({});
    expect(markMemoryPersistenceReady).toHaveBeenCalledOnce();
  });

  it('rejects database mode when the process database Host is absent', async () => {
    const persistence = new WorkroomPersistenceCoordinator({
      projectRoot: process.cwd(),
      config: {},
      fixedStorageMode: 'database',
      resources: new Scope(rootPluginId()),
      handoff: new GenerationHandoffStack(),
      service: {} as AIService,
      agent: {} as ZhinAgent,
      semanticMemory: null,
      journal: new ActivatableWorkroomJournal(),
      journalPayloads: {} as never,
      catalog: new ActivatableWorkroomCatalog(),
      listAgentNames: () => [],
      recoverHumanIngress: async () => undefined,
    });

    await expect(persistence.prepare()).rejects.toThrow(
      'Process-fixed Workroom database storage requires the Database Root Host',
    );
  });
});
