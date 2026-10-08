import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ActivatableWorkroomCatalog,
  FileWorkroomCatalog,
  ActivatableWorkroomJournal,
  type AIService,
} from '@zhin.js/agent';
import { type ZhinAgent } from '@zhin.js/agent/runtime';
import { GenerationHandoffStack, Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkroomPersistenceCoordinator } from '../../../src/plugin-runtime/workroom/persistence-coordinator.js';

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

  it('reopens a persisted local Endpoint and rejects its removal during candidate activation before admission', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-workroom-local-restart-'));
    temporaryDirectories.push(projectRoot);
    const disk = new FileWorkroomCatalog(join(projectRoot, '.zhin/workroom-catalog.json'));
    await disk.replace({ local: { name: 'Local', enabled: true,
      members: [{ agent: 'planner', role: 'orchestrator' }], sponsors: ['sponsor'],
      conversation: { adapter: 'minimal-bot', endpoint: 'terminal', kind: 'group', id: 'local-space', agent: 'planner' },
    } }, (await disk.read()).revision);
    async function restart(keys: ReadonlySet<string>) {
      const handoff = new GenerationHandoffStack();
      const resolveKeys = vi.fn(async () => keys);
      const catalog = new ActivatableWorkroomCatalog();
      const persistence = new WorkroomPersistenceCoordinator({
        projectRoot, config: { sessions: { useDatabase: false } }, fixedStorageMode: 'file',
        resources: new Scope(rootPluginId()), handoff, service: {} as AIService,
        agent: { markMemoryPersistenceReady() {} } as unknown as ZhinAgent,
        semanticMemory: null, journal: new ActivatableWorkroomJournal(), journalPayloads: {} as never,
        catalog, listAgentNames: () => ['planner'], resolveConfiguredEndpointKeys: resolveKeys,
        recoverHumanIngress: async () => undefined,
      });
      await persistence.prepare();
      expect(resolveKeys).not.toHaveBeenCalled(); // no projected candidate exists during setup
      handoff.seal();
      return { activate: () => handoff.activateNext(new AbortController().signal), catalog };
    }
    const valid = await restart(new Set(['minimal-bot:terminal']));
    await valid.activate();
    expect((await valid.catalog.read()).definitions.local!.enabled).toBe(true);
    const removed = await restart(new Set());
    await expect(removed.activate()).rejects.toThrow('unknown configured Bot Endpoint');
    expect((await disk.read()).definitions.local!.enabled).toBe(true); // rejected candidate never rewrites persisted authority
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
