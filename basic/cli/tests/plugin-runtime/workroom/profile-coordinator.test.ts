// 保留内部 import 的原因：该 coordinator 只在 Host 内部构造，缺少 SnapshotReader 的路径无法通过公开接口单独触达。
import {
  ActivatableWorkroomCatalog,
  ActivatableWorkroomJournal,
} from '@zhin.js/workroom';
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
