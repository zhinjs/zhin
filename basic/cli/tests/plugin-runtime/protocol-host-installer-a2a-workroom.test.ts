import { describe, expect, it, vi } from 'vitest';
import {
  DisposeStack,
  GenerationHandoffStack,
  Scope,
  SnapshotStore,
  rootPluginId,
} from '@zhin.js/plugin-runtime';
import { httpHostToken } from '@zhin.js/host-http';
import type { RootResourceContext } from '@zhin.js/runtime';
import { installProtocolHosts } from '../../src/plugin-runtime/protocol-host-installer.js';
import { WORKROOM_INSTALL_HINT } from '../../src/utils/optional-workroom.js';

// A separate file (not protocol-host-installer.test.ts) because the importer is replaced for the
// whole module via vi.mock; the a2a branch calls loadWorkroomPackage() without an injectable importer.
const importer = vi.hoisted(() => ({ fail: undefined as unknown }));

vi.mock('../../src/utils/optional-workroom.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/optional-workroom.js')>();
  return {
    ...actual,
    // Real loadWorkroomPackage (missing-package classification included), failing importer injected.
    loadWorkroomPackage: () => actual.loadWorkroomPackage(
      async () => { throw importer.fail; },
    ),
  };
});

async function installA2a(): Promise<void> {
  const resources = new Scope(rootPluginId());
  resources.provide(httpHostToken, { route: () => () => undefined } as never);
  const snapshots = new SnapshotStore({
    root: rootPluginId(),
    tree: new Map(),
    config: new Map(),
    resources: new Map(),
    capabilities: new Map(),
    projections: new Map(),
  });
  await installProtocolHosts({
    config: { a2a: { enabled: false } },
    http: { host: '127.0.0.1', port: 0 },
    snapshots,
    production: false,
    projectRoot: '/tmp/zhin-protocol-host-a2a-test',
  })({
    generation: 1,
    resources,
    lifecycle: new DisposeStack(),
    handoff: new GenerationHandoffStack(),
  } as RootResourceContext);
}

function moduleNotFound(message: string): Error {
  return Object.assign(new Error(message), { code: 'ERR_MODULE_NOT_FOUND' });
}

describe('Protocol Host a2a Workroom loading', () => {
  it('reports the install hint and keeps the cause when @zhin.js/workroom is missing', async () => {
    const cause = moduleNotFound("Cannot find package '@zhin.js/workroom' imported from /x/y.js");
    importer.fail = cause;
    const error = await installA2a().then(() => undefined, (e: unknown) => e as Error);
    expect(error?.message).toBe(WORKROOM_INSTALL_HINT);
    expect(error?.cause).toBe(cause);
  });

  it.each([
    ['another package missing', moduleNotFound("Cannot find package 'other-dep' imported from /x/y.js")],
    ['plain error', new Error('boom')],
  ])('rethrows unrelated failures unchanged: %s', async (_name, failure) => {
    importer.fail = failure;
    const error = await installA2a().then(() => undefined, (e: unknown) => e);
    expect(error).toBe(failure);
  });
});
