import {
  ActivatableWorkroomCatalog,
  ActivatableWorkroomJournal,
} from '@zhin.js/agent';
import { join } from 'node:path';
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { describe, expect, it } from 'vitest';
import { WorkroomProfileCoordinator } from '../../../src/plugin-runtime/workroom/profile-coordinator.js';

describe('WorkroomProfileCoordinator', () => {
  it('requires the process-owned SnapshotReader before publishing profile authority', () => {
    expect(() => new WorkroomProfileCoordinator({
      projectRoot: process.cwd(),
      stateRoot: join(process.cwd(), '.zhin'),
      generation: 1,
      signal: new AbortController().signal,
      resources: new Scope(rootPluginId()),
      journal: new ActivatableWorkroomJournal(),
      catalog: new ActivatableWorkroomCatalog(),
      listBindings: () => [],
    })).toThrow('Workroom Profile authority requires the process-owned SnapshotReader');
  });
});
